import { defineConfig, loadEnv, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { PRODUCTION_SITE, buildTarget, isProductionDeploy } from './scripts/build-target.mjs';
import { realBuildProblems, shopBuildProblems } from './scripts/real-build.mjs';
import { shopHeadersFile } from './scripts/shop-headers.mjs';
import { siteKeyProblem } from './scripts/turnstile-site-key.mjs';

// Build targets (scripts/build-target.mjs):
//  - the production deploy (Workers Builds, main): the live shop with the values of .env.workers-preview, sales closed
//  - default elsewhere (no VITE_DATA_MODE): the "coming soon" page (production's fallback, PRODUCTION_SITE)
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
 * A Workers Builds build of another branch (a preview) and the production build of main get the live-site values
 * of .env.workers-preview: this Worker never passes the dashboard's preview settings to the build. GitHub CI and
 * local builds stay as they are. Workers Builds injects WORKERS_CI=1 and WORKERS_CI_BRANCH:
 * https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables
 */
const PREVIEW_MODE = 'workers-preview';

/**
 * A build without VITE_DATA_MODE (the local default, and production's fallback: scripts/build-target.mjs) gets the
 * "coming soon" page as its entry instead of the shop: src/coming-soon, nothing of src/app, so no example catalog,
 * price, cart or form ships (owner, 2026-10-16). Every replacement must apply, or the build stops:
 * a changed index.html never ships the shop by accident. When the files are written, the build checks the
 * folder it wrote (scripts/real-build.mjs) and fails on anything the page must not ship.
 */
function comingSoonEntry() {
  const swaps: [string, string][] = [
    ['<html lang="fr" dir="ltr">', '<html lang="fr" dir="ltr" data-site="coming-soon">'],
    ['src="/src/main.tsx"', 'src="/src/coming-soon/main.tsx"'],
    [
      'content="BOGA CAFÉ — Sélection & vente, Oujda. Café en grains, blends signature, single origin et Custom Blend."',
      'content="BOGA CAFÉ, Oujda. La boutique en ligne ouvre bientôt."',
    ],
    ['content="BOGA CAFÉ — Café en grains, torréfié pour vous"', 'content="BOGA CAFÉ — Bientôt en ligne"'],
    ['content="Blends signature, single origin et Custom Blend. Depuis Oujda, livré partout au Maroc."', 'content="BOGA CAFÉ, Oujda. La boutique en ligne ouvre bientôt."'],
    ['<title>BOGA CAFÉ</title>', '<title>BOGA CAFÉ — Bientôt en ligne</title>'],
  ];
  // the only sources the page is built from (folders end with "/", files match exactly): a seed or shop module
  // imported by mistake stops the build, whatever text it holds (src/core/types is types only, erased)
  const sources = ['coming-soon/', 'assets/brand/', 'styles/', 'shared/layout/Monogram.tsx', 'shared/ui/BrandIcon.tsx', 'data/contact.ts'];
  const own = (path: string) => sources.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s));
  // Windows paths may differ in letter case (c:/ and C:/)
  const key = (id: string) => (process.platform === 'win32' ? id.toLowerCase() : id);
  let src = '';
  let outDir = '';
  let written = false;
  return {
    name: 'boga-coming-soon',
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = resolve(config.root, config.build.outDir);
      src = `${normalizePath(resolve(config.root, 'src'))}/`;
    },
    buildStart() {
      written = false;
    },
    buildEnd(this: { getModuleIds(): IterableIterator<string> }, error?: Error) {
      if (error) return;
      const ids = [...this.getModuleIds()].map((id) => key(id.split('?')[0]));
      const prefix = key(src);
      // fails closed: if the ids are not read under src/ (a linked root…), the check cannot run, so the build stops
      if (!ids.includes(`${prefix}coming-soon/main.tsx`)) throw new Error(`coming soon: the page's entry was not found under ${src}: the module check cannot run`);
      const outside = ids.filter((id) => id.startsWith(prefix) && !own(id.slice(prefix.length))).map((id) => `src/${id.slice(prefix.length)}`);
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

/**
 * Until the launch, the shop asks search engines not to index it (owner 2026-10-21: a site being prepared, its catalog
 * hidden). Every page is this index.html, so one tag covers them all; the launch removes this plugin.
 */
function prelaunchNoindex() {
  const at = '<meta name="theme-color"';
  return {
    name: 'boga-prelaunch-noindex',
    transformIndexHtml(html: string) {
      if (!html.includes(at)) throw new Error('prelaunch noindex: index.html no longer holds its theme-color tag');
      return html.replace(at, `<meta name="robots" content="noindex" />\n    ${at}`);
    },
  };
}

/** The shop's response headers (scripts/shop-headers.mjs): the security rules, and a year of cache for each hashed file. */
function shopHeaders() {
  return {
    name: 'boga-shop-headers',
    // last, so the bundle it lists is the one that is written
    enforce: 'post' as const,
    generateBundle(
      this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => string },
      _options: unknown,
      bundle: Record<string, unknown>,
    ) {
      this.emitFile({ type: 'asset', fileName: '_headers', source: shopHeadersFile(Object.keys(bundle)) });
    },
  };
}

