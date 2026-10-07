# Changelog

One dated line per meaningful change, newest first. Built from `git log`. Hashes are the commit (or the
merge into `main` when one exists). Trivial commits (initial commits, link fixes, review follow-ups) are left out.
`[branch]` = made on `fix/remediation-3-7`, merged into `main` on 2026-09-30 (901c8af).

## 2026-10-07
- 2026-10-07 Slice 3 merged into `main` (d2ebd36, owner approved); slice 3b (order guards) started on `feat/p5-s3b-order-guards`.

## 2026-10-06
- 2026-10-06 [feat/p5-s3-orders] P5 step 3 slice 3: in supabase mode orders and B2B requests go through the `storefront` function (`server`/`too_many`/`captcha` shown, the B2B form never hangs), the order page keeps the placed order for the tab or reads `get_order_public`, "I have paid" via RPC, no browser notifications. Live: B2B request QR-2026-0002 sent then closed; an order is refused (no payee details, correct). Review fixes: an unknown refusal code shows `server`, trailing slash in the URL, report confirmation when the re-read fails, 12/12 mutants caught.
- 2026-10-06 Merged `feat/p5-s2-catalog-read` into `main` (0a55ea1, owner approved). `main` auto-deploys to Cloudflare Workers: every merge is a release.
- 2026-10-06 [feat/p5-s2-catalog-read] P5 step 3 slice 2: `VITE_DATA_MODE=supabase` reads the live catalog (`src/data/supabase/store.ts`), loading/error screen, build needs URL + publishable key and refuses a secret key, no seed data in that build (CI checks it). Review fixes: 15 s read timeout, publishable-key allowlist, retry keeps focus, deep links wait for the catalog. Browser builds unchanged.
- 2026-10-06 Merged `feat/p5-s1-async-api` into `main` (abb9646, owner approved): slice 1, async data contract.

## 2026-10-05
- 2026-10-05 [feat/p5-s1-async-api] P5 step 3 slice 1: async `Api` contract (`src/data/types.ts`), browser backend moved to `src/data/demo/`, `backend.ts` picks it by `VITE_DATA_MODE`, admin save buttons await their call one at a time (`useAction`, `aria-disabled` so keyboard focus stays; e2e test), architecture test keeps pages off the backends. Inline fields (shipping, B2B notes, stock switch) still save without waiting (slices 8-10). No visible change.
- 2026-10-05 Merged `fix/supabase-live` into `main` (e13a85e, owner approved): live Supabase schema, limits, `storefront` function. New rule in `CLAUDE.md`: deploy only from `main`.

## 2026-10-01
- 2026-10-01 [fix/supabase-live] Second review: no cap on open orders per phone (it let anyone lock a customer out), IP from Cloudflare's header only, IPv6 counted by /64, body read no further than 64 KB; storefront version 4 deployed and checked.
- 2026-10-01 [fix/supabase-live] Fixes from the independent review: at most 2 unpaid orders per phone, per-connection limits by hour and day and a request budget, IP from Cloudflare's header (spoofing checked on the live project) with a keyed hash, B2B requests only above the threshold and for active cities, NUL and lone surrogates refused, HTTP edge tested (4c06a48).
- 2026-10-01 [fix/supabase-live] Storefront Edge Function on the live project: orders and B2B requests rebuilt from the database with `src/core`, limits per phone and per connection, Turnstile ready (off), card never offered before CMI; B2B request building moved to `src/core/requests.ts`; checked over HTTP (06a28df).
- 2026-10-01 [fix/supabase-live] Live database loaded with the catalog, delivery fees and texts the site shows (`supabase/seed.sql` from `scripts/seed-sql.mjs`), no payment details, card off (6dfd758).
- 2026-10-01 [fix/supabase-live] Live Supabase project on this repo's schema: advisor fixes, server-only B2B request commit, rate limits (one row per bucket), unpaid orders expired every 15 min by pg_cron (48c19e5).

