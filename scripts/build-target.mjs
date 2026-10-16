// What a build ships (vite.config.ts), decided from VITE_DATA_MODE alone, failing closed:
//  - empty: the production site, the "coming soon" page (owner 2026-10-16), nothing of the shop;
//  - "demo" or "supabase": the shop (prototype, browser tests, previews);
//  - anything else (a typo, "Supabase", "prod"): the build stops instead of shipping the shop.
// A Workers Builds build of main (production) is "coming soon" only, whatever the dashboard sets
// (a build variable, or a `--mode` that loads a committed .env.<mode> file): opening the shop is a change
// to this file, reviewed and merged. This guards the build; it cannot stop a deploy command that skips it.

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

/** @param {{ dataMode?: string; productionDeploy: boolean }} build */
export function buildTarget({ dataMode = '', productionDeploy }) {
  if (dataMode === '') return 'coming-soon';
  if (dataMode !== 'demo' && dataMode !== 'supabase') {
    throw new Error(`VITE_DATA_MODE="${dataMode}" is not a build: leave it empty (production, "coming soon"), or set demo or supabase.`);
  }
  if (productionDeploy) {
    throw new Error(`VITE_DATA_MODE="${dataMode}" in the production build of main: production is the "coming soon" page until the owner opens the shop (scripts/build-target.mjs). Remove the variable from the Cloudflare build settings.`);
  }
  return 'shop';
}
