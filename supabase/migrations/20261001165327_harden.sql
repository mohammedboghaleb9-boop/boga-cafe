-- ════════════════════════════════════════════════════════════════════
-- Live Supabase project, advisor fixes (Supabase security and performance advisors).
-- ════════════════════════════════════════════════════════════════════

-- ───────────── Supabase advisor fixes ─────────────

-- Every function runs with a fixed search_path (the others already do).
alter function public.check_recipe_total() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.guard_stock() set search_path = public;

-- Internal SECURITY DEFINER helpers are not API endpoints. admin_role() is only
-- called by is_admin(); the others are triggers, which fire without EXECUTE.
-- is_admin() stays callable: row level security runs it as the visitor, and it only
-- answers about the caller's own role.
revoke all on function public.admin_role() from public, anon, authenticated;
revoke all on function public.alert_low_stock() from public, anon, authenticated;
revoke all on function public.guard_new_origin_stock() from public, anon, authenticated;
revoke all on function public.guard_settings() from public, anon, authenticated;

-- auth.uid() once per query instead of once per row.
alter policy "see own admin row" on public.admin_users using (user_id = (select auth.uid()));

-- An order's history; the products that use an origin.
create index order_events_order_idx on public.order_events (order_id);
create index product_recipes_origin_idx on public.product_recipes (origin_id);
