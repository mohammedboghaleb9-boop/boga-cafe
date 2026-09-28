export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type RefPrefix = 'BC' | 'SR' | 'QR';

/** Sequential reference, used for the demo history: BC-2026-0007. */
export const reference = (prefix: RefPrefix, n: number, year = new Date().getFullYear()) =>
  `${prefix}-${year}-${String(n).padStart(4, '0')}`;

// no 0/O, 1/I/L: the code is read aloud on the phone and typed in bank transfers
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Reference for a new order (BC), sample request (SR) or B2B quote (QR):
 * BC-2026-7K4M2Q. Random, so two customers never share one, even though each
 * browser keeps its own data in the prototype (31^6 ≈ 887 million codes).
 * `taken` lets the caller avoid the (very unlikely) clash with an existing one.
 */
export function newReference(prefix: RefPrefix, taken: (ref: string) => boolean = () => false, year = new Date().getFullYear()): string {
  for (;;) {
    const ref = `${prefix}-${year}-${randomCode(6)}`;
    if (!taken(ref)) return ref;
  }
}
