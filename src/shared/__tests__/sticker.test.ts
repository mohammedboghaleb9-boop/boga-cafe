import { describe, expect, it } from 'vitest';
import { originIndex, product } from '@/core/__tests__/fixtures';
import { customBlendSticker, productSticker, speciesLine } from '../sticker';

const plain = (s: string) => s.replace(/[⁦⁩]/g, '');

describe('pouch sticker', () => {
  it('prints the product in French with species split, flags, roast and weight', () => {
    const s = productSticker('Boga Signature', product.recipe, 'medium', 1000, originIndex);
    expect(s.title).toBe('BOGA SIGNATURE');
    expect(s.blend).toBe('80% ARABICA · 20% ROBUSTA');
    expect(s.flags.map((f) => f.code)).toEqual(['BR', 'BR']);
    expect(s.detail).toBe('TORRÉFACTION : MOYENNE');
    expect(plain(s.weight)).toBe('℮ 1 kg');
  });

  it('writes 100% when only one species is used', () => {
    expect(speciesLine([{ originId: 'brazil', percent: 100 }], originIndex)).toBe('100% ARABICA');
    expect(speciesLine([{ originId: 'vietnam', percent: 100 }], originIndex)).toBe('100% ROBUSTA');
  });

  it('prints the recipe on Custom Blend pouches', () => {
    const s = customBlendSticker(
      [
        { originId: 'brazil', percent: 60 },
        { originId: 'vietnam', percent: 40 },
      ],
      250,
      originIndex,
    );
    expect(s.title).toBe('CUSTOM BLEND');
    expect(s.detail).toBe('RECETTE : 60 / 40');
    expect(plain(s.weight)).toBe('℮ 250 g');
  });
});
