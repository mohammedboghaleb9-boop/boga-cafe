import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The real `vite build` command, as Workers Builds runs it (WORKERS_CI, WORKERS_CI_BRANCH), into a fresh
 * folder: what the production build of main can ship (scripts/build-target.mjs: the live shop, from the committed
 * values only), and that the "coming soon" build (the fallback, local default) fails on its own when its files hold
 * what they must not (scripts/real-build.mjs, vite.config.ts).
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
  const headers = existsSync(join(outDir, '_headers')) ? readFileSync(join(outDir, '_headers'), 'utf8') : '';
  const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf8'));
  // the example catalog (a demo build), and the live project's address (a build on the live database)
  const shop = js.some((t) => t.includes('boga-signature'));
  const live = js.some((t) => t.includes('https://ldzagzskfmnjbkizbayr.supabase.co'));
  // the demo: the prototype's public admin password and its DÉMO payment details
  const demo = js.some((t) => t.includes('boga2026') || t.includes('DÉMO'));
  rmSync(outDir, { recursive: true, force: true });
  // a build killed by the timeout is never read as one that stopped on its own
  expect(r.signal, `${r.stdout}${r.stderr}`).toBeNull();
  const noindex = html.includes('<meta name="robots" content="noindex" />');
  return { status: r.status, log: `${r.stdout}${r.stderr}`, comingSoon: html.includes('data-site="coming-soon"'), shop, live, demo, noindex, headers, files };
}

const LIVE = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' };
// every mode whose committed .env.<mode> file builds the shop
const SHOP_MODES = ['demo', 'e2e', 'e2e-supabase', 'workers-preview'];

describe('the production build of main: the live shop from the committed values, or a stopped build', { timeout: 60_000 }, () => {
  for (const branch of ['main', '']) {
    const workers = { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch };
    const where = branch || 'no branch name';

    it(`${where}: the default build is the live shop, not indexed, without the example catalog`, () => {
      const r = build(ROOT, [], workers);
      expect(r.status, r.log).toBe(0);
      expect(r.comingSoon).toBe(false);
      expect(r.live).toBe(true);
      expect(r.noindex).toBe(true);
      expect(r.shop).toBe(false);
      expect(r.demo).toBe(false);
      expect(r.headers).toMatch(/^\/\*\n {2}X-Frame-Options: DENY\n/);
      expect(r.headers).toMatch(/X-Robots-Tag: noindex/);
      // hashed files are kept a year, one exact rule per file that exists; never a splat (the SPA fallback would be cached as HTML)
      expect(r.headers).not.toMatch(/\/assets\/\*/);
      const ruled = [...r.headers.matchAll(/^\/(assets\/\S+)\n {2}Cache-Control: public, max-age=31536000, immutable$/gm)].map((m) => m[1]);
      expect(ruled.length).toBeGreaterThan(10);
      expect(ruled.sort()).toEqual(r.files.filter((f) => f.startsWith('assets/')).sort());
      expect(r.headers.match(/Cache-Control/g)).toHaveLength(ruled.length);
      expect(r.log).toMatch(/production build, live values ON/);
      expect(r.log).toMatch(/live shop: .* reads the live project/);
    });

    for (const mode of SHOP_MODES) {
      it(`${where}: --mode ${mode} stops the build`, () => {
        const r = build(ROOT, ['--mode', mode], workers);
        expect(r.status).not.toBe(0);
        expect(r.log).toMatch(/production build of main/);
        expect(r.shop).toBe(false);
      });
    }

    const dashboard: Record<string, string>[] = [{ VITE_DATA_MODE: 'demo' }, { VITE_DATA_MODE: 'supabase', ...LIVE }, { VITE_SUPABASE_URL: 'https://example.supabase.co' }];
    for (const vars of dashboard) {
      it(`${where}: a dashboard variable (${Object.keys(vars).join(', ')}) stops the build`, () => {
        const r = build(ROOT, [], { ...workers, ...vars });
        expect(r.status).not.toBe(0);
        expect(r.log).toMatch(/in the production build of main/);
        expect(r.shop).toBe(false);
      });
    }
  }

  it('a preview branch still builds the shop with the live-site values', () => {
    const r = build(ROOT, [], { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feat/x' });
    expect(r.status, r.log).toBe(0);
    expect(r.comingSoon).toBe(false);
    expect(r.log).toMatch(/branch build, live values ON/);
    expect(r.noindex).toBe(true);
  });
});

describe('the "coming soon" build and the production shop check the folder they wrote', { timeout: 60_000 }, () => {
  /** A copy of the project (its node_modules linked), changed by `change`, built as "coming soon" (or with `vars`). */
  function buildCopy(change: (dir: string) => void, vars: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'boga-copy-'));
    for (const f of ['index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'src', 'public', 'scripts', '.env.workers-preview']) {
      cpSync(join(ROOT, f), join(dir, f), { recursive: true });
    }
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
    try {
      change(dir);
      // by default the local build: "coming soon" (production's fallback, scripts/build-target.mjs PRODUCTION_SITE)
      return build(dir, [], vars);
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

  it('the production shop fails when it writes an example product name (checked in the files written)', () => {
    const r = buildCopy((dir) => appendFileSync(join(dir, 'src/main.tsx'), "\nconsole.log('Éthiopie Sidamo');\n"), { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' });
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/live shop: the build ships what it must not/);
    expect(r.log).toMatch(/contains "Éthiopie Sidamo"/);
  });
});
