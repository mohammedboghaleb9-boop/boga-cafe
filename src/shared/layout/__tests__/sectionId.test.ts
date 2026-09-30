import { describe, expect, it } from 'vitest';
import { sectionId } from '../sectionId';

describe('section links', () => {
  it('reads the section, encoded or not, and ignores a badly encoded one', () => {
    expect(sectionId('#section')).toBe('section');
    expect(sectionId('#caf%C3%A9')).toBe('café');
    expect(sectionId('#%E0%A4%A')).toBe('');
    expect(sectionId('#%')).toBe('');
    expect(sectionId('')).toBe('');
  });
});
