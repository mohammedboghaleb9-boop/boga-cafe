/**
 * The Admin Panel's writes on the live site: orders, stock and the follow-up of B2B
 * requests (P5 slice 8), products and origins (slice 9), each through the database's
 * own function (set_order_status, set_payment_status, adjust_stock, update_quote_request,
 * save_product, save_origin), with the admin's session. The functions check the rights
 * (is_admin() at aal2, "paid" owner only, the catalog owner and manager only), what is
 * saved, and record who did it; this file only sends, then reads the panel's data again.
 * A refusal or no answer is never taken for a success: the panel shows "not saved".
 */
import type { StatusRefusal } from '@/core/orderFlow';
import { isPrice } from '@/core/pricing';
import { PACK_SIZES, type Origin, type Product, type QuoteRequest } from '@/core/types';
import { newOriginId, newProductId } from '../ids';
import type { AdminData, Api } from '../types';
import type { Client } from './client';
import type { Database, Json } from './database.types';

type Fn = keyof Database['public']['Functions'];

/** What the database refused (its exception text), or 'failed' (no answer, or an error with no such text): the panel says "not saved". */
export class WriteFailed extends Error {
  constructor(readonly code: string) {
    super(`admin write failed: ${code}`);
  }
}

const REFUSALS: readonly StatusRefusal[] = ['not_next', 'needs_payment', 'too_late_to_cancel', 'closed', 'refund_instead', 'owner_only'];

type Writes = Pick<
  Api,
  'setOrderStatus' | 'setPaymentStatus' | 'adjustStock' | 'updateQuote' | 'createProduct' | 'saveProduct' | 'createOrigin' | 'saveOrigin'
>;

/**
 * The product as save_product reads it: its photo is not sent (image_url stays as it is),
 * and a size without a real price (0 or empty in the form) is not offered.
 */
function productJson(p: Product): Json {
  const prices = Object.fromEntries(PACK_SIZES.filter((s) => isPrice(p.prices[s])).map((s) => [String(s), p.prices[s]!]));
  const { id, slug, kind, name, tagline, description, roastLevel, tastingNotes, featured, active, sortOrder } = p;
  return { id, slug, kind, name, tagline, description, roastLevel, tastingNotes, prices, featured, active, sortOrder };
}

const recipeJson = (p: Product): Json => p.recipe.map(({ originId, percent }) => ({ originId, percent }));

/** The origin as save_origin reads it (stock, shown or not and the restock date are not changed there). */
function originJson(o: Origin): Json {
  const { id, name, countryCode, species, region, roastLevel, tastingNotes, lowStockKg, pricePerKg, customBlendEnabled } = o;
  return { id, name, countryCode, species, region, roastLevel, tastingNotes, lowStockKg, pricePerKg, customBlendEnabled };
}

/**
 * No answer to a creation, but the read that followed shows the new row: it was saved. Said so,
 * since a second click would pick the next free id and create a copy.
 */
async function creating(write: () => Promise<void>, isThere: () => boolean): Promise<void> {
  try {
    await write();
  } catch (e) {
    if (!(e instanceof WriteFailed && e.code === 'failed' && isThere())) throw e;
  }
}

/** A refusal (the database's reason) is answered `refused`; no answer is thrown: it may have been saved. */
async function unlessRefused<T>(write: () => Promise<T>, refused: T): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof WriteFailed && e.code !== 'failed') return refused;
    throw e;
  }
}

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

    setPaymentStatus: (orderId, paymentStatus) =>
      unlessRefused(async () => {
        await call('set_payment_status', { p_order_id: orderId, p_status: paymentStatus });
        return true;
      }, false),

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

    // created hidden, with an id from its French name; it is shown by an edit, after a check
    async createProduct(draft) {
      const id = newProductId(draft.name.fr, data.db.get().products);
      const product = { ...draft, id, slug: id, active: false };
      await creating(
        () => call('save_product', { p_product: productJson(product), p_recipe: recipeJson(product), p_seen_at: null }),
        () => data.db.get().products.some((p) => p.id === id),
      );
      return product;
    },

    // refused ('stale') when another admin changed it since the form read it
    saveProduct: (product) =>
      unlessRefused(async () => {
        if (!product.updatedAt) return false;
        await call('save_product', { p_product: productJson(product), p_recipe: recipeJson(product), p_seen_at: product.updatedAt });
        return true;
      }, false),

    // created hidden, at 0 kg: its first lot comes through adjustStock
    createOrigin: (draft) =>
      unlessRefused(async () => {
        if (!isPrice(draft.pricePerKg)) return null;
        const origin = { ...draft, id: newOriginId(draft.name.fr, data.db.get().origins), stockKg: 0, active: false };
        await creating(
          () => call('save_origin', { p_origin: originJson(origin), p_seen_at: null }),
          () => data.db.get().origins.some((o) => o.id === origin.id),
        );
        return origin;
      }, null),

    // the price per kg, the alert level and Custom Blend only; refused ('stale') from an older copy
    saveOrigin: (origin) =>
      unlessRefused(async () => {
        if (!isPrice(origin.pricePerKg) || !origin.updatedAt) return false;
        await call('save_origin', { p_origin: originJson(origin), p_seen_at: origin.updatedAt });
        return true;
      }, false),
  };
}
