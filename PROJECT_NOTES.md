# PROJECT_NOTES.md: BOGA CAFÉ

Read this first. Update it before finishing any session that changed code. Sources: `PROJECT_STATUS.html`
(status), `git log` (history), the code. Anything I could not check is under "Needs verification".
Last updated: 2026-09-30. Repo: `mohammedboghaleb9-boop/boga-cafe` (GitHub), working copy `/home/user/boga-cafe`.

## What it is
Website + online shop for BOGA CAFÉ, a whole-bean coffee brand from Oujda (Morocco). B2C and B2B:
a cart above the B2B threshold (`settings.b2bThresholdKg`, 10 kg by default) becomes a quote request.
Custom Blend (customer sets origin percentages, total must be 100). Stock in kg per origin. Arabic (RTL),
French, English. Admin roles owner / manager / staff. No cash on delivery: every order is paid before prep.

## Status (from PROJECT_STATUS.html, 2026-09-30)
- **Estimated** 59 % by item count: (25 done + 0.5 in progress) / 43. Effort left is heavier than this
  suggests: the biggest item (real backend, P5) has not started.
- `main` = `b91e7a1`, CI green (run 47). Branch `fix/remediation-3-7` = audit fixes 3-7 plus report and rules,
  CI green on every commit (runs 48-50), **not merged into main, waiting for the owner's decision**.
- Nothing is deployed. No real server: all data lives in each visitor's browser (localStorage).
- The Postgres schema (`supabase/`) is written and tested on a local PostgreSQL 16 only.

## Stack
Node 24 (`.node-version`, `engines 24.x`), React 19.3, Vite 8.3, React Router 8.4 (declarative), TypeScript 7,
Vitest 5, Oxlint, Playwright 1.63 + axe-core. `api/notify.ts`: Vercel function (nodemailer for Gmail, CallMeBot
for WhatsApp). Database target: Supabase (PostgreSQL + RLS), hosting target: Vercel. CI: GitHub Actions
(`web`, `e2e`, `database` jobs).

## Folder structure
- `src/core/` pure TypeScript business rules (pricing, blend, cart, order, orderFlow, stock, shipping, money, validation). No React.
- `src/data/` browser store + `api.ts` (simulates the server), `mode.ts` (demo vs real), `seed/` (catalog, config, demo activity).
- `src/features/` one folder per section: home, shop, product, single-origin, custom-blend, b2b, cart, checkout, contact, admin.
- `src/services/` notifications and payments adapters; `src/shared/` layout, UI, cart state; `src/i18n/` AR/FR/EN dictionaries.
- `api/` notification function + tests. `supabase/migrations/` schema, `supabase/tests/` smoke, parity, race.
- `e2e/` Playwright; `tests/` architecture (section boundaries), SQL parity generator, notify contract.
- `scripts/check-real-build.mjs`, `docs/` (Arabic, 01-10), `brand/`, `public/`.

## Commands
`npm run lint | typecheck | test` · `npm run build` (real site) · `build:demo` (single HTML prototype) ·
`build:e2e` then `test:e2e` (browser tests) · `check:real-build` (after `build`) ·
`supabase/tests/run-local.sh` (needs PostgreSQL).

