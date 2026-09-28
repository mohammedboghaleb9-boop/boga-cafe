import { describe, expect, it } from 'vitest';
import { newReference, reference } from '../ids';

describe('references', () => {
  it('keeps the readable sequential format for the demo history', () => {
    expect(reference('BC', 7, 2026)).toBe('BC-2026-0007');
  });

  it('gives every new request its own code, without look-alike characters', () => {
    const refs = new Set(Array.from({ length: 2000 }, () => newReference('SR', () => false, 2026)));
    expect(refs.size).toBe(2000);
    for (const r of refs) expect(r).toMatch(/^SR-2026-[2-9A-HJKMNP-Z]{6}$/);
  });

  it('never returns a reference that is already taken', () => {
    const seen = new Set<string>();
    let first = '';
    const r = newReference('BC', (ref) => {
      if (!first) {
        first = ref;
        seen.add(ref);
        return true; // pretend the first draw exists
      }
      return seen.has(ref);
    });
    expect(r).not.toBe(first);
  });
});
