import { describe, expect, it } from 'vitest';
import { newReference, reference } from '../ids';

describe('references', () => {
  it('keeps the readable sequential format for the demo history', () => {
    expect(reference('BC', 7, 2026)).toBe('BC-2026-0007');
  });

  it('gives every new request its own code, without look-alike characters', () => {
    // uniqueness comes from `taken` (random codes alone can repeat, rarely): checked as the app uses it
    const refs = new Set<string>();
    for (let i = 0; i < 2000; i++) refs.add(newReference('SR', (r) => refs.has(r), 2026));
    expect(refs.size).toBe(2000);
    for (const r of refs) expect(r).toMatch(/^SR-2026-[2-9A-HJKMNP-Z]{6}$/);
  });

  it('draws every character of the alphabet about equally', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) for (const c of newReference('BC', () => false, 2026).slice(-6)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(31);
    // 30 000 characters: about 968 each; a biased draw gives the first 8 about 12 % more
    const first8 = [...'23456789'].reduce((n, c) => n + counts.get(c)!, 0) / 8;
    const others = [...counts].filter(([c]) => !'23456789'.includes(c)).reduce((n, [, v]) => n + v, 0) / 23;
    expect(first8 / others).toBeLessThan(1.07);
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