## Key decisions and why
- **Two builds from one code base** (`VITE_DATA_MODE=demo` or not). The real build has no example customers, no admin panel, no payment details, so no fake data or password can reach customers. `check:real-build` fails CI if a demo string ships. `VITE_DATA_MODE=supabase` fails the build on purpose: that layer does not exist yet.
- **The database recomputes every order** (`check_order`) and stores what it rebuilt, not what the browser sent. Why: the browser is not trusted. `tests/sql-parity.test.ts` generates `supabase/tests/parity.sql` (42 orders built by `src/core`) and CI runs it on real PostgreSQL.
- **Rounding matches PostgreSQL**: half rounds up (`money.ts`, 1e-9 nudge); stock per origin is summed as whole numbers and divided once. Why: a per-bag division produced 0.06249… against 0.0625 and refused real orders (found by an independent review, fixed).
- **Every stock reservation ends**: 48 h unpaid, 120 h after the customer says "I paid", counted from the order time; no setting turns it off (`reservationDeadline`, `expire_unpaid_orders`).
- **"I paid" is a claim, not money.** Only the owner marks paid. A paid order ends with a refund, not a plain cancel; a reported payment can be cancelled only by the owner.
- **Payment methods stay closed until real details exist** (`payeeReady`, `invalid_order:payment_details`). Nothing is invented for the RIB or Cash Plus.
- **One B2B threshold** in settings; texts read it. **Page titles, skip link, Escape closes the menu** (a11y findings).
- **Workflow**: branch `fix/*`, independent read-only review, CI green, `merge --no-ff` into main. No pull requests unless asked. No secrets in the repo (Gmail App Password and CallMeBot key go in Vercel settings only).
- **Audit rule**: a rule counts as tested only if breaking it makes a test fail. The audit's own faults were re-run (code 3 of 58 survive, SQL 3 of 31; `docs/10` section 6).

## Known issues (evidence in PROJECT_STATUS.html section 17)
- No limit on open unpaid orders per phone: one visitor can hold stock for 48 h with many orders. Needs Turnstile + a per-phone limit (P5).
- `skip locked` in `expire_unpaid_orders` is not tested under concurrency.
- Pages read the whole database with `useDb()` and call `api` synchronously: moving to Supabase is **not** "swap `src/data`" (`docs/03` section 4).
- `api/notify` rate limit is in memory per instance. Messages are written by the browser; the server checks shape only.
- A lone surrogate or NUL in a customer text fails at the jsonb parse before `check_order` runs (reported by the independent reviewer, not reproduced by me).
- The status hook treats edits to `CLAUDE.md`, `README.md`, `docs/*` as code: a docs-only session gets blocked until this file changes.
- Browser tests run on Chromium only; English is not tested in a browser; tablet width (768) never checked.

## Blocked (waiting on the owner or third parties)
- Real bank account (holder, bank, RIB) and Cash Plus beneficiary: until then transfer and Cash Plus are closed. `docs/07` Q23-Q25.
- Final products, prices, bean photos (Q3); delivery price list (Q12; current fees are estimates).
- Gmail App Password and CallMeBot key (Vercel settings only). Domain `bogacafe.ma` (Nindohost ticket #581357, ANRT review). CNDP declaration. CMI contract (card).
- Answers to the 21 open questions (`/home/user/map-test/boga-questions.md`, also in `docs/07`).

## What is next
1. Owner decides whether to merge `fix/remediation-3-7` into `main` (CI green).
2. P5 real backend: Supabase project (needs owner approval), real sign-in + 2FA, `create-order` server function, scheduled expiry (pg_cron), Turnstile, async data provider.
3. P6 SEO, P7 legal pages + consent banner, P9 final QA + review on real Supabase, P10 launch. Estimate 17-28 working days of technical work (**Estimated**, not a promise).

## Needs verification
- Whether the SQL behaves the same on real Supabase: the tests use a stub for `auth.uid()` (`request.jwt.claim.sub`), real Supabase reads `request.jwt.claims`. Only C.UTF-8 locale tested.
- Performance: Lighthouse never run; "about 150 KB gzip" comes from the build output only.
- Whether Vercel's free plan is allowed for a commercial site (Q21).
- Whether Cash Plus needs a bank-style RIB or other beneficiary data; whether a bank transfer can be recalled after it lands (Q23, Q24).
- The Stop hook in a real Claude Code session: the script is tested by hand (mtime and git mode), the harness firing was not observed.
- `/home/user/map-test` is a separate git repo (branch `claude/boga-cafe-foundation`, holds only `boga-questions.md` as my change); how it relates to this repo is not verified.
