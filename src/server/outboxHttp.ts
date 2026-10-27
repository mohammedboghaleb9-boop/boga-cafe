/**
 * HTTP edge of the outbox sender: who may start a run, and what the answer says. `supabase/functions/notify-outbox`
 * only wires it to the platform (environment, database client, Gmail).
 *
 * The function is called by the database's own schedule (pg_cron + pg_net, once a minute), never by the site: the
 * platform's JWT check is off and a shared key in the `x-outbox-key` header is checked here instead (the same key is
 * the function's OUTBOX_KEY secret and, for the schedule, a Vault secret). A run only sends what is already queued,
 * at the pace claim_outbox allows, so even a leaked key cannot make it send anything new or more often.
 */
import { runOutbox, type OutboxDeps } from './outbox';

/** Shortest OUTBOX_KEY accepted. */
export const MIN_KEY = 32;

export interface OutboxHttpDeps extends OutboxDeps {
  /** The OUTBOX_KEY secret: without it every call is refused (503), none runs unchecked. */
  key: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Compares two texts in time that does not depend on where they differ. */
export function sameKey(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handleOutbox(req: Request, deps: OutboxHttpDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  // a short key is as good as none: the docs ask for 32 characters or more
  if (deps.key.length < MIN_KEY) return json(503, { error: 'not_configured' });
  if (!sameKey(req.headers.get('x-outbox-key') ?? '', deps.key)) return json(401, { error: 'key' });
  try {
    return json(200, await runOutbox(deps));
  } catch {
    // the classes are in the function's log (outbox.ts); the caller learns nothing more
    console.error('outbox: run failed');
    return json(500, { error: 'run_failed' });
  }
}
