# Supabase (Phase 2)

- `migrations/20260927000000_init.sql`: the production schema (tables, stock functions, row-level security, notification outbox).
- `tests/`: a smoke test that runs the migration on a plain PostgreSQL and checks the business rules
  (atomic stock deduction, no overselling, permissions per role, stock returned on cancel, low-stock alert).

```bash
# local PostgreSQL 16, superuser session
./supabase/tests/run-local.sh
```

When the Supabase project exists: `supabase link` then `supabase db push`.

Until that first push, schema changes are made in the init migration itself (nothing has applied it yet). After it, every change is a new migration file: never edit one a database has already applied.
Edge Functions to write in Phase 2 are listed in `docs/05-roadmap.md` (create-order, cmi-callback, send-notifications, sample-request, quote-request).
