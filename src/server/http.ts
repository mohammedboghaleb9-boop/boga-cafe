/**
 * HTTP edge of the storefront function: the publishable-key check, the route,
 * the visitor's IP and the body size. `supabase/functions/storefront/index.ts`
 * only wires it to the platform (environment, database client).
 */
import { corsHeaders } from '@supabase/supabase-js/cors';
import type { Route } from './guard';
import { isRoute, type Reply } from './storefront';

/** Largest body the forms send is a few KB. */
export const MAX_BODY_CHARS = 64_000;

/** SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS hold {"name": "key", …}. */
export function keysOf(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? Object.values(parsed).filter((k): k is string => typeof k === 'string' && k !== '') : [];
  } catch {
    return [];
  }
}

/**
 * The visitor's address as the platform saw it. Supabase runs behind Cloudflare,
 * which sets cf-connecting-ip itself. Otherwise the last x-forwarded-for entry,
 * the one the last proxy appended: the first entries are whatever the client sent.
 */
export function visitorIp(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const chain = headers.get('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
  return chain.at(-1) || headers.get('x-real-ip')?.trim() || null;
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export interface HttpDeps {
  publicKeys: string[];
  run(route: Route, raw: unknown, ip: string | null): Promise<Reply>;
}

export async function handleHttp(req: Request, deps: HttpDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (!isRoute(route)) return reply({ error: 'not_found' }, 404);
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const key = req.headers.get('apikey') ?? '';
  if (!key || !deps.publicKeys.includes(key)) return reply({ error: 'unauthorized' }, 401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_CHARS) return reply({ error: 'too_large' }, 413);
  // a chunked body has no length header: measure what arrived
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return reply({ error: 'too_large' }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  try {
    const r = await deps.run(route, raw, visitorIp(req.headers));
    return reply(r.body, r.status);
  } catch (e) {
    console.error(`storefront/${route} failed`, e);
    return reply({ error: 'server_error' }, 500);
  }
}
