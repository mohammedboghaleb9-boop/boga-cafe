/**
 * What this build starts with (VITE_DATA_MODE, see .env.example and scripts/build-target.mjs).
 *
 * 'demo' (npm run build:demo, the browser-test build, the unit tests): example
 * orders and requests, payment details marked DÉMO, and the admin panel with its
 * public demo password — all of it kept in the visitor's own browser, isolated test data.
 *
 * 'supabase': the real shop, on the live database, with the real Admin Panel (Supabase Auth + 2FA).
 * Empty: the production build, which is the "coming soon" page and loads none of the shop
 * (src/coming-soon); only `npm run dev` without a mode still runs the shop on the browser store
 * (example catalog, no admin, no payment method).
 */
export const DEMO_DATA: boolean = import.meta.env.VITE_DATA_MODE === 'demo';

/** VITE_DATA_MODE=supabase: orders live on the server, so any device opens one by its link. */
export const SERVER_DATA: boolean = import.meta.env.VITE_DATA_MODE === 'supabase';
