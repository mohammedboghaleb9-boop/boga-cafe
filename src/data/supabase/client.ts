/**
 * Supabase client type and query helpers, shared by the site and the Edge
 * Functions (src/server).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type Client = SupabaseClient<Database>;

/** Rows of a list query; throws the query error. */
export function rows<T>({ data, error }: { data: T[] | null; error: unknown }): T[] {
  if (error) throw error;
  return data ?? [];
}

/** Result of a single-row query or a function call; throws its error. */
export function must<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}
