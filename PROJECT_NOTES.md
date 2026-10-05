# PROJECT_NOTES.md: BOGA CAFÉ

Read this first. Update it before finishing any session that changed code. Sources: `PROJECT_STATUS.html`
(status; the owner reads it live at https://claude.ai/artifact/ULj6DPP9wF7bMdfWpjuFDH, republished on every change, see `CLAUDE.md`), `git log` (history), the code. Anything I could not check is under "Needs verification".
Last updated: 2026-10-05 (P5 step 3 planned in 11 slices; slice 1 on `feat/p5-s1-async-api`, not merged). Repo: `mohammedboghaleb9-boop/boga-cafe` (GitHub), working copy `/home/user/boga-cafe`.

## What it is
Website + online shop for BOGA CAFÉ, a whole-bean coffee brand from Oujda (Morocco). B2C and B2B:
a cart above the B2B threshold (`settings.b2bThresholdKg`, 10 kg by default) becomes a quote request.
B2B blends: 250 g and 500 g are paid samples bought like any bag; the 1 kg bag only in a cart above the threshold.
Custom Blend (customer sets origin percentages, total must be 100). Stock in kg per origin. Arabic (RTL),
French, English. Admin roles owner / manager / staff. No cash on delivery: every order is paid before prep.

## Status (2026-10-05; numbers from PROJECT_STATUS.html)
- **Estimated** 66 % by item count: (27 done + 3 partial × 0.5) / 43. P5 is in progress: server side done and merged,
  the site is not connected yet: 9-12 days left (**Estimated**: slices 2-11 = 8.75 d + outbox sender 1-1.5 d; per slice in PROJECT_STATUS.html §5/§7).
- `main` = `369391d` (docs on top of `68e8643`, CI run 71 green; `e13a85e` = merge of `fix/supabase-live`).
- **Site on Cloudflare Workers**, deployed by the owner from `main` (`npx wrangler deploy`; URL not checked by me). Real
  build: seed catalog in the browser, no admin panel, no payment method open. **Not connected to Supabase** (no data
  layer yet, P5 step 3): the live database gets nothing from the site. **Notifications do not work** (Known issues).
- **Live Supabase project** `boga-cafe` (ref `ldzagzskfmnjbkizbayr`, eu-west-3, free plan): migrations applied, catalog
  loaded from `supabase/seed.sql`, two owner accounts (not listed here, the repo is public; sign-up off), Edge Function
  `storefront` v4 ACTIVE (deployed 2026-10-01 from the branch's bundle, not re-compared byte for byte). Checked read-only
  2026-10-05: 7 migrations, same as `supabase/migrations`; `storefront` is the only function (`create-order` is gone);
  the two owners never signed in, no 2FA factor yet; no `save_product` function yet (slice 9).

## Open branches (not merged into `main`)
- `feat/p5-s1-async-api` (from `369391d`): P5 step 3 slice 1, async data contract, no visible change. Waiting for the
  owner's merge approval. `main`'s copy of this file cannot list it until a commit lands on `main` (see What is next).

## Stack
Node 24 (`.node-version`, `engines 24.x`), React 19.3, Vite 8.3, React Router 8.4 (declarative), TypeScript 7, Vitest 5, Oxlint, Playwright 1.63 + axe-core.
`api/notify.ts`: Vercel function (nodemailer for Gmail, CallMeBot for WhatsApp). Database: Supabase (PostgreSQL + RLS, Edge Functions on Deno, `@supabase/supabase-js` 2.117, bundled with `rolldown`).
Hosting: Cloudflare Workers, but `api/notify.ts` is a **Vercel** function: it does not run there (Known issues). CI: GitHub Actions (`web`, `e2e`, `database`).

## Folder structure
- `src/core/` pure TypeScript business rules (pricing, blend, cart, order, orderFlow, stock, shipping, money, validation). No React.
- `src/data/`: `types.ts` the async `Api` contract, `api.ts` + `hooks.ts` (all pages use), `backend.ts` (picks the
  backend by `VITE_DATA_MODE`), `demo/` browser store + rules (demo and, until slice 2, the real site), `mode.ts`, `seed/`.
- `src/features/` one folder per section: home, shop, product, single-origin, custom-blend, b2b, cart, checkout, contact, admin.
- `src/services/` notifications and payments adapters; `src/shared/` layout, UI, cart state; `src/i18n/` AR/FR/EN dictionaries.
- `src/server/` storefront server logic (parse, guard = limits + Turnstile, prepare, storefront), unit tested; bundled into `supabase/functions/storefront/dist/index.js` by `scripts/build-functions.mjs` (not committed).
- `src/data/supabase/` database types, row mappers, catalog loader (shared by the function and, next, the site).
- `api/` notification function + tests. `supabase/migrations/` schema, `supabase/tests/` smoke, parity, race, `supabase/seed.sql` (from `scripts/seed-sql.mjs`), `supabase/config.toml`.
- `e2e/` Playwright; `tests/` architecture (section boundaries), SQL parity generator, notify contract.
- `scripts/check-real-build.mjs`, `docs/` (Arabic, 01-10), `brand/`, `public/`.

## Commands
`npm run lint | typecheck | test` · `npm run build` (real site) · `build:demo` (single HTML prototype) · `build:e2e` then `test:e2e` (browser tests) ·
`check:real-build` (after `build`) · `supabase/tests/run-local.sh` (needs PostgreSQL) · `build:functions` · `seed:sql` (regenerate `supabase/seed.sql`).

## Key decisions and why
- **Two builds from one code base** (`VITE_DATA_MODE=demo` or not). The real build has no example customers, no admin panel, no payment details, so no fake data or password can reach customers. `check:real-build` fails CI if a demo string ships. `VITE_DATA_MODE=supabase` fails the build on purpose: that layer does not exist yet.
- **The database recomputes every order** (`check_order`) and stores what it rebuilt, not what the browser sent. Why: the browser is not trusted. `tests/sql-parity.test.ts` generates `supabase/tests/parity.sql` (42 orders built by `src/core`) and CI runs it on real PostgreSQL.
- **Rounding matches PostgreSQL**: half rounds up (`money.ts`, 1e-9 nudge); stock per origin is summed as whole numbers and divided once. Why: a per-bag division produced 0.06249… against 0.0625 and refused real orders (found by an independent review, fixed).
- **Every stock reservation ends**: 48 h unpaid, 120 h after the customer says "I paid", counted from the order time; no setting turns it off (`reservationDeadline`, `expire_unpaid_orders`).
- **"I paid" is a claim, not money.** Only the owner marks paid. A paid order ends with a refund, not a plain cancel; a reported payment can be cancelled only by the owner.
- **Payment methods stay closed until real details exist** (`payeeReady`, `invalid_order:payment_details`). Nothing is invented for the RIB or Cash Plus.
- **One B2B threshold** in settings; texts read it.
- **Samples are paid bags, not a request form** (owner, 2026-09-30): a B2B blend's 250 g / 500 g bag is an ordinary order (paid before prep, delivery as usual); its 1 kg bag is refused in a cart at or under the threshold (`isBulkOnly` in `src/core/cart.ts`, line problem `bulk_only`; `check_order` raises `invalid_order:bulk_only`, since an order is never above the threshold). Why: no free-sample abuse to police, one payment path, ~26 files of sample flow removed. The 250 g prices (55 / 45 / 65 DH) are examples like the rest of the catalog. **Page titles, skip link, Escape closes the menu** (a11y findings).
- **Orders and B2B requests go through the server** (`storefront` function, `POST …/storefront/order|quote`): it
  rebuilds every figure from the database with `src/core`, then `check_order` checks them again and `commit_*` saves,
  numbers and queues the messages in one transaction. B2B request building lives in `src/core/requests.ts` so the site
  and the server build the same thing. Answers: 400 for bodies the forms never send (texts over `TEXT_MAX` included),
  200 `{ok:false, errors}` for what the customer can fix, `too_many`, `captcha`.
- **Limits against fake orders** (an unpaid order holds stock 48 h, `src/server/guard.ts`): a per-connection
  budget of 120 requests/h before the catalog is read; once an order passes every check, 5/h per phone, 10/h and
  20/day per connection (B2B requests: 3/day per phone, 20/day per connection). An IPv6 visitor counts by its /64.
  No cap on open unpaid orders per phone (tried, then removed after the second review): phones are not verified, so
  two cheap orders would lock a real customer out for 48 h, unseen; a fake order is visible and the owner frees its
  stock by cancelling it. What this does not stop: many phones and many connections. Turnstile is the real defence,
  so its keys must be set before the site takes orders; the 48 h expiry bounds the damage meanwhile.
  The visitor IP is Cloudflare's `cf-connecting-ip` only (no header = no per-connection limit, logged); checked on the
  live project: requests land in one bucket with or without a forged `x-forwarded-for`, and a forged
  `cf-connecting-ip` is refused by Cloudflare (403). Buckets carry an HMAC of the IP keyed with the server secret key
  (rotating that key resets the buckets; a separate secret would need the owner to add it in the dashboard).
  One row per bucket (`rate_limits`), the upsert locks it: 20 parallel calls with limit 5 let exactly 5 through
  (`race.sh`, in CI). Why not one row per hit with an advisory lock: the tool that applies SQL to the live project
  refused that function's text, and one row per bucket is simpler anyway.
- **Card stored off in the live database** until the CMI callback exists, so `check_order` itself refuses a card
  order nobody could pay; the server also never offers it. Turnstile is ready but off until both keys exist.
- **Starting data = the examples the site already shows** (products, prices, stock are examples; payment details
  empty). `seed-sql.mjs` refuses to run if `seed/config.ts` holds payment details (the repo is public).
- **Data contract** (2026-10-05): pages see data only through `src/data/api.ts` (async `Api`, `types.ts`) and the hooks;
  `tests/architecture.test.ts` refuses a page importing a backend. The Supabase backend fills the same `DbState`
  (store approach from `map-test`, owner approved), so storefront pages stay unchanged. Admin save buttons go through
  `useAction` (one call at a time); busy = `aria-disabled`, not `disabled`, so keyboard focus stays (a review found it lost).
- **Workflow**: branch `fix/*` or `feat/*`, independent read-only review, CI green, `merge --no-ff` into main. No pull requests unless asked. No secrets in the repo (Gmail App Password and CallMeBot key go in Vercel settings only).
- **Audit rule**: a rule counts as tested only if breaking it makes a test fail. The audit's own faults were re-run (code 3 of 58 survive, SQL 3 of 31; `docs/10` section 6).

## Known issues (evidence in PROJECT_STATUS.html section 17)
- **Hosting mismatch**: the site runs on Cloudflare Workers, `api/notify` is a Vercel function, so no message reaches WhatsApp/Gmail from the deployed site.
  With Supabase the messages are queued in `notification_outbox`; a Supabase function should send them (phase 4) and replace `api/notify`. Recommended.
- **Test rows in the live database** (still there 2026-10-05): order BC-2026-0001 (cancelled), B2B request QR-2026-0001
  (note "TEST"), 4 outbox rows `failed`, their order events and stock lines. Owner: keep them for now, delete them all
  and reset numbering to 0001 in slice 11, before launch (the tool here cannot run DELETE; SQL editor).
- The tool that applies SQL to the live project times out on some statements (any DELETE, some function texts).
  Workaround used: smaller migrations, UPDATE instead of DELETE, checks through `pg_net`.
- pg_net (in `public`, advisor warning): Supabase grants `net.*` to PUBLIC as `supabase_admin`; `postgres` cannot revoke it (`pg_net_private` had no effect).
  `net` is not exposed through the API. Moving it needs a DROP the tool here cannot run: owner can toggle pg_net off/on (Dashboard → Database → Extensions).
- Leaked password protection (advisor) needs the Pro plan: skipped by the owner; long passwords + mandatory 2FA instead.
- `skip locked` in `expire_unpaid_orders` is not tested under concurrency.
- The Supabase backend is not written yet (slices 2-10); `VITE_DATA_MODE=supabase` still fails the build on purpose.
- Before the Supabase writes (slices 8-10): admin "saved" flash shows even when a save is refused; a failed call in
  `useAction` is an unhandled rejection (no message); shipping rows, B2B notes and the stock blend switch save on every
  change without waiting (fine in the browser store, would race over the network). Storage (photos) is not in the 11 slices.
- `api/notify` rate limit is in memory per instance. Messages are written by the browser; the server checks shape only.
- A lone surrogate or NUL in a customer text: the storefront function refuses it (400, `src/server/parse.ts`, tested); the browser-only demo build does not check it.
- The status hook treats edits to `CLAUDE.md`, `README.md`, `docs/*` as code: a docs-only session gets blocked until this file changes.
- Browser tests run on Chromium only; English is not tested in a browser; tablet width (768) never checked.

## Blocked (waiting on the owner or third parties)
- Real bank account (holder, bank, RIB) and Cash Plus beneficiary: owner said "not yet time" (2026-09-30), so transfer and Cash Plus stay closed and the real site takes no paid order. `docs/07` Q23-Q25. The repo is **public**: real bank details must be entered from the admin panel after P5, not committed in `seed/config.ts`.
- Final products and prices (owner: added last), bean photos (owner: will send), delivery courier and price list (owner: researching; current fees are estimates).
- Gmail App Password and CallMeBot key (Vercel settings only). Domain `bogacafe.ma` (Nindohost ticket #581357, ANRT review). CNDP declaration. CMI contract (card).
- No owner clarification open on docs/07 wording. Q2: keep the "partner roaster" text. Q19: reply hours every day 8:00-22:00, no day off.

## Owner decisions, 2026-09-30 (answers to `docs/07`, status marks there)
- **Done in code:** no automatic free delivery (`freeShippingOver` = 0 in the seed; the team decides in Admin → Shipping).
- **Confirmed, nothing to change:** roasted-coffee stock (Q1, read from "yes"), min 5 % and 4 origins (Q6), prices are TTC (Q4; the word "TTC" is not shown in the UI yet), admin notifications in French (Q17).
- **Decided, not built:** customer confirmation goes through WhatsApp (Q10). Today the team writes by hand from the "WhatsApp au client" button; automatic WhatsApp to customers needs WhatsApp Business (CallMeBot only reaches the owner's own number). Two admins, Mohammed and Abderrahim, same full access, each with a personal login to see who came in when (Q15, P5: individual Supabase accounts, not a shared code).
- **Built:** reply hours on the contact page, every day 8:00-22:00 (Q19/Q22; `settings.contact.hours`, owner edits it in Admin → Content).
- **Built (owner approved the design):** paid samples, Q8/Q9 (see Key decisions). **Q2:** keep the site text on the partner roaster, no change.
- **Payment timing (Q11):** the owner pasted an analysis proposing weekend-aware counting of the 120 h, receipt-image upload, and WhatsApp reminders at 24 h and 4 h before cancelling. Not built. My view: weekend-aware counting is sound but lengthens how long a fake claim can hold stock (no per-phone limit yet), so do it with the P5 limit. Receipt upload needs storage plus abuse limits (P5). Customer reminders need WhatsApp Business plus a consent basis. The claim that Moroccan interbank transfers take 24-48 working hours is **not verified**.

## Owner decisions, 2026-10-05 (P5 step 3)
- Store approach from `map-test`: yes. 2FA mandatory for both owners, enforced in the database (`is_admin()` needs `aal2`).
- Login tracking: last sign-in + the existing `actor` on each change; no new table. Site URL for Turnstile/Auth:
  https://boga-cafe.mohammedboghaleb9.workers.dev/ (`bogacafe.ma` later). Notifications off during development, but
  **no real launch until the outbox sender exists**. Leaked password protection: skipped (Pro plan only).

## What is next
1. P5 step 3, one branch per slice, each merged before the next; the live site stays on the browser backend until 11:
   1 async contract (on branch) · 2 catalog read from Supabase · 3 orders via `storefront` · 4 Turnstile · 5 Supabase Auth
   sign-in · 6 TOTP 2FA + `aal2` in `is_admin()` · 7 admin reads · 8 order/stock/B2B writes · 9 catalog + `save_product`
   (from `map-test`) · 10 settings/payments/content/shipping · 11 live checks, test rows deleted, deploy from `main`.
   Then Turnstile keys and the outbox sender (phase 4). Open process point: the rule "`main` lists every open branch"
   needs a docs commit on `main` while a branch is open; the owner has not said whether that commit may go straight to `main`.
2. P6 SEO, P7 legal pages + consent banner, P9 final QA + review on real Supabase, P10 launch: 10-14 days. All remaining technical work 19-26 days (**Estimated**, PROJECT_STATUS.html §8; not a promise).

## Needs verification
- Q1 answer "yes" was read as agreeing with the default (roasted stock).
- Paid samples: tested in core (3 mutants caught), SQL (2 mutants caught), parity (42 orders, 11 B2B 250/500 g lines) and browser screenshots at 390 px (fr, ar); the `bulk_only` text in English was not seen in a browser.
- On real Supabase, checked: schema byte-identical to the files, `set_order_status` as the owner cancels and returns stock, `check_order` accepts an
  order built by `src/core` and refuses closed methods, the storefront function end to end. Not checked: RLS reads through the API (slices 2 and 7).
- Performance: Lighthouse never run; "about 150 KB gzip" comes from the build output only.
- Whether Vercel's free plan is allowed for a commercial site (Q21).
- Whether Cash Plus needs a bank-style RIB or other beneficiary data; whether a bank transfer can be recalled after it lands (Q23, Q24).
- The Stop hook in a real Claude Code session: the script is tested by hand (mtime and git mode), the harness firing was not observed.
- `map-test` @ `f9ba067`: donor only (port `save_product`, `Captcha.tsx`, guard i18n keys, missing mappers; drop samples).
