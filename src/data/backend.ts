/**
 * Picks where data lives, once, at build time (VITE_DATA_MODE, src/data/mode.ts).
 * Today every build uses the browser backend: the demo with its example data,
 * the real site with the catalog only. 'supabase' is refused until that backend
 * exists (P5 step 3, slice 2; vite.config.ts refuses the build too).
 */
import { demoBackend } from './demo';
import type { Backend } from './types';

function pick(): Backend {
  if (import.meta.env.VITE_DATA_MODE === 'supabase') {
    throw new Error('VITE_DATA_MODE=supabase: the Supabase backend is not written yet.');
  }
  return demoBackend;
}

export const backend: Backend = pick();
