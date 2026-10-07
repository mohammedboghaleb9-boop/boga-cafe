/**
 * What this build starts with (VITE_DATA_MODE, see .env.example).
 *
 * 'demo' (npm run build:demo, the browser-test build, the unit tests): example
 * orders and requests, payment details marked DÉMO, and the admin panel with its
 * public demo password — all of it kept in the visitor's own browser.
 *
 * Anything else, the real site: the catalog and the business rules only. No
 * example customers, no payment details (so no payment method is offered until
 * the owner's real account exists), and no admin panel: it needs a real sign-in
 * and a shared database (Supabase, phase 2), a browser-only panel would show the
 * owner nothing a customer did.
 */
export const DEMO_DATA: boolean = import.meta.env.VITE_DATA_MODE === 'demo';

/** VITE_DATA_MODE=supabase: orders live on the server, so any device opens one by its link. */
export const SERVER_DATA: boolean = import.meta.env.VITE_DATA_MODE === 'supabase';
