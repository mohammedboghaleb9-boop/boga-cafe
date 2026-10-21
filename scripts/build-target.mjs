// What a build ships (vite.config.ts), failing closed:
//  - the production deploy (Workers Builds, main): what PRODUCTION_SITE below says. Since 2026-10-21 (owner) the live
//    shop on the live database with its own public values (.env.workers-preview), the sales still closed by the
//    database (settings.salesOpen): a site being prepared, not a launch. "coming-soon" brings the page back.
//  - any other build, from VITE_DATA_MODE: empty = the "coming soon" page; "demo" or "supabase" = the shop
//    (prototype, browser tests, previews); anything else (a typo, "Supabase", "prod") stops the build.
// A dashboard variable or a `--mode` never changes what production ships: that is a change to this file, reviewed
// and merged. This guards the build; it cannot stop a deploy command that skips it.

/** What the production deploy ships: 'shop' (the live shop, sales closed until the owner opens them) or 'coming-soon'. */
export const PRODUCTION_SITE = 'shop';

/**
 * A Workers Builds build of main, or of no named branch: the production deploy, whatever `--mode` the
 * build command passes. Workers Builds injects WORKERS_CI=1 and WORKERS_CI_BRANCH:
 * https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables
 * @param {Record<string, string | undefined>} env the process environment
 */
export function isProductionDeploy(env) {
  if (env.WORKERS_CI !== '1') return false;
  const branch = env.WORKERS_CI_BRANCH ?? '';
  return branch === '' || branch === 'main';
}

/** @param {{ dataMode?: string; productionDeploy: boolean; productionSite?: 'shop' | 'coming-soon' }} build */
export function buildTarget({ dataMode = '', productionDeploy, productionSite = PRODUCTION_SITE }) {
  if (dataMode !== '' && dataMode !== 'demo' && dataMode !== 'supabase') {
    throw new Error(`VITE_DATA_MODE="${dataMode}" is not a build: leave it empty ("coming soon"), or set demo or supabase.`);
  }
  if (productionDeploy && productionSite === 'shop') {
    // the live shop only: never the prototype, never the page by accident
    if (dataMode === '') throw new Error('No VITE_DATA_MODE in the production build of main: production is the live shop (scripts/build-target.mjs PRODUCTION_SITE), and .env.workers-preview must set VITE_DATA_MODE=supabase.');
    if (dataMode !== 'supabase') {
      throw new Error(`VITE_DATA_MODE="${dataMode}" in the production build of main: production is the live shop (scripts/build-target.mjs PRODUCTION_SITE), built from .env.workers-preview. Remove the variable from the Cloudflare build settings.`);
    }
    return 'shop';
  }
  if (dataMode === '') return 'coming-soon';
  if (productionDeploy) {
    throw new Error(`VITE_DATA_MODE="${dataMode}" in the production build of main: production is the "coming soon" page (scripts/build-target.mjs PRODUCTION_SITE). Remove the variable from the Cloudflare build settings.`);
  }
  return 'shop';
}
