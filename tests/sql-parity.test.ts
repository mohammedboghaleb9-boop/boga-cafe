/**
 * The site and the database compute an order the same way (audit H2).
 *
 * This test builds orders with src/core (buildOrder, the code the site runs) from
 * the seed catalog and writes them, with that catalog, to supabase/tests/parity.sql.
 * The database job of CI runs that file: commit_order must accept every order, and
 * check_order only accepts figures equal to its own (prices, weight, delivery, stock),
 * so for each of these orders both sides agree exactly; the lines and customer the
 * database saves (rebuilt from its catalog) must also equal the ones src/core built.
 * It is a sample of carts, not a proof for every cart. If src/core or the catalog
 * changes, this test fails until the file is regenerated
 * (`npx vitest run tests/sql-parity.test.ts -u`).
 */
import { describe, expect, it } from 'vitest';
import { isBulkOnly } from '../src/core/cart';
import { buildOrder, type CheckoutContext } from '../src/core/order';
import { offeredSizes } from '../src/core/pricing';
import { indexOrigins } from '../src/core/recipe';
import type { CartItem, PackSize, PaymentMethodId } from '../src/core/types';
import { seedOrigins, seedProducts } from '../src/data/seed/catalog';
import { seedPaymentMethods, seedSettings, seedShippingRates } from '../src/data/seed/config';

// the seed catalog, with plenty of stock, stock counted in green coffee (16 % roast
// loss: deductions are no longer round numbers, and 1/84 never ends in decimals) and free delivery above 1500 DH, so
// most orders pay delivery, extra kg included
// (payment details: test values, the real ones are empty until the owner's account exists)
// and the sales open (closed by default: the database refuses every order then)
const settings = {
  ...seedSettings,
  salesOpen: true,
  roastLossPercent: 16,
  freeShippingOver: 1500,
  customBlend: { ...seedSettings.customBlend, enabled: true },
  bank: { holder: 'Test', bankName: 'Test', rib: 'TEST' },
  cashplus: { beneficiary: 'Test', city: 'Oujda', phone: '0600000000' },
};
const origins = seedOrigins.map((o) => ({ ...o, stockKg: 5000 }));
// the owner's tariff (2026-10-16) on three cities: 20 DH up to 4 kg (4 included), 30 DH above, at any weight
const CAPPED = ['oujda', 'berkane', 'nador'];
const shippingRates = seedShippingRates.map((r) => (CAPPED.includes(r.id) ? { ...r, baseFee: 20, includedKg: 4, extraPerKg: 10, maxFee: 30 } : r));
const ctx: CheckoutContext = {
  catalog: { products: seedProducts, origins: indexOrigins(origins) },
  settings,
  shippingRates,
  paymentMethods: seedPaymentMethods,
};

