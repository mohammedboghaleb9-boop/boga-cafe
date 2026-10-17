import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * wrangler.jsonc as `wrangler deploy` (main) applies it: Version URLs off (a branch build is the shop on the
 * live database), the production workers.dev URL left as it is (no workers_dev, no routes).
 */
const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
// its comments are whole lines; no value holds "//"
const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>;

describe('wrangler.jsonc', () => {
  it('keeps Version URLs off', () => {
    expect(config.preview_urls).toBe(false);
  });

  it('leaves the production workers.dev URL as it is', () => {
    expect(config).not.toHaveProperty('workers_dev');
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('route');
  });

  it('is the only Wrangler config (another file would be read in its place)', () => {
    for (const other of ['wrangler.json', 'wrangler.toml']) expect(existsSync(new URL(`../${other}`, import.meta.url))).toBe(false);
  });

  it('has no environment that could set its own preview_urls', () => {
    expect(config).not.toHaveProperty('env');
    expect(config).not.toHaveProperty('previews');
  });
});
