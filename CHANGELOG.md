# Changelog

One dated line per meaningful change, newest first. Built from `git log`. Hashes are the commit (or the
merge into `main` when one exists). Trivial commits (initial commits, link fixes, review follow-ups) are left out.
`[branch]` = made on `fix/remediation-3-7`, merged into `main` on 2026-09-30 (901c8af).

## 2026-10-08
- 2026-10-08 [feat/p5-s8-admin-writes] Tooling: project agents `code-reviewer`, `security-auditor`, `supabase-schema-architect` installed from aitmpl (`.claude/agents/`, `model: sonnet`); CLAUDE.md tool list fixed for Vite + React (no `nextjs-developer`), every other name checked in the catalog; one review pass per slice with these agents.
- 2026-10-08 [feat/p5-s8-admin-writes] Notes: slice 7 merged (`f81f59f`, production build 65dfd8ed); owner decisions: previews keep the live Supabase project until launch, writes tested only on TEST rows, no migration applied live before its merge (revisit before P10); the alert for failed messages belongs to the notifications phase.
- 2026-10-08 [feat/p5-s7-admin-reads] Review fixes: `is_admin()` is asked for the role the panel shows (an owner demoted meanwhile no longer sees empty recipients as real), and a new sign-in may check again after a disagreement; tests for both, e2e also refuses a link to a create form.
- 2026-10-08 [feat/p5-s7-admin-reads] Admin Panel reads live data at aal2, read only: orders with their events, B2B requests, stock movements, catalog incl. inactive, delivery, payment methods, settings, queued messages (owner/manager) and recipients (owner), with the admin's own session. `is_admin()` is asked after the reads (RLS answers a non-admin with empty rows): false shows an error and checks the sign-in again; a refreshed token without aal2 goes back to the code; data dropped at sign-out, never stored or logged. Loading / error / empty states and a Refresh button. Every write control is off on the live site with a "coming soon" note (ar/fr/en); the demo keeps all writes. Tests: unit (adminData 5, adminAuth +1), e2e (2 new: every live page has no enabled control left, a11y; error never an empty list).
- 2026-10-08 [feat/p5-s7-admin-reads] Notes, status and `docs/03`: slice 6 merged (`999bb37`), its migration applied live and verified; Cloudflare snapshots the Previews Base config at a branch's first build (same `bc5dfa0` failed on `feat/p5-s6-admin-totp`, built on `feat/p5-s6-totp`), so a dashboard change needs a new branch name. Migration file renamed to the live version `20261008205033_admin_aal2.sql` (content unchanged).
- 2026-10-08 [feat/p5-s6-admin-totp] Notes and `docs/03` corrected: the Previews Base Preview command IS applied (build 29320152 failed running an old long `VITE_…` line saved there) and must stay the short `env -u` line; its Build command and Variables never seen to apply; "Retry build" reuses the original build's config (retry 52f56246).
- 2026-10-08 [feat/p5-s6-admin-totp] Admin two-step verification (TOTP): after the password an admin sets up an authenticator app (QR code + key, shown once, kept nowhere) or enters its code; the panel opens only at aal2; one message for every refused code. Migration `20261008154205_admin_aal2` (not applied live): `is_admin()` needs `aal = 'aal2'`. pgTAP tests (16) in CI; lost-phone steps in PROJECT_NOTES.
- 2026-10-08 [feat/p5-s6-admin-totp] Notes: slice 5 merged (`bf5133d`, tested live on the preview, production log "preview values OFF"); decisions: slice 7 disables admin write buttons not wired yet ("coming soon"), and before slice 8 decide how previews may write to the live database.
- 2026-10-08 [feat/p5-s5-admin-signin] Preview builds take the live-site values from the repo: the dashboard's Previews Base fields are never applied on this Worker (builds 35dba62d, bbe92d7c). In Workers Builds on a branch other than `main`, `vite.config.ts` builds in mode `workers-preview` (`.env.workers-preview`: live Supabase URL, publishable key, Turnstile test site key) and logs ON/OFF. Production dist unchanged byte for byte (`index-BUfp3Opf.js`, plain and `WORKERS_CI_BRANCH=main`). Retracted: the earlier "only the Preview command is applied" and "Retry build keeps the old build config" (not proven).
- 2026-10-08 [feat/p5-s5-admin-signin] Notes and `docs/03`: this Worker applies only the Previews Base Preview command (its Build command was ignored, build 35dba62d), so the preview values now sit in the Preview command (owner); stale "previews fail on every branch" line in `docs/03` corrected.
- 2026-10-08 [feat/p5-s5-admin-signin] Notes: preview builds take their `VITE_*` values from the Previews Base Build command (its "Variables and secrets" did not reach the build); "Retry build" keeps the old build config, so a dashboard change needs a new push.
- 2026-10-08 [feat/p5-s5-admin-signin] `wrangler.jsonc`: `preview_urls: true`, stating the Worker's Version URL setting (already on). Preview builds do get URLs: the log of build d6e0c6cb prints a Version Preview URL and the branch alias; the Cloudflare bot's "No Preview URL" on the PR is wrong. Production unchanged (workers_dev stays true).
- 2026-10-08 [feat/p5-s5-admin-signin] Flaky Turnstile e2e fixed: tests clicked submit before the stand-in's token reached the form (CI run on 4ddc906 failed); the widget now marks `data-solved` and tests wait for it. Reproduced with a 300 ms widget delay (6 failed), then 5 full e2e runs (52/52 each) and the Turnstile spec ×20 (140/140).

