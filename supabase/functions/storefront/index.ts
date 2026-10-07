/**
 * POST /functions/v1/storefront/{order|quote}: the two public forms.
 * The logic lives in src/server (http.ts for the request itself, storefront.ts
 * for the forms; both unit tested); this file only wires them to the platform.
 * `npm run build:functions` bundles it with src/ into dist/index.js, which is
 * what gets deployed.
 *
 * Called by anonymous visitors with the publishable key, so the platform's JWT
 * check is off (it only understands the legacy keys) and the `apikey` header is
 * checked in http.ts instead.
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   TURNSTILE_SECRET_KEY  required: every form must carry a valid Turnstile token; without
 *                         the secret, or with one of Cloudflare's test secrets, every form is
 *                         refused (500), none goes through unchecked.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/data/supabase/database.types';
import { handleHttp, keysOf } from '@/server/http';
import { liveTurnstileSecret } from '@/server/guard';
import { handleStorefront } from '@/server/storefront';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const env = (name: string) => Deno.env.get(name) ?? '';

const publicKeys = [...keysOf(env('SUPABASE_PUBLISHABLE_KEYS')), env('SUPABASE_ANON_KEY')].filter(Boolean);
const secretKey = keysOf(env('SUPABASE_SECRET_KEYS'))[0] || env('SUPABASE_SERVICE_ROLE_KEY');

const db = createClient<Database>(env('SUPABASE_URL'), secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handleHttp(req, {
    publicKeys,
    // the secret key also keys the IP hash: never stored, so a stored hash cannot be reversed
    run: (route, raw, ip) => handleStorefront(route, raw, { db, ip, ipKey: secretKey, turnstileSecret: liveTurnstileSecret(env('TURNSTILE_SECRET_KEY')) }),
  }),
);
