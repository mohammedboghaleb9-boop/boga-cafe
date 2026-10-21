#!/usr/bin/env bash
# Rehearses the SQL Editor blocks of 20261021120000_catalog_showcase on a local copy shaped like live: the 18 applied
# migrations, the previous site's catalog (supabase/seed.sql = src/data/seed) hidden without prices as live keeps it,
# a migration history ending at 20261020090000. Then: the editor block (schema, nothing listed), the listing block
# (exactly the 16 rows), the undo and the rollback; and the listing must stop, changing nothing, when the catalog is
# not the compared one. Usage: ./supabase/tests/showcase-listing.sh [db name, boga_test* only]
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${1:-boga_test_showcase}"
[[ "$DB" == boga_test* ]] || { echo "refused: $DB is not a boga_test* database"; exit 1; }
unset PGHOSTADDR PGSERVICE
M=manual/20261021120000_catalog_showcase
q() { psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

# a database as live is today: every migration but this one, the catalog hidden without prices, the history
fresh() {
  dropdb --if-exists "$DB" 2>/dev/null && createdb "$DB"
  { cat tests/00-local-auth-stub.sql tests/01-default-grants-like-supabase.sql; ls migrations/*.sql | grep -v 20261021120000 | xargs cat; cat seed.sql; } | q > /dev/null
  q > /dev/null <<'SQL'
update public.products set active = false, prices = '{}';
update public.origins set active = false, price_per_kg = null;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text);
insert into supabase_migrations.schema_migrations
select substr(f, 1, 14), substr(f, 16) from unnest(array['20260927000000_init', '20261001165327_harden', '20261001180234_rate_limits',
  '20261001180317_quote_requests', '20261001180333_expiry_cron', '20261001184715_pg_net', '20261001191318_pg_net_private',
  '20261007005011_order_idempotency_key', '20261007080308_order_idempotency_commit', '20261008205033_admin_aal2', '20261009165916_quote_follow_up',
  '20261009200000_catalog_writes', '20261012183912_settings_writes', '20261013090048_config_trim', '20261013100000_catalog_trim',
  '20261016120000_catalog_ready', '20261019200936_expiry_lock_order', '20261020090000_city_shown_needs_fee']) f;
SQL
}
# a block that must stop with this message and leave the catalog as it was
stops() {
  local block="$1" want="$2" before after out
  before=$(q -c "select md5(string_agg(to_jsonb(p)::text, '' order by id)) from public.products p")
  out=$(q -f "$block" 2>&1) && fail "$block ran, it should stop with: $want"
  grep -q "$want" <<<"$out" || fail "$block stopped with something else: $out"
  after=$(q -c "select md5(string_agg(to_jsonb(p)::text, '' order by id)) from public.products p")
  [ "$before" = "$after" ] || fail "$block changed the products while stopping"
  echo "ok - stops: $want"
}

fresh
[ "$(q -c "select count(*) from public.products")/$(q -c "select count(*) from public.origins")" = "10/6" ] || fail "the seed is not 10 products and 6 origins"
stops "$M.listing.sql" "is not applied"
out=$(q -f "$M.editor.sql")
[ "$(tail -1 <<<"$out")" = "2|0|t|t|t|f|1|2" ] || fail "editor result: $(tail -1 <<<"$out")"
echo "ok - editor block: columns 2, nothing listed, definer, path set, anon may run it, PUBLIC may not, history 1, both read rules gated"
stops "$M.editor.sql" "already there"
[ "$(q -c "set role anon; select public.showcase_catalog()")" = '{"origins": [], "products": []}' ] || fail "before the listing a visitor must see nothing"
echo "ok - before the listing a visitor reads empty lists"
before=$(q -c "select md5(string_agg(to_jsonb(p)::text, '' order by id)) from (select id, slug, kind, name, tagline, description, prices, active, featured, sort_order, image_url from public.products) p")
out=$(q -f "$M.listing.sql")
[ "$(tail -1 <<<"$out")" = "10|6|10|6|0|0" ] || fail "listing result: $(tail -1 <<<"$out")"
echo "ok - listing block: 10 products and 6 origins listed and shown, no forbidden key, nothing for sale"
after=$(q -c "select md5(string_agg(to_jsonb(p)::text, '' order by id)) from (select id, slug, kind, name, tagline, description, prices, active, featured, sort_order, image_url from public.products) p")
[ "$before" = "$after" ] || fail "the listing changed something else than listed/updated_at"
echo "ok - the listing changed nothing but the flag (and the change time)"
[ "$(q -c "set role anon; select jsonb_array_length(public.showcase_catalog() -> 'products') || '/' || jsonb_array_length(public.showcase_catalog() -> 'origins')")" = "10/6" ] \
  || fail "a visitor does not read the 16 rows"
q -c "set role anon; select public.showcase_catalog()::text" | grep -Eq '"(prices|price_per_kg|stock_kg|low_stock_kg|restock_date|active|updated_at|listed)"' \
  && fail "a visitor reads a forbidden key"
echo "ok - a visitor reads the 16 rows, without a price, stock or date key"
stops "$M.listing.sql" "already listed"
out=$(q -f "$M.unlist.sql")
[ "$(tail -1 <<<"$out")" = "0|0" ] || fail "unlist result: $(tail -1 <<<"$out")"
echo "ok - unlist: nothing listed, nothing shown"
out=$(q -f "$M.rollback.sql")
[ "$(tail -1 <<<"$out")" = "f|0|2" ] || fail "rollback result: $(tail -1 <<<"$out")"
echo "ok - rollback: no function, no column, init's read rules back"

# the listing stops, changing nothing, when the catalog is not the compared one
for change in \
  "insert into public.products (id, slug, kind, name, roast_level, active) values ('extra', 'extra', 'signature', '{\"fr\": \"Extra\"}', 'medium', false)|the products are not the 10" \
  "delete from public.product_recipes where product_id = 'so-brazil'; delete from public.products where id = 'so-brazil'|the products are not the 10" \
  "update public.products set description = jsonb_set(description, '{fr}', '\"Autre texte\"') where id = 'boga-signature'|fingerprint" \
  "update public.product_recipes set percent = percent + 10 where product_id = 'boga-signature' and origin_id = 'brazil'; update public.product_recipes set percent = percent - 10 where product_id = 'boga-signature' and origin_id = 'vietnam'|fingerprint" \
  "update public.origins set custom_blend_enabled = not custom_blend_enabled where id = 'ethiopia'|fingerprint" \
  "update public.origins set price_per_kg = 200, active = true where id = 'brazil'|for sale"; do
  fresh
  q -f "$M.editor.sql" > /dev/null
  q -c "${change%%|*}" > /dev/null
  stops "$M.listing.sql" "${change##*|}"
  [ "$(q -c "select count(*) from public.products where listed") $(q -c "select count(*) from public.origins where listed")" = "0 0" ] || fail "rows were listed"
done
dropdb "$DB"
echo "showcase blocks: all checks passed"
