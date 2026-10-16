import { defineConfig, loadEnv, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { buildTarget, isProductionDeploy } from './scripts/build-target.mjs';
import { realBuildProblems } from './scripts/real-build.mjs';
import { siteKeyProblem } from './scripts/turnstile-site-key.mjs';

// Build targets:
//  - default (no VITE_DATA_MODE): the production site, the "coming soon" page until the shop opens
//  - VITE_DATA_MODE=supabase: the live-database site (previews, CI, browser tests)
//  - "demo":  the clickable prototype packed into ONE html file (dist-demo/index.html)
/** Only a key meant for browsers: sb_publishable_… or a legacy JWT whose role is anon (an allowlist, so no other key slips through). */
function isPublishableKey(key: string): boolean {
  if (key !== key.trim()) return false;
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: string };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

/**
 * A Workers Builds preview build (a branch other than main) gets the live-site values of .env.workers-preview:
 * this Worker never passes the dashboard's preview settings to the build. Production (main), GitHub CI and
 * local builds stay as they are. Workers Builds injects WORKERS_CI=1 and WORKERS_CI_BRANCH:
 * https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables
 */
const PREVIEW_MODE = 'workers-preview';

/**
 * The production build (no VITE_DATA_MODE: the real site before the shop opens) gets the "coming soon"
 * page as its entry instead of the shop: src/coming-soon, nothing of src/app, so no example catalog,
 * price, cart or form ships (owner, 2026-10-16). Every replacement must apply, or the build stops:
 * a changed index.html never ships the shop by accident. When the files are written, the build checks the
 * folder it wrote (scripts/real-build.mjs) and fails on anything the page must not ship.
 */
function comingSoonEntry() {
  const swaps: [string, string][] = [
    ['<html lang="fr" dir="ltr">', '<html lang="fr" dir="ltr" data-site="coming-soon">'],
    ['src="/src/main.tsx"', 'src="/src/coming-soon/main.tsx"'],
    [
      'content="BOGA CAFÉ — Torréfaction & vente, Oujda. Café en grains, blends signature, single origin et Custom Blend."',
      'content="BOGA CAFÉ, Oujda. La boutique en ligne ouvre bientôt."',
    ],
    ['content="BOGA CAFÉ — Café en grains, torréfié pour vous"', 'content="BOGA CAFÉ — Bientôt en ligne"'],
    ['content="Blends signature, single origin et Custom Blend. Depuis Oujda, livré partout au Maroc."', 'content="BOGA CAFÉ, Oujda. La boutique en ligne ouvre bientôt."'],
    ['<title>BOGA CAFÉ</title>', '<title>BOGA CAFÉ — Bientôt en ligne</title>'],
  ];
  // the only sources the page is built from: a seed or shop module imported by mistake stops the build,
  // whatever text it holds (src/core/types is types only, erased)
  const sources = ['coming-soon/', 'assets/brand/', 'styles/', 'shared/layout/Monogram.tsx', 'shared/ui/BrandIcon.tsx', 'data/contact.ts'];
  let src = '';
  let outDir = '';
  let written = false;
  return {
    name: 'boga-coming-soon',
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = resolve(config.root, config.build.outDir);
      src = `${normalizePath(resolve(config.root, 'src'))}/`;
    },
    buildEnd(this: { getModuleIds(): IterableIterator<string> }, error?: Error) {
      if (error) return;
      const outside = [...this.getModuleIds()]
        .map((id) => id.split('?')[0])
        .filter((id) => id.startsWith(src) && !sources.some((s) => id.startsWith(src + s)))
        .map((id) => id.slice(src.length - 4));
      if (outside.length) throw new Error(`coming soon: the page is built from modules outside its own:\n- ${outside.join('\n- ')}`);
    },
    writeBundle() {
      written = true;
    },
    // after the files are written (closeBundle also runs after a failed build: its own error then stands)
    closeBundle() {
      if (!written) return;
      const { problems, summary } = realBuildProblems(outDir);
      if (problems.length) throw new Error(`coming soon: the build ships what it must not (${outDir}):\n- ${problems.join('\n- ')}`);
      console.log(`coming soon: ${summary}`);
    },
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        for (const [from, to] of swaps) {
          if (!html.includes(from)) throw new Error(`coming soon: index.html no longer holds ${from}`);
          html = html.replace(from, to);
        }
        return html;
      },
    },
  };
}

export default defineConfig(({ command, mode: asked }) => {
  const inWorkersBuilds = command === 'build' && process.env.WORKERS_CI === '1';
  // production (main), whatever `--mode` the build command passes: "coming soon" or a stopped build, below
  const productionDeploy = command === 'build' && isProductionDeploy(process.env);
  // a preview: the default build of another branch (`--mode demo|e2e…` builds stay what they ask for)
  const preview = inWorkersBuilds && asked === 'production' && !productionDeploy;
  if (inWorkersBuilds) console.log(`Workers Builds: ${productionDeploy ? 'production' : 'branch'} build, preview values ${preview ? 'ON' : 'OFF'} (branch "${process.env.WORKERS_CI_BRANCH ?? ''}", mode "${asked}")`);
  const mode = preview ? PREVIEW_MODE : asked;
  const demo = mode === 'demo';
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  // what ships, decided first: "coming soon" without VITE_DATA_MODE; on production nothing else, or the build stops
  const comingSoon = command === 'build' && buildTarget({ dataMode: env.VITE_DATA_MODE, productionDeploy }) === 'coming-soon';
  // the simulated card page must never reach real customers (docs/09, .env.example)
  if (command === 'build' && !demo && env.VITE_CARD_GATEWAY === 'demo') {
    throw new Error('VITE_CARD_GATEWAY=demo is for the prototype only (npm run build:demo). Leave it empty until CMI is connected.');
  }
  // the live database: both public values, and never a secret key (it would ship to every visitor)
  if (env.VITE_DATA_MODE === 'supabase') {
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
    if (!env.VITE_SUPABASE_URL || !key) {
      throw new Error('VITE_DATA_MODE=supabase needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (.env.example). The site never falls back to the example catalog.');
    }
    if (!isPublishableKey(key)) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…) or the legacy anon key, with no spaces: anything else would ship to every visitor.');
    // the storefront function refuses every form without a Turnstile token
    if (!env.VITE_TURNSTILE_SITE_KEY?.trim()) throw new Error('VITE_DATA_MODE=supabase needs VITE_TURNSTILE_SITE_KEY (.env.example): without it no order or B2B request can be sent.');
  }
  // a public key shipped to every visitor, whatever the build: never the secret one (scripts/turnstile-site-key.mjs says what it can and cannot tell)
  const siteKey = env.VITE_TURNSTILE_SITE_KEY ? siteKeyProblem(env.VITE_TURNSTILE_SITE_KEY) : null;
  if (command === 'build' && siteKey) throw new Error(`VITE_TURNSTILE_SITE_KEY ${siteKey}`);
  return {
    ...(preview ? { mode: PREVIEW_MODE } : {}),
    base: demo ? './' : '/',
    plugins: [react(), ...(demo ? [viteSingleFile()] : []), ...(comingSoon ? [comingSoonEntry()] : [])],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      // the seed files are plain data: a build that does not use them (VITE_DATA_MODE=supabase) drops them whole
      rollupOptions: { treeshake: { moduleSideEffects: (id: string) => !id.includes('/src/data/seed/') } },
    },
    test: {
      include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'tests/**/*.test.ts'],
      // the data-layer tests drive the demo store (example orders, DÉMO payment details)
      env: { VITE_DATA_MODE: 'demo' },
    },
  };
});
