/**
 * Server side of the two public forms (Edge Function "storefront"):
 *   POST …/storefront/order   checkout           → commit_order()
 *   POST …/storefront/quote   cart above the B2B threshold → commit_quote_request()
 * Nothing from the browser is trusted but the cart and the contact details:
 * prices, weight, delivery and stock are recomputed from the database with
 * src/core; the database checks every figure again (check_order), then saves,
 * numbers and queues the messages in one transaction.
 *
 * Answers: 400 malformed body (or one the site's forms never send); 200
 * {ok: false, errors} for every refusal the customer can act on (form errors,
 * stock, 'unavailable', 'too_many', 'captcha'); 200 {ok: true, …}. Limits: see guard.ts.
 * Cloudflare Turnstile comes first (slice 4): without a valid token nothing else
 * runs, not a read, not a count; without the secret every form is refused (500).
 * An order sent again with the idempotency key of a saved one gets that order back
 * (slice 3b): with a fresh token (a token works once), nothing else is checked,
 * counted or saved again.
 */
import type { CheckoutError } from '@/core/order';
import type { RequestError } from '@/core/requests';
import type { Order, QuoteRequest } from '@/core/types';
import { loadCatalog } from '@/data/supabase/catalog';
import type { Client } from '@/data/supabase/client';
import { orderFromRow } from '@/data/supabase/rows';
import { verifyTurnstile, withinBudget, withinLimits, type Route } from './guard';
import { captchaToken, idempotencyKey, parseCheckoutInput, parseQuoteInput } from './parse';
import { prepareOrder, prepareQuote } from './prepare';

export type GuardError = 'too_many' | 'captcha';
export type OrderResult = { ok: true; order: Order } | { ok: false; errors: (CheckoutError | GuardError)[] };
export type QuoteResult = { ok: true; quote: QuoteRequest } | { ok: false; errors: (RequestError | GuardError)[] };

export interface Deps {
  /** Secret-key client: reads the whole catalog and may call the commit_*() functions. */
  db: Client;
  /** Visitor's IP as seen by the platform, if any. */
  ip: string | null;
  /** Server secret that keys the IP hash (guard.ts hashIp). */
  ipKey: string;
  /** Turnstile secret key (TURNSTILE_SECRET_KEY); empty = every form refused, never let through. */
  turnstileSecret: string;
  verifyCaptcha?: typeof verifyTurnstile;
  now?: Date;
}

export interface Reply {
  status: number;
  body: unknown;
}

const refuse = <E extends string>(...errors: E[]) => ({ status: 200, body: { ok: false as const, errors } });
const BAD_REQUEST: Reply = { status: 400, body: { error: 'bad_request' } };

type Row = { id: string; number: string; created?: boolean };
type Saved = { data: Row[] | null; error: { message: string } | null };

/**
 * The saved row's id and number; a refusal by the database's own checks
 * (invalid_order:…, invalid_quote:…) is a request the site's forms never send.
 */
function saved(r: Saved): Row | null {
  if (r.error && /^invalid_(order|quote)(:|$)/.test(r.error.message)) return null;
  if (r.error) throw r.error;
  return r.data![0];
}

export function isRoute(v: string): v is Route {
  return v === 'order' || v === 'quote';
}

/** The order saved under this idempotency key, if any (secret key: the whole row). */
async function savedOrder(db: Client, key: string): Promise<Order | null> {
  const { data, error } = await db.from('orders').select('*').eq('idempotency_key', key).maybeSingle();
  if (error) throw error;
  return data ? orderFromRow(data) : null;
}

const placed = (theOrder: Order): Reply => ({ status: 200, body: { ok: true, order: theOrder } satisfies OrderResult });

async function order(raw: unknown, deps: Deps, now: Date): Promise<Reply> {
  const input = parseCheckoutInput(raw);
  const key = idempotencyKey(raw);
  if (!input || key === 'invalid') return BAD_REQUEST;
  if (!(await withinBudget(deps.db, deps.ip, deps.ipKey))) return refuse('too_many');
  // the same submission again (its answer was lost): its order, before any check that
  // could now refuse it (the last kilos it took, the phone's limit)
  const before = key && (await savedOrder(deps.db, key));
  if (before) return placed(before);
  // a refusal after that may come from its twin, saved meanwhile with the last kilos: the customer gets that order
  const unlessSaved = async (reply: Reply) => {
    const twin = key && (await savedOrder(deps.db, key));
    return twin ? placed(twin) : reply;
  };
  const p = prepareOrder(input, await loadCatalog(deps.db), now);
  if (!p.ok) return unlessSaved(refuse(...p.errors));
  if (!(await withinLimits(deps.db, 'order', p.phone, deps.ip, deps.ipKey))) return refuse('too_many');
  const r = await deps.db.rpc('commit_order', key ? { ...p.args, p_idempotency_key: key } : p.args);
  // someone bought the last kilos between our check and the commit
  if (r.error?.message.startsWith('out_of_stock:')) return unlessSaved(refuse('out_of_stock'));
  const row = saved(r);
  if (!row) return BAD_REQUEST;
  // sent twice at the same moment: the other request saved it first
  if (key && row.created === false) {
    const first = await savedOrder(deps.db, key);
    if (!first) throw new Error(`storefront: order ${row.number} of key ${key} not found`);
    return placed(first);
  }
  return placed({ ...p.order, id: row.id, number: row.number });
}

async function quote(raw: unknown, deps: Deps, now: Date): Promise<Reply> {
  const input = parseQuoteInput(raw);
  if (!input) return BAD_REQUEST;
  if (!(await withinBudget(deps.db, deps.ip, deps.ipKey))) return refuse('too_many');
  const p = prepareQuote(input, await loadCatalog(deps.db), now);
  if (!p.ok) return refuse(...p.errors);
  // a cart at or under the threshold is an order, and an empty one is nothing: not what the site sends
  if (!p.aboveThreshold) return BAD_REQUEST;
  if (!(await withinLimits(deps.db, 'quote', p.phone, deps.ip, deps.ipKey))) return refuse('too_many');
  const row = saved(await deps.db.rpc('commit_quote_request', p.args));
  if (!row) return BAD_REQUEST;
  return { status: 200, body: { ok: true, quote: { ...p.quote, ...row } } satisfies QuoteResult };
}

const HANDLERS = { order, quote };

export async function handleStorefront(route: Route, raw: unknown, deps: Deps): Promise<Reply> {
  // fails closed: a function deployed without its secret refuses everything (http.ts answers 500)
  if (!deps.turnstileSecret) throw new Error('storefront: TURNSTILE_SECRET_KEY is not set');
  if (!(await (deps.verifyCaptcha ?? verifyTurnstile)(deps.turnstileSecret, captchaToken(raw), deps.ip))) return refuse('captcha');
  return HANDLERS[route](raw, deps, deps.now ?? new Date());
}
