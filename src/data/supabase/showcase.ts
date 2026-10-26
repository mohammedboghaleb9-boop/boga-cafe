/**
 * The catalog shown without prices while the sales are closed (owner 2026-10-21): the site's only read of the listed
 * products and origins, showcase_catalog() (migration 20261021120000), which returns their display fields and nothing
 * of a price, a stock or a date. Read only when VITE_SHOWCASE=on: the flag is turned on once the migration is on the
 * database, so the site never asks for a function that is not there yet. Site only: the storefront function reads
 * the tables (src/server) and sells active rows only.
 */
import type { Origin, Product } from '@/core/types';
import type { Client } from './client';
import type { Json } from './database.types';
import { byOriginOrder, loc } from './rows';

export const SHOWCASE_READ: boolean = import.meta.env.VITE_SHOWCASE === 'on';

interface Showcase {
  products: Product[];
  origins: Origin[];
}

type Row = Record<string, Json | undefined>;
const rowsOf = (j: Json | undefined): Row[] => (Array.isArray(j) ? j.filter((r): r is Row => typeof r === 'object' && r !== null && !Array.isArray(r)) : []);
const text = (v: Json | undefined) => (typeof v === 'string' ? v : '');

/**
 * The answer of showcase_catalog() as the site's types: the display fields only. Whatever else the answer might
 * carry is never read: no price (an empty price list offers no size), no stock, never for sale (active false).
 */
export function showcaseFromJson(j: Json): Showcase {
  const body = (j && typeof j === 'object' && !Array.isArray(j) ? j : {}) as Row;
  const products = rowsOf(body.products).map(
    (r): Product => ({
      id: text(r.id),
      slug: text(r.slug),
      kind: text(r.kind) as Product['kind'],
      name: loc(r.name ?? null),
      tagline: loc(r.tagline ?? null),
      description: loc(r.description ?? null),
      // biggest share first, as the table read (rows.ts productFromRow)
      recipe: rowsOf(r.recipe)
        .map((x) => ({ originId: text(x.origin_id), percent: Number(x.percent) }))
        .sort((a, b) => b.percent - a.percent || a.originId.localeCompare(b.originId)),
      roastLevel: text(r.roast_level) as Product['roastLevel'],
      tastingNotes: loc(r.tasting_notes ?? null),
      prices: {},
      ...(typeof r.image_url === 'string' && r.image_url && { image: r.image_url }),
      featured: r.featured === true,
      active: false,
      listed: true,
      sortOrder: Number(r.sort_order) || 0,
    }),
  );
  const origins = rowsOf(body.origins).map(
    (r): Origin => ({
      id: text(r.id),
      name: loc(r.name ?? null),
      countryCode: text(r.country_code),
      species: text(r.species) as Origin['species'],
      region: text(r.region),
      roastLevel: text(r.roast_level) as Origin['roastLevel'],
      tastingNotes: loc(r.tasting_notes ?? null),
      stockKg: 0,
      lowStockKg: 0,
      pricePerKg: null,
      customBlendEnabled: r.custom_blend_enabled === true,
      active: false,
      listed: true,
    }),
  );
  return { products, origins };
}

export async function loadShowcase(db: Client): Promise<Showcase> {
  const { data, error } = await db.rpc('showcase_catalog');
  if (error) throw error;
  return showcaseFromJson(data);
}

/** The rows for sale, then the listed ones they do not already hold (a row for sale keeps its own data). */
export function withShowcase(sale: Showcase, shown: Showcase | null): Showcase {
  if (!shown) return sale;
  const has = (ids: Set<string>) => (x: { id: string }) => !ids.has(x.id);
  return {
    products: [...sale.products, ...shown.products.filter(has(new Set(sale.products.map((p) => p.id))))].sort((a, b) => a.sortOrder - b.sortOrder),
    origins: [...sale.origins, ...shown.origins.filter(has(new Set(sale.origins.map((o) => o.id))))].sort(byOriginOrder),
  };
}
