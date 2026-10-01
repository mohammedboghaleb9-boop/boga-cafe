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
 * stock, 'too_many', 'captcha'); 200 {ok: true, …}.
 */
import type { CheckoutError } from '@/core/order';
import type { RequestError } from '@/core/requests';
import type { Order, QuoteRequest } from '@/core/types';
import { loadCatalog } from '@/data/supabase/catalog';
import type { Client } from '@/data/supabase/client';
import { verifyTurnstile, withinLimits, type Route } from './guard';
import { captchaToken, parseCheckoutInput, parseQuoteInput } from './parse';
import { prepareOrder, prepareQuote } from './prepare';

export type GuardError = 'too_many' | 'captcha';
export type OrderResult = { ok: true; order: Order } | { ok: false; errors: (CheckoutError | GuardError)[] };
export type QuoteResult = { ok: true; quote: QuoteRequest } | { ok: false; errors: (RequestError | GuardError)[] };

export interface Deps {
  /** Secret-key client: reads the whole catalog and may call the commit_*() functions. */
  db: Client;
  /** Visitor's IP as seen by the platform, if any. */
  ip: string | null;
  /** Empty = Turnstile off. */
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

type Saved = { data: { id: string; number: string }[] | null; error: { message: string } | null };

/**
 * The saved row's id and number; a refusal by the database's own checks
 * (invalid_order:…, invalid_quote:…) is a request the site's forms never send.
 */
function saved(r: Saved): { id: string; number: string } | null {
  if (r.error && /^invalid_(order|quote):/.test(r.error.message)) return null;
  if (r.error) throw r.error;
  return r.data![0];
}

export function isRoute(v: string): v is Route {
  return v === 'order' || v === 'quote';
}

async function captchaOk(raw: unknown, deps: Deps) {
  if (!deps.turnstileSecret) return true;
  return (deps.verifyCaptcha ?? verifyTurnstile)(deps.turnstileSecret, captchaToken(raw), deps.ip);
}

async function order(raw: unknown, deps: Deps, now: Date): Promise<Reply> {
  const input = parseCheckoutInput(raw);
  if (!input) return BAD_REQUEST;
  if (!(await captchaOk(raw, deps))) return refuse('captcha');
  const p = prepareOrder(input, await loadCatalog(deps.db), now);
  if (!p.ok) return refuse(...p.errors);
  if (!(await withinLimits(deps.db, 'order', p.phone, deps.ip))) return refuse('too_many');
  const r = await deps.db.rpc('commit_order', p.args);
  // someone bought the last kilos between our check and the commit
  if (r.error?.message.startsWith('out_of_stock:')) return refuse('out_of_stock');
  const row = saved(r);
  if (!row) return BAD_REQUEST;
  return { status: 200, body: { ok: true, order: { ...p.order, ...row } } satisfies OrderResult };
}

async function quote(raw: unknown, deps: Deps, now: Date): Promise<Reply> {
  const input = parseQuoteInput(raw);
  if (!input) return BAD_REQUEST;
  if (!(await captchaOk(raw, deps))) return refuse('captcha');
  const p = prepareQuote(input, await loadCatalog(deps.db), now);
  if (!p.ok) return refuse(...p.errors);
  // nothing in the cart exists in the catalog: not a cart the site sends
  if (p.quote.lines.length === 0) return BAD_REQUEST;
  if (!(await withinLimits(deps.db, 'quote', p.phone, deps.ip))) return refuse('too_many');
  const row = saved(await deps.db.rpc('commit_quote_request', p.args));
  if (!row) return BAD_REQUEST;
  return { status: 200, body: { ok: true, quote: { ...p.quote, ...row } } satisfies QuoteResult };
}

const HANDLERS = { order, quote };

export function handleStorefront(route: Route, raw: unknown, deps: Deps): Promise<Reply> {
  return HANDLERS[route](raw, deps, deps.now ?? new Date());
}
