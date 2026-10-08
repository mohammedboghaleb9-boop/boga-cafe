# PROJECT_NOTES.md: BOGA CAFÉ

Read this first. Update it before finishing any session that changed code. Sources: `PROJECT_STATUS.html`
(status; the owner reads it live at https://claude.ai/artifact/ULj6DPP9wF7bMdfWpjuFDH, republished on every change, see `CLAUDE.md`), `git log` (history), the code. Anything I could not check is under "Needs verification".
Last updated: 2026-10-08 (P5 step 3: slices 1-5 and deploy config merged, `main` = `bf5133d`; slice 6 admin TOTP on `feat/p5-s6-admin-totp`). Repo: `mohammedboghaleb9-boop/boga-cafe` (GitHub), working copy `/home/user/boga-cafe`.

## What it is
Website + online shop for BOGA CAFÉ, a whole-bean coffee brand from Oujda (Morocco). B2C and B2B:
a cart above the B2B threshold (`settings.b2bThresholdKg`, 10 kg by default) becomes a quote request.
B2B blends: 250 g and 500 g are paid samples bought like any bag; the 1 kg bag only in a cart above the threshold.
Custom Blend (customer sets origin percentages, total must be 100). Stock in kg per origin. Arabic (RTL),
French, English. Admin roles owner / manager / staff. No cash on delivery: every order is paid before prep.

## Status (2026-10-06; numbers from PROJECT_STATUS.html)
- **Estimated** 66 % by item count: (27 done + 3 partial × 0.5) / 43. P5 is in progress: server side done and merged,
  the site is not connected yet: 7-10 days left (**Estimated**: slices 4-11 = 6.75 d + outbox sender 1-1.5 d; 3b took ~1 d).
- `main` = `bf5133d`, merge of slice 5 admin sign-in (owner approved 2026-10-08; CI run 128; production build da4f77e8 success, its log says "preview values OFF (branch "main")" (owner); live bundle `index-BUfp3Opf.js` = the plain build). Slice 4 = `5acfad6`, deploy config = `a778b66`. Merged branches deleted by the owner.
- **Releases**: `main` auto-deploys to Cloudflare Workers (Workers Builds, production branch = `main`, no build variables yet). **Every merge into `main` is a release.**
  Dashboard (owner): Build command `npm run build`; Deploy command (main) `npx wrangler deploy`. Repo: `wrangler.jsonc` (assets `./dist`, SPA fallback, auto-setup's values) + wrangler 4.148.0 pinned, no Vite plugin (same 35 served files, checked).
  The Supabase switch = `VITE_DATA_MODE`/URL/key + `VITE_TURNSTILE_SITE_KEY` as Cloudflare build variables (slice 11: the dashboard's variables never reached a preview build, so likely from the repo too, see Previews). Workers Builds does not wait for GitHub CI: merge only on green.
  Deployed today: browser store, seed catalog, no admin, no payment method, **not on Supabase**, **no notifications** (Known issues).
- **Previews** (other branches): failed until 2026-10-07 ("name must match", workers-sdk#15682), fixed by `env -u WRANGLER_CI_MATCH_TAG npx wrangler versions upload` (the dashboard preview command set on 2026-10-07; **keep it**); they **pass with URLs** (build d6e0c6cb: a Version Preview URL and the alias `feat-p5-s5-admin-signin-boga-cafe.mohammedboghaleb9.workers.dev`).
  Version URLs were already on (`preview_urls: true` only states it); the Cloudflare bot's "No Preview URL" is wrong: **the build log is the source of truth**. Later edits to the Previews Base fields (Build command, Preview command, Variables) never reached a build: 35dba62d, bbe92d7c and their retries all ran `npm run build` + that `env -u` upload with "Build variables: None".
  So the preview values come from the repo: in Workers Builds (`WORKERS_CI=1`) on a branch other than `main` (`WORKERS_CI_BRANCH`; `main` is hard-coded in `vite.config.ts`), the default build uses mode `workers-preview` = `.env.workers-preview` (live Supabase URL, publishable key, Turnstile test site key; public only; a `VITE_*` already in the environment wins) and logs "Workers Builds: preview values ON|OFF (branch …)" (no line = not detected). Production, GitHub CI, local builds: same dist byte for byte (checked 2026-10-08). Confirmed on Workers Builds: the slice 5 preview ran on the live project (owner signed in there) and production build da4f77e8 logged OFF. The Previews Base dashboard fields are not used. Previews run unmerged code on the live database: once admin writes exist (slices 8-10), signing in there writes real data (decision due before slice 8, What is next).
- **Live Supabase** `boga-cafe` (ref `ldzagzskfmnjbkizbayr`, eu-west-3, free plan): 9 migrations = `supabase/migrations` (2 from slice 3b),
  catalog from `seed.sql`, two owners (one signed in on the slice 5 preview, 2026-10-08; no 2FA yet), `storefront` **v6** = slice 4 build (`5acfad6`), no `TURNSTILE_SECRET_KEY`: every form refused (500) until slice 11, no `save_product` yet. Rollout: migrations, then the function.

## Stack
Open branches: not listed here (owner, 2026-10-06): run `git branch -a` at session start; the owner tracks them in Notion.
Node 24 (`.node-version`, `engines 24.x`), React 19.3, Vite 8.3, React Router 8.4 (declarative), TypeScript 7, Vitest 5, Oxlint, Playwright 1.63 + axe-core.
`api/notify.ts`: Vercel function (nodemailer for Gmail, CallMeBot for WhatsApp). Database: Supabase (PostgreSQL + RLS, Edge Functions on Deno, `@supabase/supabase-js` 2.117, bundled with `rolldown`).
Hosting: Cloudflare Workers, but `api/notify.ts` is a **Vercel** function: it does not run there (Known issues). CI: GitHub Actions (`web`, `e2e`, `database`).

## Folder structure
- `src/core/` pure TypeScript business rules (pricing, blend, cart, order, orderFlow, stock, shipping, money, validation). No React.
- `src/data/`: `types.ts` the async `Api` contract, `api.ts` + `hooks.ts` (all pages use), `backend.ts` (picks the
  backend by `VITE_DATA_MODE`), `demo/` browser store + rules (demo and the real site today), `mode.ts`, `seed/`.
- `src/features/` one folder per section: home, shop, product, single-origin, custom-blend, b2b, cart, checkout, contact, admin.
- `src/services/` notifications and payments adapters; `src/shared/` layout, UI, cart state; `src/i18n/` AR/FR/EN dictionaries.
- `src/server/` storefront server logic (parse, guard = limits + Turnstile, prepare, storefront), unit tested; bundled into `supabase/functions/storefront/dist/index.js` by `scripts/build-functions.mjs` (not committed).
- `src/data/supabase/` types, row mappers, catalog loader (shared with the function); `store.ts`, `index.ts`, `api.ts`, `storefront.ts`, `orderCache.ts`, `adminAuth.ts`: the site's Supabase backend (catalog, orders, B2B, admin sign-in; admin data calls throw "not wired yet").
- `api/` notification function + tests. `supabase/migrations/` schema, `supabase/tests/` smoke, parity, race, `supabase/seed.sql` (from `scripts/seed-sql.mjs`), `supabase/config.toml`.
- `e2e/` Playwright; `tests/` architecture (section boundaries), SQL parity generator, notify contract.
- `scripts/check-real-build.mjs`, `docs/` (Arabic, 01-10), `brand/`, `public/`.

## Commands
`npm run lint | typecheck | test` · `npm run build` (real site) · `build:demo` (single HTML prototype) · `build:e2e` then `test:e2e` (browser tests) ·
`check:real-build` (after `build`) · `supabase/tests/run-local.sh` (needs PostgreSQL) · `build:functions` · `seed:sql` (regenerate `supabase/seed.sql`).

## Key decisions and why
- **Two builds from one code base** (`VITE_DATA_MODE=demo` or not). The real build has no example customers, no admin panel, no payment details, so no fake data or password can reach customers. `check:real-build` fails CI if a demo string ships. `VITE_DATA_MODE=supabase` builds only with `VITE_SUPABASE_URL` + publishable key (a secret key is refused) and never shows the seed catalog: loading/error screen until the live catalog arrives; seed files are marked side-effect free so that build drops them.
- **The database recomputes every order** (`check_order`) and stores what it rebuilt, not what the browser sent. Why: the browser is not trusted. `tests/sql-parity.test.ts` generates `supabase/tests/parity.sql` (42 orders built by `src/core`) and CI runs it on real PostgreSQL.
- **Rounding matches PostgreSQL**: half rounds up (`money.ts`, 1e-9 nudge); stock per origin is summed as whole numbers and divided once. Why: a per-bag division produced 0.06249… against 0.0625 and refused real orders (found by an independent review, fixed).
- **Every stock reservation ends**: 48 h unpaid, 120 h after the customer says "I paid", counted from the order time; no setting turns it off (`reservationDeadline`, `expire_unpaid_orders`).
- **"I paid" is a claim, not money.** Only the owner marks paid. A paid order ends with a refund, not a plain cancel; a reported payment can be cancelled only by the owner.
- **Payment methods stay closed until real details exist** (`payeeReady`, `invalid_order:payment_details`). Nothing is invented for the RIB or Cash Plus.
- **One B2B threshold** in settings; texts read it. **Samples are paid bags, not a request form** (owner, 2026-09-30): a B2B blend's 250 g / 500 g bag is an ordinary order (paid before prep, delivery as usual); its 1 kg bag is refused in a cart at or under the threshold (`isBulkOnly` in `src/core/cart.ts`, line problem `bulk_only`; `check_order` raises `invalid_order:bulk_only`, since an order is never above the threshold). Why: no free-sample abuse to police, one payment path, ~26 files of sample flow removed. The 250 g prices (55 / 45 / 65 DH) are examples like the rest of the catalog. **Page titles, skip link, Escape closes the menu** (a11y findings).
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
  stock by cancelling it. What this does not stop: many phones and many connections. Turnstile is the real defence
  (slice 4: checked before anything else); the 48 h expiry bounds the damage of what gets through.
  The visitor IP is Cloudflare's `cf-connecting-ip` only (no header = no per-connection limit, logged); checked on the
  live project: requests land in one bucket with or without a forged `x-forwarded-for`, and a forged
  `cf-connecting-ip` is refused by Cloudflare (403). Buckets carry an HMAC of the IP keyed with the server secret key
  (rotating that key resets the buckets; a separate secret would need the owner to add it in the dashboard).
  One row per bucket (`rate_limits`), the upsert locks it: 20 parallel calls with limit 5 let exactly 5 through
  (`race.sh`, in CI). Why not one row per hit with an advisory lock: the tool that applies SQL to the live project
  refused that function's text, and one row per bucket is simpler anyway.
- **Card stored off in the live database** until the CMI callback exists, so `check_order` itself refuses a card
  order nobody could pay; the server also never offers it. **Turnstile (slice 4)**: the function checks the token first (nothing read or counted
  before); no secret, or a Cloudflare test secret, = every form refused (500). Widget only in `supabase` mode (`src/shared/ui/Captcha.tsx`, dark, compact under 300 px, "try again"); a resend needs a fresh token. E2E waits for `.captcha[data-solved]` before a submit (it raced the token: CI flake 2026-10-07).
- **Starting data = the examples the site already shows** (products, prices, stock are examples; payment details
  empty). `seed-sql.mjs` refuses to run if `seed/config.ts` holds payment details (the repo is public).
- **Data contract** (2026-10-05): pages see data only through `src/data/api.ts` (async `Api`, `types.ts`) and the hooks;
  `tests/architecture.test.ts` refuses a page importing a backend. The Supabase backend fills the same `DbState`
  (store approach from `map-test`, owner approved), so storefront pages stay unchanged. Admin save buttons go through
  `useAction` (one call at a time); busy = `aria-disabled`, not `disabled`, so keyboard focus stays (a review found it lost).
- **Admin sign-in (slice 5)**: `Backend.admin`. Demo: role picker (`src/data/demo/session.ts`). Live: Supabase Auth email + password, own client (`boga-admin-auth`: the shop stays a visitor);
  admin = `is_admin()` true + own `admin_users` role, else signed out and "no access"; one message for every refused email/password. No sign-up/reset UI; 2FA = slice 6. Tested live by the owner on the preview (2026-10-08): real owner account, kept after reload, sign-out, wrong password = generic message. Sign-out = this browser only (scope local; removed by hand when supabase-js cannot). Browser-only build: no-admin stub, no demo password (`check-real-build`).
- **Workflow**: `fix/*`/`feat/*` branch, read-only review, CI green, `merge --no-ff`. No PRs unless asked. No secrets in the repo (Gmail/CallMeBot keys: Vercel settings only).
- **Audit rule**: a rule counts as tested only if breaking it makes a test fail. The audit's own faults were re-run (code 3 of 58 survive, SQL 3 of 31; `docs/10` section 6).

## Known issues (evidence in PROJECT_STATUS.html section 17)
- **Hosting mismatch**: the site runs on Cloudflare Workers, `api/notify` is a Vercel function, so no message reaches WhatsApp/Gmail from the deployed site.
  With Supabase the messages are queued in `notification_outbox`; a Supabase function should send them (phase 4) and replace `api/notify`. Recommended.
- **Test rows in the live database** (2026-10-06): order BC-2026-0001 (cancelled), B2B requests QR-2026-0001 and QR-2026-0002 (both closed,
  note "TEST"), 6 outbox rows `failed`, events, stock lines, rate-limit rows. Owner: delete all and reset numbering to 0001 in slice 11.
- The tool that applies SQL to the live project times out on DELETE and DROP (it waits for a confirmation nobody gives). Workaround:
  smaller migrations, UPDATE instead of DELETE, rename instead of DROP (`commit_order_before_3b`, closed to all roles; drop in slice 11), `pg_net`
  for HTTP checks (the container's network policy now refuses `*.supabase.co`, 2026-10-07: the owner can allow it in the environment settings).
- pg_net (in `public`, advisor warning): Supabase grants `net.*` to PUBLIC as `supabase_admin`; `postgres` cannot revoke it (`pg_net_private` had no effect).
  `net` is not exposed through the API. Moving it needs a DROP the tool here cannot run: owner can toggle pg_net off/on (Dashboard → Database → Extensions).
- Leaked password protection: Pro plan only, skipped (long passwords + 2FA). `skip locked` (expiry): untested under load.
- Supabase mode (slice 3): orders/B2B via `storefront` (network/4xx/5xx/unreadable = `server`); order page: tab copy (sessionStorage) else
  `get_order_public` (no phone: no message); "I have paid" = RPC; `deliver` off. Real orders refused today (`payment_method`, correct). A lost answer
  shows `server`; 3b's key makes the retry get the saved order (`orderKey.ts`: per tab, kept 24 h). supabase-js retries a failed GET.
- Slice 3b: **unavailable** = a recipe origin inactive, missing or at 0 kg (`isProductAvailable`): line shown, not priced; order refused `unavailable`;
  B2B form replaced by a notice (a crafted B2B body just drops the line). Origin emptied between check and commit = `out_of_stock`.
- Before the Supabase writes (slices 8-10): admin "saved" flash shows even when refused; a failed `useAction` call is unhandled; shipping rows,
  B2B notes and the stock blend switch save on every change without waiting (would race over the network). No Storage slice (owner, below).
- `api/notify` rate limit is in memory per instance. Messages are written by the browser; the server checks shape only.
- A lone surrogate or NUL in a customer text: the storefront function refuses it (400, `src/server/parse.ts`, tested); the browser-only demo build does not check it.
- The status hook treats `CLAUDE.md`, `README.md`, `docs/*` as code. Browser tests: Chromium only, English not in a browser, 768 px never checked.

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
  **no real launch until the outbox sender exists**. 2026-10-06: product photos stay in `public/` until after launch; no Storage slice.

## What is next
1. P5 step 3, one branch per slice, each merged before the next; the live site stays on the browser backend until 11:
   1 async contract (merged) · 2 catalog read from Supabase (merged) · 3 orders via `storefront` (merged) · 4 Turnstile (merged) · 5 Supabase Auth
   sign-in (merged) · 6 TOTP 2FA + `aal2` in `is_admin()` (branch `feat/p5-s6-admin-totp`) · 7 admin reads, and every admin write button not wired yet disabled with a visible
   "coming soon" note (owner, 2026-10-08: today they look active and do nothing) · 8 order/stock/B2B writes (before it, owner decision 2026-10-08: decide how previews may write to the live database) · 9 catalog + `save_product`
   (from `map-test`) · 10 settings/payments/content/shipping · 11 live checks, test rows deleted, drop `commit_order_before_3b`, the live same-key success test with payee details, real Turnstile keys (widget + `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`),
   siteverify `hostname` + `action` check, a build check that the site key variable holds no secret, deploy from `main`. 3b (merged): unavailable products, order key (B2B: none yet), order page by link.
   Then Turnstile keys and the outbox sender (phase 4). Before launch: the privacy page (P7) mentions the order copy kept in the tab (sessionStorage).
2. P6 SEO, P7 legal pages + consent banner, P9 final QA + review on real Supabase, P10 launch: 10-14 days. All remaining technical work 18-25 days (**Estimated**, PROJECT_STATUS.html §8; not a promise).

## Needs verification
- Paid samples: tested in core (3 mutants caught), SQL (2 mutants caught), parity (42 orders, 11 B2B 250/500 g lines) and browser screenshots at 390 px (fr, ar); the `bulk_only` text in English was not seen in a browser.
- On real Supabase, checked: schema byte-identical to the files, `set_order_status` as the owner cancels and returns stock, `check_order` accepts an
  order built by `src/core` and refuses closed methods, the storefront function end to end. Anon over HTTP (2026-10-06): 10 products, 6 origins, 20 cities, 2 methods, 1 config; 0 orders/requests/messages/admins; the supabase build in a
  browser shows the live shop and reads an order by its link. Not checked: admin reads (slice 7).
- Performance: Lighthouse never run; "about 150 KB gzip" comes from the build output only. Q1 "yes" read as the default (roasted stock); Q21 Vercel free plan for a commercial site; Q23/Q24 Cash Plus beneficiary data, can a bank transfer be recalled after it lands.
- Turnstile: real widget and siteverify never seen from here (Cloudflare blocked; e2e stand-in). Admin sign-in: tested live by the owner on the preview (2026-10-08); the second owner's sign-in not reported.
- The Stop hook firing in a real session was not observed (script tested by hand). `map-test` @ `f9ba067`: donor only (still to port: `save_product`, admin mappers; `Captcha.tsx` ported in slice 4).
