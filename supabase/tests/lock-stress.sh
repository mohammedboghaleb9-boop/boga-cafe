#!/usr/bin/env bash
# Many sessions at once on the same origins (slice 12): deadlocks are not proved by design alone.
# Two admins show and hide products made of 2 or 3 origins (each recipe sent in a shuffled order), two
# admins hide and show those origins, two customers buy those products (commit_order locks the origins
# for update, in id order). A monitor (one session) reads, every 2 ms, whether a shown product is made of a hidden
# origin. Expected: no deadlock, no error other than the refusals listed below, the monitor never sees
# that state, and the final state is consistent too.
# Usage: lock-stress.sh <database> [statements per session] (a database already prepared by race.sh:
# its admins, payment method and city; fresh origins and products are added here).
set -euo pipefail
DB="$1"
N="${2:-200}"
# a test database only, on this machine: these scripts write (salesOpen, test origins and helpers); never point them at live
# a bare name only (no "host=…" connection string slipped in after it), and no other way to name a server
[[ "$DB" =~ ^boga_test[A-Za-z0-9_]*$ ]] || { echo "refused: $DB is not a test database (boga_test*)"; exit 1; }
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE
case "${PGHOST:-}" in ''|/*|localhost|127.0.0.1|::1) ;; *) echo "refused: PGHOST=$PGHOST is not this machine"; exit 1 ;; esac
PSQL="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$PSQL <<'SQL' >/dev/null
update public.site_config set settings = settings || '{"salesOpen": true}' where id = 1;
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg, active)
select id, jsonb_build_object('fr', id), 'BR', 'arabica', 'medium', 10000, 0, 200, true from unnest(array['s1', 's2', 's3', 's4', 's5']) id;
begin;
insert into public.products (id, slug, kind, name, roast_level, prices, active) values
  ('sp1', 'sp1', 'signature', '{"fr": "SP1"}', 'medium', '{"250": 60}', true),
  ('sp2', 'sp2', 'signature', '{"fr": "SP2"}', 'medium', '{"250": 60}', true),
  ('sp3', 'sp3', 'signature', '{"fr": "SP3"}', 'medium', '{"250": 60}', true);
insert into public.product_recipes values ('sp1', 's1', 50), ('sp1', 's2', 50),
  ('sp2', 's2', 40), ('sp2', 's3', 40), ('sp2', 's4', 20), ('sp3', 's4', 60), ('sp3', 's5', 20), ('sp3', 's1', 20);
commit;
-- an admin shows or hides a product, its recipe sent in a random order (as invoker: the admin's own rights)
create function public.stress_product() returns void language plpgsql as $f$
declare
  p text := (array['sp1', 'sp2', 'sp3'])[1 + floor(random() * 3)::int];
  r jsonb;
begin
  select jsonb_agg(jsonb_build_object('originId', origin_id, 'percent', percent) order by random()) into r
    from public.product_recipes where product_id = p;
  perform public.save_product(jsonb_build_object('id', p, 'slug', p, 'kind', 'signature', 'name', jsonb_build_object('fr', p),
    'roastLevel', 'medium', 'prices', '{"250": 60}'::jsonb, 'active', random() < 0.6, 'sortOrder', 1),
    r, (select updated_at from public.products where id = p));
end $f$;
-- an admin hides or shows an origin
create function public.stress_origin() returns void language plpgsql as $f$
declare
  o text := (array['s1', 's2', 's3', 's4', 's5'])[1 + floor(random() * 5)::int];
begin
  perform public.save_origin(jsonb_build_object('id', o, 'active', random() < 0.5), (select updated_at from public.origins where id = o));
end $f$;
-- a customer buys one 250 g bag of a product, its composition and stock taken from the recipe as it reads it
create function public.stress_buy() returns void language plpgsql as $f$
declare
  p text := (array['sp1', 'sp2', 'sp3'])[1 + floor(random() * 3)::int];
  comp jsonb;
  ded jsonb;
begin
  select jsonb_agg(jsonb_build_object('originId', origin_id, 'percent', percent, 'grams', 250 * percent / 100) order by origin_id),
         jsonb_agg(jsonb_build_object('originId', origin_id, 'kg', 0.25 * percent / 100) order by origin_id)
    into comp, ded from public.product_recipes where product_id = p;
  perform public.commit_order(jsonb_build_object('locale', 'fr',
    'customer', jsonb_build_object('fullName', 'Client', 'phone', '+212612345678', 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'product', 'productId', p, 'name', jsonb_build_object('fr', p), 'size', 250, 'qty', 1,
      'unitPrice', 60, 'lineTotal', 60, 'composition', comp)),
    'weightKg', 0.25, 'subtotal', 60, 'shippingFee', 20, 'total', 80, 'paymentMethod', 'bank_transfer', 'stockDeductions', ded), '', '', '');
end $f$;
grant execute on function public.stress_product(), public.stress_origin() to authenticated;
SQL
OUT=$(mktemp -d)
MON=
# never leave the monitor running nor the temp folder behind, whatever stops the script
trap '[ -n "$MON" ] && { psql -q -X -d "$DB" -c "update public.stress_control set done = true" >/dev/null 2>&1; kill "$MON" 2>/dev/null; }; rm -rf "$OUT"' EXIT
AS() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\": \"$1\", \"aal\": \"aal2\"}', false);"; }
# each session's last line says it reached the end (a session that died midway never prints it)
script() { echo "$1"; for _ in $(seq "$N"); do echo "select public.$2();"; done; echo "select 'session done';"; }
script "$(AS 00000000-0000-0000-0000-0000000000a1)" stress_product >"$OUT/w1.sql"
script "$(AS 00000000-0000-0000-0000-0000000000a2)" stress_product >"$OUT/w2.sql"
script "$(AS 00000000-0000-0000-0000-0000000000a1)" stress_origin >"$OUT/w3.sql"
script "$(AS 00000000-0000-0000-0000-0000000000a2)" stress_origin >"$OUT/w4.sql"
script "" stress_buy >"$OUT/w5.sql"
script "" stress_buy >"$OUT/w6.sql"
BAD="select count(*) from public.products p join public.product_recipes r on r.product_id = p.id join public.origins o on o.id = r.origin_id where p.active and not o.active"
SAVED() { $PSQL -t -A -c "select count(*) filter (where item = 'product' and item_id like 'sp_') || ' ' || count(*) filter (where item = 'origin' and item_id like 's_') from public.catalog_changes"; }
read -r PROD0 ORIG0 < <(SAVED)
ORD0=$($PSQL -t -A -c "select count(*) from public.orders")
# the monitor: one session, one loop, reading every 2 ms until told to stop or after 10 minutes (in READ COMMITTED
# each read sees what is committed at that instant); it reports how many reads it made and how many saw the bad state
$PSQL -c "create table public.stress_control (done boolean not null); insert into public.stress_control values (false)" >/dev/null
psql -q -X -d "$DB" -c "do \$m\$ declare n int := 0; bad int := 0; t0 timestamptz := clock_timestamp(); begin
  loop
    exit when (select done from public.stress_control) or clock_timestamp() - t0 > interval '10 minutes';
    n := n + 1;
    if ($BAD) > 0 then bad := bad + 1; end if;
    perform pg_sleep(0.002);
  end loop;
  raise notice 'monitor % %', n, bad;
end \$m\$" >"$OUT/monitor" 2>&1 &
MON=$!
T0=$(date +%s%N)
PIDS=()
# at most 5 minutes per session: a lock bug that hangs sessions without a deadlock fails here, never hangs CI
for w in 1 2 3 4 5 6; do timeout 300 psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$DB" -f "$OUT/w$w.sql" >"$OUT/w$w.out" 2>"$OUT/w$w.err" & PIDS+=($!); done
FAILED_SESSIONS=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED_SESSIONS=$((FAILED_SESSIONS + 1)); done
MS=$(( ($(date +%s%N) - T0) / 1000000 ))
$PSQL -c "update public.stress_control set done = true" >/dev/null
wait "$MON" || true
MON=
[ "$FAILED_SESSIONS" = 0 ] || { echo "TEST FAILED: $FAILED_SESSIONS session(s) ended with an error or a timeout"; cat "$OUT"/w*.err | grep -v 'ERROR: ' | head; exit 1; }
for w in 1 2 3 4 5 6; do grep -qx 'session done' "$OUT/w$w.out" || { echo "TEST FAILED: session $w did not reach its end"; tail -3 "$OUT/w$w.err"; exit 1; }; done
ERRORS=$(cat "$OUT"/w*.err | grep -o 'ERROR: .*' | sed 's/:[a-z0-9]*$//' | sort | uniq -c || true)
DEADLOCKS=$(cat "$OUT"/w*.err | grep -c 'deadlock detected' || true)
[ "$DEADLOCKS" = 0 ] || { echo "TEST FAILED: $DEADLOCKS deadlock(s)"; echo "$ERRORS"; exit 1; }
# the refusals a race can give (a product hidden meanwhile: invalid_order:product; an origin hidden: out_of_stock); anything else fails
# every message psql prints starts with "psql:" (the CONTEXT lines under it do not); FATAL or a lost connection fails too
UNEXPECTED=$(cat "$OUT"/w*.err | grep '^psql' | grep -v -E 'ERROR:  (hidden_origin|origin_in_use|stale|out_of_stock:s[1-5]|invalid_order:product)$' || true)
[ -z "$UNEXPECTED" ] || { echo "TEST FAILED: unexpected output:"; echo "$UNEXPECTED" | sort | uniq -c | head; exit 1; }
READS=; SEEN=
read -r READS SEEN < <(sed -n 's/.*NOTICE:  monitor \([0-9]*\) \([0-9]*\)$/\1 \2/p' "$OUT/monitor") || true
[ -n "${READS:-}" ] && [ "$READS" -ge 200 ] || { echo "TEST FAILED: the monitor made too few reads (${READS:-none}) to watch the race"; cat "$OUT/monitor"; exit 1; }
[ "$SEEN" = 0 ] || { echo "TEST FAILED: a shown product made of a hidden origin was seen $SEEN time(s) in $READS reads"; exit 1; }
[ "$($PSQL -t -A -c "$BAD")" = 0 ] || { echo "TEST FAILED: the final state holds a shown product made of a hidden origin"; exit 1; }
# the race was really run: saves and orders went through, not only refusals
read -r PROD1 ORIG1 < <(SAVED)
PSAVED=$((PROD1 - PROD0)); OSAVED=$((ORIG1 - ORIG0)); ORDERS=$(( $($PSQL -t -A -c "select count(*) from public.orders") - ORD0 ))
MIN=$((N / 10))
[ "$PSAVED" -ge "$MIN" ] && [ "$OSAVED" -ge "$MIN" ] && [ "$ORDERS" -ge $((N / 50)) ] \
  || { echo "TEST FAILED: too little went through to test the locks ($PSAVED product saves, $OSAVED origin saves, $ORDERS orders)"; exit 1; }
echo " ok race - 6 sessions × $N calls: $PSAVED product saves, $OSAVED origin saves and $ORDERS orders went through; no deadlock, only expected refusals ($(echo "$ERRORS" | awk '{printf "%s %s; ", $1, $3}')), the monitor never saw a shown product of a hidden origin in $READS reads over ${MS} ms"
