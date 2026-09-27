export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Human reference: BC-2026-0007 (orders), SR-… (samples), QR-… (B2B quotes). */
export const reference = (prefix: 'BC' | 'SR' | 'QR', n: number, year = new Date().getFullYear()) =>
  `${prefix}-${year}-${String(n).padStart(4, '0')}`;
