# Changelog

One dated line per meaningful change, newest first. Built from `git log`. Hashes are the commit (or the
merge into `main` when one exists). Trivial commits (initial commits, link fixes, review follow-ups) are left out.
`[branch]` = on `fix/remediation-3-7`, not merged into `main` yet.

## 2026-09-30
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
