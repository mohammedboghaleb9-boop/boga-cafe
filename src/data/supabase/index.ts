/**
 * Supabase backend of the site, built only when VITE_DATA_MODE=supabase
 * (src/data/backend.ts). The URL and the publishable key are public by design;
 * vite.config.ts refuses the build without them, or with a secret key.
 */
import { createClient } from '@supabase/supabase-js';
import type { Backend } from '../types';
import { supabaseApi } from './api';
import type { Database } from './database.types';
import { createCatalogStore } from './store';

export function createSupabaseBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required with VITE_DATA_MODE=supabase.');
  // visitors only read for now: no session to keep (admin sign-in comes with slice 5)
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = createCatalogStore(client);
  void store.load();
  return { db: store.db, status: store.status, api: supabaseApi, retry: () => void store.load() };
}
