/**
 * The Admin Panel's writes on the live site (P5 slice 8): orders, stock and the follow-up
 * of B2B requests, each through the database's own function (set_order_status,
 * set_payment_status, adjust_stock, update_quote_request), with the admin's session.
 * The functions check the rights (is_admin() at aal2, "paid" owner only) and record who
 * did it; this file only sends, then reads the panel's data again. A refusal or no
 * answer is never taken for a success: the panel shows "not saved".
 */
import type { StatusRefusal } from '@/core/orderFlow';
import type { QuoteRequest } from '@/core/types';
import type { AdminData, Api } from '../types';
import type { Client } from './client';
import type { Database } from './database.types';

type Fn = keyof Database['public']['Functions'];

/** What the database refused (its exception text), or 'failed' (no answer, or an error with no such text): the panel says "not saved". */
export class WriteFailed extends Error {
  constructor(readonly code: string) {
    super(`admin write failed: ${code}`);
  }
}

const REFUSALS: readonly StatusRefusal[] = ['not_next', 'needs_payment', 'too_late_to_cancel', 'closed', 'refund_instead', 'owner_only'];

type Writes = Pick<Api, 'setOrderStatus' | 'setPaymentStatus' | 'adjustStock' | 'updateQuote'>;

/** `client`: the admin's own (src/data/supabase/index.ts); `data`: what the panel shows, read again after each write. */
export function createAdminWrites(client: () => Client, data: AdminData): Writes {
  /** Calls the function; throws WriteFailed. Logs the function and the refusal only (no customer detail). */
  async function call<F extends Fn>(fn: F, args: Database['public']['Functions'][F]['Args']) {
    const { error } = await client().rpc(fn, args as never);
    if (error) {
      const code = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'failed';
      console.error(`admin write ${fn}:`, code, error.code ?? '');
      // refused (the page was out of date) or no answer (it may have been saved all the same):
      // the panel reads again, so a second try starts from what is really saved
      await data.refresh();
      throw new WriteFailed(code);
    }
    await data.refresh();
  }

  return {
    async setOrderStatus(orderId, status) {
      try {
        await call('set_order_status', { p_order_id: orderId, p_status: status });
        return null;
      } catch (e) {
        // the rules of src/core/orderFlow.ts, as the database applied them; anything else is "not saved"
        if (e instanceof WriteFailed && (REFUSALS as readonly string[]).includes(e.code)) return e.code as StatusRefusal;
        throw e;
      }
    },

    async setPaymentStatus(orderId, paymentStatus) {
      try {
        await call('set_payment_status', { p_order_id: orderId, p_status: paymentStatus });
        return true;
      } catch (e) {
        if (e instanceof WriteFailed && e.code !== 'failed') return false;
        throw e;
      }
    },

    async adjustStock(originId, deltaKg, reason, note) {
      await call('adjust_stock', { p_origin_id: originId, p_delta_kg: deltaKg, p_reason: reason, p_note: note.trim().slice(0, 200) });
    },

    async updateQuote(id, patch: Partial<QuoteRequest>) {
      const current = data.db.get().quotes.find((q) => q.id === id);
      if (!current?.updatedAt) throw new WriteFailed('not_found');
      const next = { ...current, ...patch };
      await call('update_quote_request', {
        p_id: id,
        p_status: next.status,
        p_final_price: next.finalPrice,
        p_admin_notes: next.adminNotes.slice(0, 500),
        // refused ('stale') when another admin changed it since this page read it
        p_seen_at: current.updatedAt,
      });
    },
  };
}
