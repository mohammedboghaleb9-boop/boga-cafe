/**
 * POST /functions/v1/storefront/{order|quote}: the two public forms.
 * The logic lives in src/server/storefront.ts (unit tested); this file is the
 * HTTP wrapper. `npm run build:functions` bundles it with src/ into
 * dist/index.js, which is what gets deployed.
 *
 * Called by anonymous visitors with the publishable key, so the platform's JWT
 * check is off (it only understands the legacy keys) and the `apikey` header is
 * checked here instead.
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   TURNSTILE_SECRET_KEY  optional; when set, every form must carry a valid Turnstile token.
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '@supabase/supabase-js/cors';
import type { Database } from '@/data/supabase/database.types';
import { handleStorefront, isRoute } from '@/server/storefront';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const env = (name: string) => Deno.env.get(name) ?? '';

/** SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS hold {"name": "key", …}. */
function keysOf(name: string): string[] {
  try {
    return Object.values(JSON.parse(env(name) || '{}') as Record<string, string>);
  } catch {
    return [];
  }
}

const publicKeys = [...keysOf('SUPABASE_PUBLISHABLE_KEYS'), env('SUPABASE_ANON_KEY')].filter(Boolean);
const secretKey = keysOf('SUPABASE_SECRET_KEYS')[0] || env('SUPABASE_SERVICE_ROLE_KEY');

const db = createClient<Database>(env('SUPABASE_URL'), secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** First address of the chain the platform forwards (the visitor's). */
const visitorIp = (req: Request) =>
  req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (!isRoute(route)) return reply({ error: 'not_found' }, 404);
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!publicKeys.includes(req.headers.get('apikey') ?? '')) return reply({ error: 'unauthorized' }, 401);
  if (Number(req.headers.get('content-length') ?? 0) > 64_000) return reply({ error: 'too_large' }, 413);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }

  try {
    const r = await handleStorefront(route, raw, { db, ip: visitorIp(req), turnstileSecret: env('TURNSTILE_SECRET_KEY') });
    return reply(r.body, r.status);
  } catch (e) {
    console.error(`storefront/${route} failed`, e);
    return reply({ error: 'server_error' }, 500);
  }
});