## 2026-10-07
- 2026-10-07 [feat/p5-s5-admin-signin] Notes: admin sign-out scope (this browser only) and the browser-only build's no-admin stub recorded as decisions.
- 2026-10-07 [feat/p5-s5-admin-signin] Review: the browser-only build no longer ships the demo password (it did on the branch; check-real-build fixed to see it), sign-out removes the kept session even offline, other tabs' sign-ins re-checked, "try again" for an unchecked session.
- 2026-10-07 [feat/p5-s5-admin-signin] P5 step 3 slice 5: admin sign-in with Supabase Auth in the live-database build (email + password; admin = `is_admin()` + own `admin_users` role, any other account signed out with "no access"; one message for every refused email or password; session kept and refreshed in its own client). Demo sign-in unchanged; the supabase build ships no demo password (CI check).
- 2026-10-07 Slice 4 merged into `main` (5acfad6, owner approved; CI run 112, production build b902f276). `storefront` v6 live without a Turnstile secret: order and B2B request, with no token or a dummy token, all answer 500 and write no row (checked). Preview builds now pass.
- 2026-10-07 [feat/p5-s4-turnstile] P5 step 3 slice 4: Turnstile on checkout and the B2B request (supabase mode only). The storefront function checks the token before anything else and fails closed (no secret or a test secret = every form refused); the widget is dark, compact under 300 px, with "try again"; tests with Cloudflare's test keys (Vitest + a live-site Playwright build). Not deployed live.
- 2026-10-07 Deploy config merged into `main` (a778b66, owner approved): `wrangler.jsonc` + wrangler 4.148.0; production build 9587e73b success; live site checked (home, /shop, unknown paths show the site's 404, /wrangler.jsonc not served).
- 2026-10-07 [feat/p5-deploy-config] Notes corrected: the `env -u` Preview command is not used (old preview model, build 9322a28f); previews fail on every branch, ignored until the design phase (owner decision); config merge approved for production stability.
- 2026-10-07 [feat/p5-deploy-config] Preview build cause found by the owner: Workers Builds bug workers-sdk#15682 (match tag); Preview command now `env -u WRANGLER_CI_MATCH_TAG npx wrangler versions upload`; dashboard settings recorded in PROJECT_NOTES and docs/03.
- 2026-10-07 [feat/p5-deploy-config] Review: `.wrangler/` ignored; Workers Builds preview build still fails (likely no Build command now that auto-setup is skipped; log needed).
- 2026-10-07 [feat/p5-deploy-config] Deploy config (3061d9f): `wrangler.jsonc` with the production auto-setup values + `assets.directory ./dist`, wrangler 4.148.0 pinned; no Vite plugin, no app change.
- 2026-10-07 Slice 3b merged into `main` (344952f, owner approved; CI run 97); deploy config (wrangler.jsonc, pinned wrangler) started on `feat/p5-deploy-config`.
- 2026-10-07 [feat/p5-s3b-order-guards] Slice 3b applied live: migrations `20261007005011_order_idempotency_key` and `20261007080308_order_idempotency_commit`, `storefront` v5. Live: Ethiopia (0 kg) refused `unavailable`, bad key 400, no key still accepted up to `payment_method`; no row written.
- 2026-10-07 [feat/p5-s3b-order-guards] Slice 3b review fixes (17dae3c: keyed retry at the last kilos, quiet catalog reload, key kept 24 h) and migration split as applied live (8cd628d): key column applied, `commit_order` replaced by rename (DROP times out in the live SQL tool).
- 2026-10-07 [feat/p5-s3b-order-guards] Slice 3b code (b3425ba): unavailable products (empty or switched-off origin) not addable and refused as `unavailable`; order idempotency key (site, storefront, migration `order_idempotency` with a unique key in `commit_order`); order page text by link in supabase mode. Not applied live yet.
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
