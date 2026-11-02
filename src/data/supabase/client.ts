/**
 * Supabase client type and query helpers, shared by the site and the Edge
 * Functions (src/server).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type Client = SupabaseClient<Database>;

/** What the visitor's reads and the order link calls use: tables and database functions, nothing of sign-in (./visitorClient.ts). */
export type ReadClient = Pick<Client, 'from' | 'rpc'>;

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
