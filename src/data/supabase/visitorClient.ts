/**
 * The visitor's client: tables and database functions only (PostgREST). The visitor has no session, so none of
 * supabase-js's sign-in, realtime or storage code is needed, and the shop does not ship it. The requests are the
 * ones supabase-js sends for a visitor: `apikey` and `Authorization: Bearer <publishable key>` on every request.
 * The admin's client stays supabase-js (./index.ts, ../adminClient.ts).
 */
import { PostgrestClient } from '@supabase/postgrest-js';
import type { Database } from './database.types';
import type { ReadClient } from './client';

export function createVisitorClient(url: string, key: string, fetchImpl: typeof fetch): ReadClient {
  const withKey: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) headers.set('apikey', key);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${key}`);
    return fetchImpl(input, { ...init, headers });
  };
  return new PostgrestClient<Database>(new URL('rest/v1', url.endsWith('/') ? url : `${url}/`).href, {
    // telemetry only (supabase-js sent its own name and version here); the header name is the one the API already allows
    headers: { 'X-Client-Info': 'postgrest-js' },
    schema: 'public',
    fetch: withKey,
  });
}
