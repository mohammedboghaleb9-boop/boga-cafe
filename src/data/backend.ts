/**
 * Picks where data lives, once, at build time (VITE_DATA_MODE, src/data/mode.ts):
 * 'supabase' reads the live database; anything else keeps data in the browser
 * (the demo and the browser tests with their example data, or `npm run dev` without a mode).
 */
import { demoBackend } from './demo';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';

export const backend: Backend = import.meta.env.VITE_DATA_MODE === 'supabase' ? createSupabaseBackend() : demoBackend;