## 2026-09-30
- 2026-09-30 Status report published as one live page for the owner (https://claude.ai/artifact/ULj6DPP9wF7bMdfWpjuFDH), republished on every change; the old "BOGA CAFÉ Control Center" page was deleted at the owner's request.
- 2026-09-30 `fix/remediation-3-7` merged into `main` on the owner's approval; CI green on `main` (run 56); status report updated (901c8af).
- 2026-09-30 [branch] Reply hours on the contact page: every day 8:00-22:00 (owner, Q19/Q22), editable by the owner in Admin → Content; state version 8.
- 2026-09-30 [branch] Paid samples (owner, Q8/Q9): B2B blends sold online in 250 g and 500 g as ordinary paid orders; their 1 kg bag only in a cart above the B2B threshold (`isBulkOnly`, `invalid_order:bulk_only`); sample request form, `sample_requests` table, `sample.created` message and admin tab removed; site text on the partner roaster kept (Q2); state version 7.
- 2026-09-30 [branch] Owner answers recorded in `docs/07`; no automatic free delivery by default (`freeShippingOver` 0 in the seed, state version 6).
- 2026-09-30 [branch] Project memory files: `PROJECT_NOTES.md` and `CHANGELOG.md` (this commit).
- 2026-09-30 [branch] Working rules in `CLAUDE.md` and a Stop hook that blocks finishing when code changed but `PROJECT_NOTES.md` did not (4118bef).
- 2026-09-30 [branch] `PROJECT_STATUS.html`: project status report with evidence for every completed item (c79c1a1).
- 2026-09-30 [branch] Tests that fail when a rule breaks: access matrix (51 cases), two-session race test, boundary tests; page titles, skip link, Escape closes the phone menu; one B2B threshold from settings (71350f6).
- 2026-09-30 [branch] The real site ships no demo data, no admin panel and no placeholder bank details; `check:real-build` in CI; docs say what exists (0b0be45).
- 2026-09-30 [branch] Every stock reservation ends (48 h unpaid, 120 h after "I paid"); "I paid" is a claim, only the owner marks paid; transfer and Cash Plus stay closed until real account details exist (4f5cbd0).

## 2026-09-29
- 2026-09-29 The database recomputes every order (`check_order`), stores what it rebuilt, and matches the site to the unit: rounding, one division per origin for stock, trimmed text, 42-order parity file (b91e7a1).
- 2026-09-29 Form fields are 16 px so iPhone no longer zooms in while typing (b506dc8).
- 2026-09-29 Stock and amounts are always real numbers: NaN and Infinity refused in every numeric column and in `adjust_stock` and `commit_order` (57b6233).
- 2026-09-29 Phase 4: phone layouts, keyboard and screen readers, Playwright and axe browser tests in CI (01d6772).
- 2026-09-29 Phase 3: Node 24, React Router 8, TypeScript 7 and the Oxlint linter (ba49f09).
- 2026-09-29 Phase 2: protect admin data (staff cannot change prices, no free bag, add vs edit), section boundary test (eaa4791).
- 2026-09-29 Batch 1: what customers and the team see before any deploy (d1d880b).

## 2026-09-28
- 2026-09-28 Findings of the pre-merge reviews closed (NEW-1 to NEW-10) and sections kept independent (2fbeef4, 52e2302).
- 2026-09-28 Order-rule holes closed in core, the demo data layer and the database (quantity, sizes, balance minimum, order numbers) (4007ac0).
- 2026-09-28 Every request reaches BOGA reliably and honestly: retry, honest status, hardened `api/notify` (ce7efc8).
- 2026-09-28 Brand, real contact channels, order delivery and reviews merged into `main` (1286622).
- 2026-09-28 `CLAUDE.md` records how to reply to the owner (Darija, right to left) (a7a4293).

## 2026-09-27
- 2026-09-27 Orders, sample requests and B2B quotes delivered to WhatsApp and Gmail (d4a0f5e).
- 2026-09-27 Roast-level photos and the Custom Blend flat-lay (42fef8d).
- 2026-09-27 Vector logo system, real contact channels, self-hosted fonts (21e9abe).
- 2026-09-27 Brand visuals: real product photos, monogram logo, dark storefront, scroll motion (a1897c5).
- 2026-09-27 BOGA CAFÉ imported: full prototype, production schema and project docs (6ffbe84).
