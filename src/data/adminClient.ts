/**
 * Loads the Admin Panel's sign-in code (supabase-js) before the panel opens, on the live-database build only.
 * Visitors never run this: the shop reads with ./supabase/visitorClient.ts.
 */
import { provideAdminClient } from './supabase';

export async function loadAdminClient(): Promise<void> {
  if (import.meta.env.VITE_DATA_MODE !== 'supabase') return;
  const { createClient } = await import('@supabase/supabase-js');
  provideAdminClient(createClient);
}
