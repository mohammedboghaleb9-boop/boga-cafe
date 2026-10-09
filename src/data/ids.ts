export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type RefPrefix = 'BC' | 'QR';

/** Sequential reference, used for the demo history: BC-2026-0007. */
export const reference = (prefix: RefPrefix, n: number, year = new Date().getFullYear()) =>
  `${prefix}-${year}-${String(n).padStart(4, '0')}`;

// no 0/O, 1/I/L: the code is read aloud on the phone and typed in bank transfers
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// bytes from 248 up would make the first 8 characters more likely: they are drawn again
const FAIR_LIMIT = 256 - (256 % ALPHABET.length);

function randomCode(length: number): string {
  let code = '';
  const bytes = new Uint8Array(length * 2);
  while (code.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < FAIR_LIMIT && code.length < length) code += ALPHABET[b % ALPHABET.length];
  }
  return code;
}

/**
 * Reference for a new order (BC) or B2B quote (QR):
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

/** Readable id from a name: "Éthiopie Yirgacheffe" → "ethiopie-yirgacheffe". */
export const slugify = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Id for a new product or origin: never one already used, so creating
 * "BOGA Signature" a second time gives "boga-signature-2" instead of
 * replacing the existing product (post-merge review).
 */
export function uniqueSlug(name: string, taken: (id: string) => boolean, fallback: string): string {
  const base = slugify(name) || fallback;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

/** A new product's id, also its address: never an existing product's, nor "new" (the add-product form's address, /admin/products/new). */
export const newProductId = (name: string, products: readonly { id: string; slug: string }[]): string =>
  uniqueSlug(name, (id) => id === 'new' || products.some((p) => p.id === id || p.slug === id), 'produit');

/** A new origin's id: never an existing origin's, nor "new" (refused by the database for any catalog id). */
export const newOriginId = (name: string, origins: readonly { id: string }[]): string =>
  uniqueSlug(name, (id) => id === 'new' || origins.some((o) => o.id === id), 'origine');