/**
 * A shop build on the live database (production, the previews, CI) checks the folder it wrote, whatever the build was
 * asked: none of the demo or the example catalog, no secret key, no source map (scripts/real-build.mjs); production must
 * also read the live project. Workers Builds deploys what the build wrote without waiting for GitHub CI.
 */
function liveShopCheck(liveUrl: string | undefined) {
  let outDir = '';
  let written = false;
  return {
    name: 'boga-live-shop-check',
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      written = false;
    },
    writeBundle() {
      written = true;
    },
    closeBundle() {
      if (!written) return;
      const { problems, summary } = shopBuildProblems(outDir, { liveUrl });
      if (problems.length) throw new Error(`live shop: the build ships what it must not (${outDir}):\n- ${problems.join('\n- ')}`);
      console.log(summary);
    },
  };
}

export default defineConfig(({ command, mode: asked }) => {
  const inWorkersBuilds = command === 'build' && process.env.WORKERS_CI === '1';
  // production (main), whatever `--mode` the build command passes: the live shop or a stopped build, below
  const productionDeploy = command === 'build' && isProductionDeploy(process.env);
  // a preview: the default build of another branch (`--mode demo|e2e…` builds stay what they ask for)
  const preview = inWorkersBuilds && asked === 'production' && !productionDeploy;
  // production as the live shop: the committed values only, never a `--mode` or a dashboard variable
  const liveSite = productionDeploy && PRODUCTION_SITE === 'shop';
  if (liveSite && asked !== 'production') throw new Error(`--mode ${asked} in the production build of main: production builds the live shop from .env.workers-preview only (scripts/build-target.mjs).`);
  const dashboard = Object.keys(process.env).filter((k) => k.startsWith('VITE_'));
  if (liveSite && dashboard.length) throw new Error(`${dashboard.join(', ')} in the production build of main: production builds the live shop from .env.workers-preview only. Remove the variables from the Cloudflare build settings.`);
  if (inWorkersBuilds) console.log(`Workers Builds: ${productionDeploy ? 'production' : 'branch'} build, live values ${preview || liveSite ? 'ON' : 'OFF'} (branch "${process.env.WORKERS_CI_BRANCH ?? ''}", mode "${asked}")`);
  const mode = preview || liveSite ? PREVIEW_MODE : asked;
  const demo = mode === 'demo';
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  // what ships, decided first (scripts/build-target.mjs): on production the live shop or a stopped build; elsewhere
  // "coming soon" without VITE_DATA_MODE
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
    // Vite's own mode too: import.meta.env carries the live values only when the build itself runs in that mode
    ...(preview || liveSite ? { mode: PREVIEW_MODE } : {}),
    base: demo ? './' : '/',
    plugins: [
      react(),
      ...(demo ? [viteSingleFile()] : []),
      ...(comingSoon ? [comingSoonEntry()] : [prelaunchNoindex(), ...(demo ? [] : [shopHeaders()])]),
      ...(command === 'build' && env.VITE_DATA_MODE === 'supabase' ? [liveShopCheck(liveSite ? env.VITE_SUPABASE_URL : undefined)] : []),
    ],
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
