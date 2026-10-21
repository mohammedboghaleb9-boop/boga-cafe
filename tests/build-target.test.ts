import { describe, expect, it } from 'vitest';
import { PRODUCTION_SITE, buildTarget } from '../scripts/build-target.mjs';

describe('what a build ships', () => {
  it('production is the live shop (owner 2026-10-21), built from the live database only', () => {
    expect(PRODUCTION_SITE).toBe('shop');
    expect(buildTarget({ dataMode: 'supabase', productionDeploy: true })).toBe('shop');
  });

  it('never ships the prototype, or the page by accident, on the production build of main', () => {
    expect(() => buildTarget({ dataMode: 'demo', productionDeploy: true })).toThrow(/production is the live shop/);
    expect(() => buildTarget({ productionDeploy: true })).toThrow(/production is the live shop/);
  });

  it('"coming soon" again is a change to PRODUCTION_SITE: then the page, and no shop from a variable', () => {
    expect(buildTarget({ productionDeploy: true, productionSite: 'coming-soon' })).toBe('coming-soon');
    expect(() => buildTarget({ dataMode: 'supabase', productionDeploy: true, productionSite: 'coming-soon' })).toThrow(/coming soon/);
    expect(() => buildTarget({ dataMode: 'demo', productionDeploy: true, productionSite: 'coming-soon' })).toThrow(/coming soon/);
  });

  it('elsewhere: "coming soon" without VITE_DATA_MODE, the shop for the demo, the browser tests and the previews', () => {
    expect(buildTarget({ dataMode: '', productionDeploy: false })).toBe('coming-soon');
    expect(buildTarget({ dataMode: 'demo', productionDeploy: false })).toBe('shop');
    expect(buildTarget({ dataMode: 'supabase', productionDeploy: false })).toBe('shop');
  });

  it('stops on an unknown value instead of shipping the shop, in production too', () => {
    for (const productionDeploy of [false, true]) {
      for (const v of ['Supabase', 'prod', 'supabse', ' ']) expect(() => buildTarget({ dataMode: v, productionDeploy }), v).toThrow(/not a build/);
    }
  });
});
