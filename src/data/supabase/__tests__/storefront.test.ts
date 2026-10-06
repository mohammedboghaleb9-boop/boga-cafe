/**
 * What the order and B2B forms get from the storefront function: the order or
 * request, the refusals the customer can act on, and 'server' for anything
 * else, so a form never waits forever or shows a raw error.
 */
import { describe, expect, it, vi } from 'vitest';
import { postStorefront, readReply } from '../storefront';
import { publicOrderFromRow, type PublicOrderRow } from '../rows';

type OrderReply = { order: { id: string } };
const read = (status: number, body: unknown) => readReply<OrderReply>(status, body, 'order');

describe('storefront answers', () => {
  it.each([
    ['an order', 200, { ok: true, order: { id: 'o1', number: 'BC-2026-0002' } }, { ok: true, order: { id: 'o1', number: 'BC-2026-0002' } }],
    ['a refusal the form shows', 200, { ok: false, errors: ['phone', 'out_of_stock'] }, { ok: false, errors: ['phone', 'out_of_stock'] }],
    ['the limits', 200, { ok: false, errors: ['too_many'] }, { ok: false, errors: ['too_many'] }],
    ['the anti-robot check', 200, { ok: false, errors: ['captcha'] }, { ok: false, errors: ['captcha'] }],
    ['a request the forms never send (400)', 400, { error: 'bad_request' }, { ok: false, errors: ['server'] }],
    ['a wrong key (401)', 401, { error: 'unauthorized' }, { ok: false, errors: ['server'] }],
    ['a server failure (500)', 500, { error: 'server_error' }, { ok: false, errors: ['server'] }],
    ['a body that is not JSON', 200, null, { ok: false, errors: ['server'] }],
    ['"ok" without the order', 200, { ok: true }, { ok: false, errors: ['server'] }],
    ['a refusal without reasons', 200, { ok: false, errors: [] }, { ok: false, errors: ['server'] }],
    ['a refusal-shaped body with an error status', 400, { ok: false, errors: ['phone'] }, { ok: false, errors: ['server'] }],
    ['reasons that are not text', 200, { ok: false, errors: [1] }, { ok: false, errors: ['server'] }],
  ])('%s', (_, status, body, expected) => {
    expect(read(status, body)).toEqual(expected);
  });

  it('posts the form with the publishable key, and turns a lost connection into "server"', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true, order: { id: 'o1' } }), { status: 200 }));
    // pasted with a trailing slash, as a build variable can be
    const target = { url: 'https://project.supabase.co/', key: 'sb_publishable_x', fetchFn: fetchFn as unknown as typeof fetch };
    expect(await postStorefront<OrderReply>('order', { items: [] }, 'order', target)).toEqual({ ok: true, order: { id: 'o1' } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/functions/v1/storefront/order');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_x');
    expect(init.signal).toBeInstanceOf(AbortSignal); // a server that never answers ends as 'server'

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const offline = { ...target, fetchFn: (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch };
    expect(await postStorefront<OrderReply>('quote', {}, 'order', offline)).toEqual({ ok: false, errors: ['server'] });
    const html = { ...target, fetchFn: (async () => new Response('<html>502</html>', { status: 502 })) as typeof fetch };
    expect(await postStorefront<OrderReply>('order', {}, 'order', html)).toEqual({ ok: false, errors: ['server'] });
  });
});

describe('an order read back by its link', () => {
  // the shape get_order_public returns on the live project (BC-2026-0001, read 2026-10-06)
  const row: PublicOrderRow = {
    number: 'BC-2026-0001',
    created_at: '2026-10-01T18:00:00+00:00',
    customer_name: 'Client Test',
    city_id: 'oujda',
    lines: [{ qty: 2, kind: 'product', name: { ar: 'BOGA Signature', en: 'BOGA Signature', fr: 'BOGA Signature' }, size: 250, lineTotal: 130,
      productId: 'boga-signature', unitPrice: 65, composition: [{ grams: 125, percent: 50, originId: 'brazil' }] }],
    weight_kg: '0.5' as unknown as number,
    subtotal: 130,
    shipping_fee: 20,
    total: 150,
    payment_method: 'bank_transfer',
    payment_status: 'pending',
    status: 'cancelled',
  };

  it('keeps what the customer may see, and nothing private', () => {
    const o = publicOrderFromRow('11111111-2222-3333-4444-555555555555', row);
    expect(o).toMatchObject({ id: '11111111-2222-3333-4444-555555555555', number: 'BC-2026-0001', weightKg: 0.5, total: 150, status: 'cancelled' });
    expect(o.lines[0]).toMatchObject({ productId: 'boga-signature', lineTotal: 130, size: 250 });
    expect(o.customer).toEqual({ fullName: 'Client Test', phone: '', email: '', cityId: 'oujda', address: '', company: '', notes: '' });
  });
});
