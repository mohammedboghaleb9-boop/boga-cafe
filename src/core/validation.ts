/** Moroccan phone numbers: 06/07/05 + 8 digits, or +212 / 00212 prefix. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s.\-()]/g, '');
  const m = digits.match(/^(?:\+212|00212|0)([5-7]\d{8})$/);
  return m ? `+212${m[1]}` : null;
}

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
