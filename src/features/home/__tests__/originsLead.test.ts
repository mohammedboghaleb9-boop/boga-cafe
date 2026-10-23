import { describe, expect, it } from 'vitest';
import { ar } from '@/i18n/dictionaries/ar';
import { en } from '@/i18n/dictionaries/en';
import { fr } from '@/i18n/dictionaries/fr';
import { originsLead } from '../originsLead';

describe('the origins sentence follows the real number of origins', () => {
  it('says nothing when no origin is on show', () => {
    for (const t of [ar, fr, en]) expect(originsLead(t, 0)).toBeNull();
  });

  it('uses the singular for one origin and never prints "1 origins"', () => {
    expect(originsLead(fr, 1)).toBe('Une origine de café, avec ses arômes et son caractère.');
    expect(originsLead(en, 1)).toBe('One coffee origin, with its own flavour and character.');
    expect(originsLead(ar, 1)).not.toMatch(/\d/);
  });

  it('prints the count in the plural, from the data', () => {
    expect(originsLead(fr, 6)).toBe('6 origines de café, chacune avec ses arômes et son caractère.');
    expect(originsLead(en, 6)).toBe('6 coffee origins, each with its own flavour and character.');
    expect(originsLead(ar, 6)).toBe('6 مصادر ديال القهوة، وكل واحد بنكهتو وشخصيتو.');
    expect(originsLead(fr, 2)).toMatch(/^2 origines/);
    expect(originsLead(en, 12)).toMatch(/^12 coffee origins/);
  });

  it('keeps Darija free of a wrong "{n} مصادر" outside 3 to 10', () => {
    for (const n of [2, 11, 25]) expect(originsLead(ar, n)).not.toMatch(/\d/);
    for (const n of [3, 10]) expect(originsLead(ar, n)).toMatch(new RegExp(`^${n} مصادر`));
  });

  it('never talks about stock, whatever the language or count', () => {
    for (const t of [ar, fr, en]) for (const n of [1, 2, 6, 11]) expect(originsLead(t, n)).not.toMatch(/stock|مخزون|kilogram|كيلو/i);
  });
});
