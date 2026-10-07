import type { Route } from '@playwright/test';

/**
 * The Supabase the live-site build talks to in the browser tests (.env.e2e-supabase):
 * nothing leaves the browser, each test answers what it needs.
 */
export const SUPABASE = 'https://e2e.supabase.test';
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const L = (s: string) => ({ ar: s, fr: s, en: s });
export const tables: Record<string, unknown[]> = {
  origins: [
    { id: 'brazil', name: L('Brésil'), country_code: 'BR', species: 'arabica', region: '', roast_level: 'medium', tasting_notes: L(''),
      stock_kg: 80, low_stock_kg: 5, price_per_kg: 200, custom_blend_enabled: true, restock_date: null, active: true, updated_at: '' },
  ],
  products: [
    { id: 'boga-signature', slug: 'boga-signature', kind: 'signature', name: L('BOGA Signature'), tagline: L(''), description: L(''), roast_level: 'medium',
      tasting_notes: L(''), prices: { 250: 65, 500: 120, 1000: 220 }, image_url: null, featured: true, active: true, sort_order: 1, updated_at: '',
      product_recipes: [{ origin_id: 'brazil', percent: 100 }] },
  ],
  shipping_rates: [{ id: 'oujda', city: L('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true }],
  payment_methods: [{ id: 'cashplus', enabled: true, label: L('Cash Plus'), instructions: L('') }],
  // a payee, so Cash Plus can be chosen and the form reaches the server
  site_config: [{ settings: { cashplus: { beneficiary: 'BOGA E2E' } }, content: {} }],
};

/** A catalog read (rest/v1/<table>), as PostgREST answers it: a list, or one row for .maybeSingle(). */
export function answerCatalog(r: Route) {
  const req = r.request();
  const rows = tables[new URL(req.url()).pathname.split('/').at(-1) ?? ''];
  if (!rows) return r.fulfill({ status: 404, headers: CORS, json: { message: 'not in the e2e catalog' } });
  const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return r.fulfill({ headers: CORS, contentType: 'application/json', json: single ? rows[0] : rows });
}
