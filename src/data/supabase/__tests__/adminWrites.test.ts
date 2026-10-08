/**
 * The Admin Panel's writes on the live site (slice 8): each goes to its database
 * function with the admin's session, the panel reads its data again afterwards,
 * and a refusal or no answer is never taken for a success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteRequest } from '@/core/types';
import { STATE_VERSION, type DbState } from '../../state';
import type { AdminData } from '../../types';
import { createAdminWrites, WriteFailed } from '../adminWrites';
import type { Client } from '../client';

const quote = { id: 'q1', status: 'new', finalPrice: null, adminNotes: 'old note' } as unknown as QuoteRequest;

function setup(answer: { error: { message: string; code?: string } | null } = { error: null }) {
  const rpc = vi.fn(async () => ({ data: null, ...answer }));
  const data: AdminData = {
    db: { get: () => ({ version: STATE_VERSION, quotes: [quote] }) as unknown as DbState, subscribe: () => () => {} },
    status: { get: () => 'ready', subscribe: () => () => {} },
    reload: vi.fn(),
    refresh: vi.fn(async () => {}),
  };
  const writes = createAdminWrites(() => ({ rpc }) as unknown as Client, data);
  return { writes, rpc, data };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('admin writes (live site)', () => {
  it('sends each change to its database function, then reads the panel data again', async () => {
    const { writes, rpc, data } = setup();
    expect(await writes.setOrderStatus('o1', 'confirmed', 'staff')).toBeNull();
    expect(await writes.setPaymentStatus('o1', 'paid', 'owner')).toBe(true);
    await writes.adjustStock('brazil', -1.5, 'correction', '  TEST  ');
    await writes.updateQuote('q1', { status: 'negotiating', finalPrice: 5500 });
    expect(rpc.mock.calls).toEqual([
      ['set_order_status', { p_order_id: 'o1', p_status: 'confirmed' }],
      ['set_payment_status', { p_order_id: 'o1', p_status: 'paid' }],
      ['adjust_stock', { p_origin_id: 'brazil', p_delta_kg: -1.5, p_reason: 'correction', p_note: 'TEST' }],
      // the follow-up is sent whole: what was not changed keeps its saved value
      ['update_quote_request', { p_id: 'q1', p_status: 'negotiating', p_final_price: 5500, p_admin_notes: 'old note' }],
    ]);
    expect(data.refresh).toHaveBeenCalledTimes(4);
  });

  it('a refusal comes back as a refusal (the panel reads again); no answer is an error, never a success', async () => {
    const refused = setup({ error: { message: 'needs_payment', code: 'P0001' } });
    expect(await refused.writes.setOrderStatus('o1', 'in_production', 'owner')).toBe('needs_payment');
    expect(refused.data.refresh).toHaveBeenCalledTimes(1);

    const forbidden = setup({ error: { message: 'forbidden', code: 'P0001' } });
    expect(await forbidden.writes.setPaymentStatus('o1', 'paid', 'owner')).toBe(false);
    await expect(forbidden.writes.adjustStock('brazil', 1, 'restock', '')).rejects.toThrow(WriteFailed);

    const offline = setup({ error: { message: 'TypeError: Failed to fetch' } });
    await expect(offline.writes.setOrderStatus('o1', 'confirmed', 'owner')).rejects.toThrow(WriteFailed);
    await expect(offline.writes.setPaymentStatus('o1', 'paid', 'owner')).rejects.toThrow(WriteFailed);
    await expect(offline.writes.updateQuote('q1', { adminNotes: 'x' })).rejects.toThrow(WriteFailed);
    expect(offline.data.refresh).not.toHaveBeenCalled();
  });
});
