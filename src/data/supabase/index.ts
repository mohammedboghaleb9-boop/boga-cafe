/**
 * Supabase backend of the site, built only when VITE_DATA_MODE=supabase
 * (src/data/backend.ts). The URL and the publishable key are public by design;
 * vite.config.ts refuses the build without them, or with any other key.
 */
import { createClient } from '@supabase/supabase-js';
import type { Backend } from '../types';
import { createAdminAuth } from './adminAuth';
import { createAdminData } from './adminData';
import type { Client } from './client';
import { createSupabaseApi } from './api';
import type { Database } from './database.types';
import { createCatalogStore } from './store';

/** A stalled connection ends in the error screen (with "try again") instead of waiting forever. */
const READ_TIMEOUT_MS = 15_000;
const fetchWithTimeout: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(READ_TIMEOUT_MS) });

/** Where supabase-js keeps the admin's session (localStorage), and its companion keys. */
const ADMIN_SESSION_KEY = 'boga-admin-auth';
function forgetAdminSession() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(ADMIN_SESSION_KEY)) localStorage.removeItem(k);
  } catch {
    // no storage: nothing kept
  }
}

export function createSupabaseBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required with VITE_DATA_MODE=supabase.');
  // visitors need no session (admin sign-in comes with slice 5)
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  });
  const store = createCatalogStore(client);
  void store.load();
  const api = createSupabaseApi({ client, store, storefront: { url, key } });
  // the admin's session lives in its own client: the shop keeps reading as a visitor
  // (an admin's session would show it the inactive products too)
  let adminClient: Client | undefined;
  const adminDb = () =>
    (adminClient ??= createClient<Database>(url, key, {
      auth: { storageKey: ADMIN_SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout },
    }));
  const admin = createAdminAuth(adminDb, forgetAdminSession);
  const adminData = createAdminData(adminDb, admin);
  // slice 7 reads only: the panel's writes connect in slices 8-10 (api.ts says which)
  return { db: store.db, status: store.status, api, retry: () => void store.load(), admin, adminData, adminWrites: [] };
}
