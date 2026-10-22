import { describe, expect, it } from 'vitest';
import { goldParts } from '../goldTitle';

describe('the hero title: a word between asterisks shows in gold', () => {
  it('splits the title around the gold word', () => {
    expect(goldParts('L’âme du *café* dans chaque tasse')).toEqual([
      { text: 'L’âme du ', gold: false },
      { text: 'café', gold: true },
      { text: ' dans chaque tasse', gold: false },
    ]);
  });

  it('keeps a title without asterisks, and an asterisk without its pair, as typed', () => {
    expect(goldParts('Café en grains, torréfié pour vous.')).toEqual([{ text: 'Café en grains, torréfié pour vous.', gold: false }]);
    expect(goldParts('روح *القهوة في كل فنجان')).toEqual([{ text: 'روح *القهوة في كل فنجان', gold: false }]);
  });

  it('allows several gold words, at the start and at the end', () => {
    expect(goldParts('*BOGA* café *torréfié*').map((p) => p.gold)).toEqual([true, false, true]);
  });
});
