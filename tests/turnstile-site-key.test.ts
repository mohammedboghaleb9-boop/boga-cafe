/**
 * What the build accepts as the public Turnstile site key (scripts/turnstile-site-key.mjs): never a secret
 * key (35 characters), never a stray space or quote. Cloudflare's own test keys stay allowed (previews, CI).
 */
import { describe, expect, it } from 'vitest';
import { siteKeyProblem } from '../scripts/turnstile-site-key.mjs';

describe('Turnstile site key at build time', () => {
  it('accepts Cloudflare\'s test site keys and a key of the usual real shape', () => {
    for (const key of ['1x00000000000000000000AA', '2x00000000000000000000AB', '3x00000000000000000000FF', '0x4AAAAAAAbcdefghijklMNOp']) {
      expect(siteKeyProblem(key)).toBeNull();
    }
  });

  it('refuses a secret key: a test one, or any value as long as a secret key', () => {
    expect(siteKeyProblem('1x0000000000000000000000000000000AA')).toMatch(/test SECRET/);
    expect(siteKeyProblem('2x0000000000000000000000000000000AA')).toMatch(/test SECRET/);
    expect(siteKeyProblem('0x4AAAAAAAbcdefghijklMNOpqrstuvwxyz12')).toMatch(/35 characters|SECRET/); // 35 characters
    expect(siteKeyProblem('x'.repeat(33))).not.toBeNull();
    expect(siteKeyProblem('x'.repeat(32))).toBeNull(); // the limit is kept as written
  });

  it('refuses spaces, quotes and anything that is not part of a key', () => {
    expect(siteKeyProblem(' 0x4AAAAAAAbcdefghijkl')).toMatch(/space/);
    expect(siteKeyProblem('0x4AAAAAAA bcdefghijkl')).toMatch(/space/);
    expect(siteKeyProblem('0x4AAAAAAAbcdefghijkl\n')).toMatch(/space/);
    expect(siteKeyProblem('"0x4AAAAAAAbcdefghijkl"')).toMatch(/character/);
    expect(siteKeyProblem('0x4AAA/AAAbcdefghijkl')).toMatch(/character/);
  });
});
