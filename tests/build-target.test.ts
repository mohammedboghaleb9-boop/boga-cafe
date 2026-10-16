import { describe, expect, it } from 'vitest';
import { buildTarget } from '../scripts/build-target.mjs';

describe('what a build ships', () => {
  it('is "coming soon" without VITE_DATA_MODE, in production and locally', () => {
    expect(buildTarget({ productionDeploy: true })).toBe('coming-soon');
    expect(buildTarget({ dataMode: '', productionDeploy: false })).toBe('coming-soon');
  });

  it('is the shop for the demo, the browser tests and the previews', () => {
    expect(buildTarget({ dataMode: 'demo', productionDeploy: false })).toBe('shop');
    expect(buildTarget({ dataMode: 'supabase', productionDeploy: false })).toBe('shop');
  });

  it('never ships the shop from a variable on the production build of main', () => {
    expect(() => buildTarget({ dataMode: 'supabase', productionDeploy: true })).toThrow(/coming soon/);
    expect(() => buildTarget({ dataMode: 'demo', productionDeploy: true })).toThrow(/coming soon/);
  });

  it('stops on an unknown value instead of shipping the shop', () => {
    for (const v of ['Supabase', 'prod', 'supabse', ' ']) expect(() => buildTarget({ dataMode: v, productionDeploy: false }), v).toThrow(/not a build/);
  });
});