/** Small deterministic generator, so the file only changes when the rules change. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orders() {
  const rnd = random(20260929);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const products = seedProducts.filter((p) => p.active && offeredSizes(p).length > 0);
  const blendOrigins = origins.filter((o) => o.active && o.customBlendEnabled && (o.pricePerKg ?? 0) >= 1);
  const cities = shippingRates.filter((r) => r.active);
  const methods = seedPaymentMethods.filter((m) => m.enabled).map((m) => m.id as PaymentMethodId);
  const phones = ['06 12 34 56 78', '+212712345678', '0512345678', '00212 6 61 00 00 00'];
  const { minPercent, maxOrigins } = settings.customBlend;

  const blend = (): CartItem => {
    const n = 2 + Math.floor(rnd() * (Math.min(maxOrigins, blendOrigins.length) - 1));
    const chosen = [...blendOrigins].sort(() => rnd() - 0.5).slice(0, n);
    const percents = chosen.map(() => minPercent);
    for (let left = 100 - n * minPercent; left > 0; left--) percents[Math.floor(rnd() * n)] += 1;
    return {
      id: `b${rnd()}`,
      type: 'custom',
      qty: 1 + Math.floor(rnd() * 3),
      blend: { size: pick([250, 500, 1000] as PackSize[]), lines: chosen.map((o, i) => ({ originId: o.id, percent: percents[i] })) },
    };
  };
  const bag = (): CartItem => {
    const product = pick(products);
    // a B2B blend's 1 kg bag is never an order (isBulkOnly): only its paid-sample sizes
    const sizes = offeredSizes(product).filter((s) => !isBulkOnly(product, s));
    return { id: `p${rnd()}`, type: 'product', productId: product.id, size: pick(sizes), qty: 1 + Math.floor(rnd() * 4) };
  };

  const carts: { items: CartItem[]; cityId?: string }[] = [];
  for (let i = 0; i < 40; i++) carts.push({ items: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => (rnd() < 0.6 ? bag() : blend())) });
  // edges: exactly the 10 kg limit, free delivery, extra kg on a far city
  const signature = products.find((p) => offeredSizes(p).includes(1000))!;
  const kilos = (id: string, qty: number, extra: CartItem[] = []): CartItem[] => [{ id, type: 'product', productId: signature.id, size: 1000, qty }, ...extra];
  carts.push({ items: kilos('edge-10kg', 10) });
  // the cap: 4 kg (included: 20 DH), 4.25 kg (30 DH), 6 kg (30 DH, not 40; still under the 1500 DH free delivery)
  carts.push({ items: kilos('cap-4kg', 4), cityId: 'oujda' });
  carts.push({ items: kilos('cap-4.25kg', 4, [{ id: 'cap-250g', type: 'product', productId: signature.id, size: 250, qty: 1 }]), cityId: 'berkane' });
  carts.push({ items: kilos('cap-6kg', 6), cityId: 'nador' });
  // three bags with 7 % Brazil each: 3 × 250 × 7 % / 84 % = 0.0625 kg exactly, a half gram
  // that per-bag sums in decimals would make 0.06249… (the database divides once)
  carts.push({ items:
    ['honduras', 'colombia', 'uganda'].map((other, i): CartItem => ({
      id: `edge-half-${i}`,
      type: 'custom',
      qty: 1,
      blend: { size: 250, lines: [{ originId: 'brazil', percent: 7 }, { originId: other, percent: 93 }] },
    })),
  });

  return carts.flatMap(({ items, cityId }, i) => {
    const r = buildOrder(
      {
        items,
        customer: { fullName: `Client ${i}`, phone: pick(phones), email: i % 3 ? '' : `client${i}@example.ma`, cityId: cityId ?? pick(cities).id, address: ` ${i} rue de Test, Oujda\n`, company: '', notes: '' },
        paymentMethod: pick(methods),
        locale: pick(['ar', 'fr', 'en'] as const),
      },
      ctx,
      { id: `id-${i}`, number: `BC-TEST-${i}`, now: '2026-09-29T10:00:00Z' },
    );
    if (!r.ok) return []; // over 10 kg: a B2B quote, not an order
    const o = r.order;
    return [{ locale: o.locale, customer: o.customer, lines: o.lines, weightKg: o.weightKg, subtotal: o.subtotal, shippingFee: o.shippingFee, total: o.total, paymentMethod: o.paymentMethod, stockDeductions: o.stockDeductions }];
  });
}

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;

function parityFile() {
  const list = orders();
  const out: string[] = [
    '-- GENERATED by tests/sql-parity.test.ts from src/core and the seed catalog: do not edit.',
    '-- Every order below was built by buildOrder(); commit_order must accept each one.',
    '\\set ON_ERROR_STOP on',
    'set client_min_messages = warning;',
    `insert into public.site_config values (1, ${lit(settings)}, '{}');`,
    'insert into public.origins (id, name, country_code, species, region, roast_level, stock_kg, low_stock_kg, price_per_kg, custom_blend_enabled, active) values',
    origins
      .map((o) => `  (${lit(o.id).replace(/"/g, '')}, ${lit(o.name)}, '${o.countryCode}', '${o.species}', ${lit(o.region).replace(/"/g, '')}, '${o.roastLevel}', ${o.stockKg}, ${o.lowStockKg}, ${o.pricePerKg}, ${o.customBlendEnabled}, ${o.active})`)
      .join(',\n') + ';',
    'begin;',
    'insert into public.products (id, slug, kind, name, roast_level, prices, active) values',
    seedProducts.map((p) => `  ('${p.id}', '${p.slug}', '${p.kind}', ${lit(p.name)}, '${p.roastLevel}', ${lit(p.prices)}, ${p.active})`).join(',\n') + ';',
    'insert into public.product_recipes values',
    seedProducts.flatMap((p) => p.recipe.map((r) => `  ('${p.id}', '${r.originId}', ${r.percent})`)).join(',\n') + ';',
    'commit;',
    'insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, max_fee, delivery_days, active) values',
    shippingRates.map((r) => `  ('${r.id}', ${lit(r.city)}, ${r.distanceKm}, ${r.baseFee}, ${r.includedKg}, ${r.extraPerKg}, ${r.maxFee ?? 'null'}, ${lit(r.deliveryDays).replace(/"/g, '')}, ${r.active})`).join(',\n') + ';',
    'insert into public.payment_methods (id, enabled, label) values',
    seedPaymentMethods.map((m) => `  ('${m.id}', ${m.enabled}, ${lit(m.label)})`).join(',\n') + ';',
    'do $$',
    'declare o jsonb; r record; n integer := 0;',
    'begin',
    '  foreach o in array array[',
    list.map((o) => `    ${lit(o)}::jsonb`).join(',\n'),
    '  ] loop',
    "    select * into r from public.commit_order(o, '', '', '');",
    '    -- what is saved is what src/core built (lines in the same order; deductions in any order)',
    '    if exists (select 1 from public.orders x where x.id = r.id and (',
    "         x.lines <> o -> 'lines'",
    "         or (x.customer_name, x.phone, x.email, x.address) is distinct from (o #>> '{customer,fullName}', o #>> '{customer,phone}', o #>> '{customer,email}', o #>> '{customer,address}')",
    "         or not (x.stock_deductions @> (o -> 'stockDeductions') and (o -> 'stockDeductions') @> x.stock_deductions))) then",
    "      raise exception 'TEST FAILED: order % saved differently', r.number;",
    '    end if;',
    '    n := n + 1;',
    '  end loop;',
    `  if n <> ${list.length} then raise exception 'TEST FAILED: % orders', n; end if;`,
    'end $$;',
    `select 'ok parity - ${list.length} orders built by src/core accepted and saved as built by the database' as result;`,
    '',
  ];
  return { sql: out.join('\n'), count: list.length };
}

describe('site and database compute orders the same way', () => {
  it('writes the orders built by src/core to supabase/tests/parity.sql', async () => {
    const { sql, count } = parityFile();
    expect(count).toBeGreaterThanOrEqual(30); // enough orders survive the 10 kg limit
    // the three capped carts, last but one to last but three: the database must agree on 20, 30 and 30 DH
    const capped = orders().filter((o) => CAPPED.includes(o.customer.cityId) && [4, 4.25, 6].includes(o.weightKg) && o.lines.every((l) => l.productId === 'boga-signature'));
    expect(capped.map((o) => [o.customer.cityId, o.weightKg, o.shippingFee])).toEqual([['oujda', 4, 20], ['berkane', 4.25, 30], ['nador', 6, 30]]);
    await expect(sql).toMatchFileSnapshot('../supabase/tests/parity.sql');
  });
});
