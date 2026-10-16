import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The real `vite build` command, as Workers Builds runs it (WORKERS_CI, WORKERS_CI_BRANCH), into a fresh
 * folder: what the production build of main can ship (scripts/build-target.mjs), and that the "coming soon"
 * build fails on its own when its files hold what they must not (scripts/real-build.mjs, vite.config.ts).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');

function build(cwd: string, args: string[], vars: Record<string, string>) {
  // only the variables a test sets: vitest runs with VITE_DATA_MODE=demo and NODE_ENV=test (React's development build)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITE_|VITEST|WORKERS_CI|NODE_ENV$|MODE$)/.test(k)));
  const outDir = mkdtempSync(join(tmpdir(), 'boga-build-'));
  const r = spawnSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir', ...args], {
    cwd,
    env: { ...env, ...vars },
    encoding: 'utf8',
    // a hung build fails its test instead of holding the worker
    timeout: 55_000,
    killSignal: 'SIGKILL',
  });
  const files = readdirSync(outDir, { recursive: true }).map(String);
  const html = existsSync(join(outDir, 'index.html')) ? readFileSync(join(outDir, 'index.html'), 'utf8') : '';
  const shop = files.some((f) => f.endsWith('.js') && readFileSync(join(outDir, f), 'utf8').includes('boga-signature'));
  rmSync(outDir, { recursive: true, force: true });
  return { status: r.status, log: `${r.stdout}${r.stderr}`, comingSoon: html.includes('data-site="coming-soon"'), shop };
}

const LIVE = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' };
// every mode whose committed .env.<mode> file builds the shop
const SHOP_MODES = ['demo', 'e2e', 'e2e-supabase', 'workers-preview'];

describe('the production build of main: "coming soon", or a stopped build, never the shop', { timeout: 60_000 }, () => {
  for (const branch of ['main', '']) {
    const workers = { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch };
    const where = branch || 'no branch name';

    it(`${where}: the default build is the checked "coming soon" page`, () => {
      const r = build(ROOT, [], workers);
      expect(r.status, r.log).toBe(0);
      expect(r.comingSoon).toBe(true);
      expect(r.shop).toBe(false);
      expect(r.log).toMatch(/coming soon: "coming soon" only/);
    });

    for (const mode of SHOP_MODES) {
      it(`${where}: --mode ${mode} stops the build`, () => {
        const r = build(ROOT, ['--mode', mode], workers);
        expect(r.status).not.toBe(0);
        expect(r.log).toMatch(/production build of main/);
      });
    }

    it(`${where}: a VITE_DATA_MODE variable stops the build`, () => {
      const r = build(ROOT, [], { ...workers, ...LIVE, VITE_DATA_MODE: 'supabase' });
      expect(r.status).not.toBe(0);
      expect(r.log).toMatch(/production build of main/);
    });
  }

  it('a preview branch still builds the shop with the live-site values', () => {
    const r = build(ROOT, [], { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feat/x' });
    expect(r.status, r.log).toBe(0);
    expect(r.comingSoon).toBe(false);
    expect(r.log).toMatch(/preview values ON/);
  });
});

describe('the "coming soon" build checks the folder it wrote', { timeout: 60_000 }, () => {
  /** A copy of the project (its node_modules linked), changed by `change`, built as production. */
  function buildCopy(change: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'boga-copy-'));
    for (const f of ['index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'src', 'public', 'scripts', '.env.workers-preview']) {
      cpSync(join(ROOT, f), join(dir, f), { recursive: true });
    }
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
    change(dir);
    try {
      return build(dir, [], { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' });
    } finally {
      // removes the link to node_modules, never what it points to (rm does not follow links)
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('an unchanged copy builds (the failures below come from the change)', () => {
    const r = buildCopy(() => {});
    expect(r.status, r.log).toBe(0);
    expect(r.comingSoon).toBe(true);
  });

  it('fails when the page imports the example catalog', () => {
    const r = buildCopy((dir) =>
      appendFileSync(join(dir, 'src/coming-soon/main.tsx'), "\nimport { seedProducts } from '@/data/seed/catalog';\nconsole.log(seedProducts);\n"),
    );
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/built from modules outside its own:\n- src\/data\/seed\/catalog\.ts/);
  });

  it('fails when the page writes an example product name itself (checked in the files written)', () => {
    const r = buildCopy((dir) => appendFileSync(join(dir, 'src/coming-soon/main.tsx'), "\nconsole.log('Éthiopie Sidamo');\n"));
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/the build ships what it must not/);
    expect(r.log).toMatch(/contains "Éthiopie Sidamo"/);
  });

  it('fails when the page imports any module outside its own, even one whose text the checks do not know', () => {
    const r = buildCopy((dir) =>
      appendFileSync(join(dir, 'src/coming-soon/main.tsx'), "\nimport { seedContent } from '@/data/seed/config';\nconsole.log(seedContent);\n"),
    );
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/built from modules outside its own:\n- src\/data\/seed\/config\.ts/);
  });

  it('fails on a file that is not part of the page', () => {
    const r = buildCopy((dir) => writeFileSync(join(dir, 'public/menu.json'), '{}'));
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/menu\.json is not a file of the "coming soon" page/);
  });

  it('a broken build keeps its own error (no check runs on a folder it never wrote)', () => {
    const r = buildCopy((dir) => appendFileSync(join(dir, 'src/coming-soon/main.tsx'), '\nconst broken = ;\n'));
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/Build failed/);
    expect(r.log).not.toMatch(/ENOENT|ships what it must not/);
  });

  it('fails when the page names the live database', () => {
    const r = buildCopy((dir) => appendFileSync(join(dir, 'src/coming-soon/main.tsx'), "\nconsole.log('https://ldzagzskfmnjbkizbayr.supabase.co');\n"));
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/contains "ldzagzskfmnjbkizbayr"/);
  });
});
