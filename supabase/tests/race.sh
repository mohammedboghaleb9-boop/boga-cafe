#!/usr/bin/env bash
# Two customers buy the same last kilo at the same moment (audit M1): two real
# sessions. The first holds its transaction open; the second must wait for it and
# then be refused with out_of_stock (commit_order locks the origin rows), not
# slip through on the old stock figure. Usage: race.sh <database> (fresh, migrated).
set -euo pipefail
DB="$1"
# a test database only, on this machine: these scripts write (salesOpen, test origins and helpers); never point them at live
case "$DB" in boga_test*) ;; *) echo "refused: $DB is not a test database (boga_test*)"; exit 1 ;; esac
case "${PGHOST:-}" in ''|/*|localhost|127.0.0.1|::1) ;; *) echo "refused: PGHOST=$PGHOST is not this machine"; exit 1 ;; esac
PSQL="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$PSQL <<'SQL'
insert into public.site_config values (1, '{"salesOpen": true, "b2bThresholdKg": 10, "bank": {"holder": "T", "bankName": "T", "rib": "T"}}', '{}');
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg)
values ('last', '{"fr": "Dernier"}', 'BR', 'arabica', 'medium', 1, 0, 200);
begin;
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('p', 'p', 'single-origin', '{"fr": "P"}', 'medium', '{"250": 60}', true);
insert into public.product_recipes values ('p', 'last', 100);
commit;
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);
insert into public.payment_methods (id, label) values ('bank_transfer', '{"fr": "Virement"}');
-- n bags of 250 g, a valid order in every figure
create function public.race_order(n int) returns jsonb language sql as $f$
  select jsonb_build_object('locale', 'fr',
    'customer', jsonb_build_object('fullName', 'Client', 'phone', '+212612345678', 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'product', 'productId', 'p', 'name', '{"fr": "P"}', 'size', 250, 'qty', n,
      'unitPrice', 60, 'lineTotal', 60 * n, 'composition', '[{"originId": "last", "percent": 100, "grams": 250}]'::jsonb)),
    'weightKg', 0.25 * n, 'subtotal', 60 * n, 'shippingFee', 20, 'total', 60 * n + 20, 'paymentMethod', 'bank_transfer',
    'stockDeductions', jsonb_build_array(jsonb_build_object('originId', 'last', 'kg', 0.25 * n)))
$f$;
SQL
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
# A: takes 0.75 kg of the 1 kg and keeps its transaction open for 2 s
$PSQL -c "begin; select number from public.commit_order(public.race_order(3), '', '', ''); select pg_sleep(2); commit;" >"$OUT/a" 2>&1 &
sleep 0.5
# B: wants 0.5 kg while A is not committed yet
if $PSQL -c "select number from public.commit_order(public.race_order(2), '', '', '')" >"$OUT/b" 2>&1; then B=ok; else B=refused; fi
wait
grep -q "BC-" "$OUT/a" || { echo "TEST FAILED: the first order did not go through"; cat "$OUT/a"; exit 1; }
[ "$B" = refused ] && grep -q "out_of_stock:last" "$OUT/b" || { echo "TEST FAILED: the second order was not refused as out of stock"; cat "$OUT/b"; exit 1; }
STOCK=$($PSQL -t -A -c "select stock_kg from public.origins where id = 'last'")
[ "$STOCK" = "0.250" ] || { echo "TEST FAILED: stock is $STOCK, expected 0.250"; exit 1; }
echo " ok race - two customers, one last kilo: the second waits, then gets out_of_stock"

# Twenty requests of one phone at the same moment, limit 5: exactly 5 get through
# (rate_limit_hit's upsert locks the bucket's row, so they are counted one by one).
for i in $(seq 20); do
  $PSQL -t -A -c "set role service_role; select public.rate_limit_hit('race:phone', 5, 3600)" >"$OUT/hit$i" 2>&1 &
done
wait
ALLOWED=$(cat "$OUT"/hit* | grep -c '^t$' || true)
REFUSED=$(cat "$OUT"/hit* | grep -c '^f$' || true)
[ "$ALLOWED" = 5 ] && [ "$REFUSED" = 15 ] || { echo "TEST FAILED: $ALLOWED allowed, $REFUSED refused, expected 5 and 15"; cat "$OUT"/hit*; exit 1; }
echo " ok race - twenty requests of one phone at once, limit 5: exactly 5 get through"

# The same order sent twice at the same moment with one key (a retry while the first
# is still saving): the second waits, then gets the first order back; stock moves once.
# back to 1 kg (the stock gate is opened for this session only)
$PSQL <<'SQL' >/dev/null
select set_config('boga.stock_write', 'on', false);
update public.origins set stock_kg = 1 where id = 'last';
SQL
KEY=b0ca0000-0000-4000-8000-0000000000aa
$PSQL -t -A -c "begin; select id || ' ' || created from public.commit_order(public.race_order(1), '', '', '', '$KEY'); select pg_sleep(2); commit;" >"$OUT/ka" 2>&1 &
sleep 0.5
$PSQL -t -A -c "select id || ' ' || created from public.commit_order(public.race_order(1), '', '', '', '$KEY')" >"$OUT/kb" 2>&1
wait
A_ID=$(grep -o '^[0-9a-f-]\{36\} true$' "$OUT/ka" | cut -d' ' -f1)
[ -n "$A_ID" ] || { echo "TEST FAILED: the first keyed order was not created"; cat "$OUT/ka"; exit 1; }
grep -q "^$A_ID false$" "$OUT/kb" || { echo "TEST FAILED: the second call did not get the first order back"; cat "$OUT/kb"; exit 1; }
ROWS=$($PSQL -t -A -c "select count(*) from public.orders where idempotency_key = '$KEY'")
STOCK=$($PSQL -t -A -c "select stock_kg from public.origins where id = 'last'")
[ "$ROWS" = 1 ] && [ "$STOCK" = "0.750" ] || { echo "TEST FAILED: $ROWS rows, stock $STOCK (expected 1 and 0.750)"; exit 1; }
echo " ok race - one key sent twice at once: the second gets the first order back, stock moves once"

# Same, when the first order takes the last kilos (review, slice 3b): the second must
# get the first order back, not "out of stock" for its own order.
$PSQL <<'SQL' >/dev/null
select set_config('boga.stock_write', 'on', false);
update public.origins set stock_kg = 0.25 where id = 'last';
SQL
KEY=b0ca0000-0000-4000-8000-0000000000bb
$PSQL -t -A -c "begin; select id || ' ' || created from public.commit_order(public.race_order(1), '', '', '', '$KEY'); select pg_sleep(2); commit;" >"$OUT/la" 2>&1 &
sleep 0.5
$PSQL -t -A -c "select id || ' ' || created from public.commit_order(public.race_order(1), '', '', '', '$KEY')" >"$OUT/lb" 2>&1 || true
wait
A_ID=$(grep -o '^[0-9a-f-]\{36\} true$' "$OUT/la" | cut -d' ' -f1)
[ -n "$A_ID" ] || { echo "TEST FAILED: the first keyed order was not created"; cat "$OUT/la"; exit 1; }
grep -q "^$A_ID false$" "$OUT/lb" || { echo "TEST FAILED: the retry did not get its order back when the stock ran out"; cat "$OUT/lb"; exit 1; }
STOCK=$($PSQL -t -A -c "select stock_kg from public.origins where id = 'last'")
[ "$STOCK" = "0.000" ] || { echo "TEST FAILED: stock is $STOCK, expected 0.000"; exit 1; }
echo " ok race - one key sent twice when the first takes the last kilos: the second gets the first order back"

# The owner closes the sales while an order is being saved (slice 12): the order holds the
# settings row (for share) until it commits, so the closing waits for it and the next order
# is refused. Neither a lost order nor a sale after the closing.
$PSQL <<'SQL' >/dev/null
select set_config('boga.stock_write', 'on', false);
update public.origins set stock_kg = 1 where id = 'last';
SQL
$PSQL -t -A -c "begin; select number from public.commit_order(public.race_order(1), '', '', ''); select pg_sleep(2); commit;" >"$OUT/ga" 2>&1 &
sleep 0.5
T0=$(date +%s%N)
$PSQL -c "update public.site_config set settings = settings || '{\"salesOpen\": false}' where id = 1" >"$OUT/gb" 2>&1
WAITED=$(( ($(date +%s%N) - T0) / 1000000 ))
wait
grep -q "BC-" "$OUT/ga" || { echo "TEST FAILED: the order in progress was lost"; cat "$OUT/ga"; exit 1; }
[ "$WAITED" -ge 1000 ] || { echo "TEST FAILED: the closing did not wait for the order in progress (${WAITED} ms)"; exit 1; }
if $PSQL -c "select number from public.commit_order(public.race_order(1), '', '', '')" >"$OUT/gc" 2>&1; then
  echo "TEST FAILED: an order went through after the closing"; cat "$OUT/gc"; exit 1
fi
grep -q "sales_closed" "$OUT/gc" || { echo "TEST FAILED: the order after the closing was not refused as sales_closed"; cat "$OUT/gc"; exit 1; }
echo " ok race - the sales closed during an order: the closing waits for it, the next order is refused"

# The other way round: the closing holds the settings row when an order arrives. The order waits, then
# reads the new setting: refused, and no order number is taken.
$PSQL <<'SQL' >/dev/null
update public.site_config set settings = settings || '{"salesOpen": true}' where id = 1;
SQL
SEQ_BEFORE=$($PSQL -t -A -c "select last_value || '/' || is_called from public.order_number_seq")
$PSQL -c "begin; update public.site_config set settings = settings || '{\"salesOpen\": false}' where id = 1; select pg_sleep(2); commit;" >"$OUT/ha" 2>&1 &
sleep 0.5
if $PSQL -c "select number from public.commit_order(public.race_order(1), '', '', '')" >"$OUT/hb" 2>&1; then
  echo "TEST FAILED: an order went through while the closing was being saved"; cat "$OUT/hb"; exit 1
fi
wait
grep -q "sales_closed" "$OUT/hb" || { echo "TEST FAILED: the waiting order was not refused as sales_closed"; cat "$OUT/hb"; exit 1; }
SEQ_AFTER=$($PSQL -t -A -c "select last_value || '/' || is_called from public.order_number_seq")
[ "$SEQ_BEFORE" = "$SEQ_AFTER" ] || { echo "TEST FAILED: the refused order took a number ($SEQ_BEFORE -> $SEQ_AFTER)"; exit 1; }
echo " ok race - an order arriving while the closing is saved waits, then is refused, and takes no number"

# One admin hides an origin while another shows a product made of it (slice 12 schema review, fixed before the
# merge): save_origin locks the origin (for update) and save_product the shown product's origins (for share)
# before their checks, so the second waits for the first, then reads what it committed and refuses. Each case
# below holds the first save open 2 s: the second must wait at least 1 s, be refused, and leave nothing saved.
$PSQL <<'SQL' >/dev/null
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.admin_users values ('00000000-0000-0000-0000-0000000000a1', 'owner', 'A'), ('00000000-0000-0000-0000-0000000000a2', 'manager', 'B');
update public.site_config set settings = settings || '{"salesOpen": true}' where id = 1;
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg, active)
select id, jsonb_build_object('fr', id), 'BR', 'arabica', 'medium', 5, 0, 200, true from unnest(array['o2', 'o3', 'o4a', 'o4b', 'o5a', 'o5b']) id;
begin;
insert into public.products (id, slug, kind, name, roast_level, prices, active) values
  ('p2', 'p2', 'single-origin', '{"fr": "P2"}', 'medium', '{"250": 60}', false),
  ('p3', 'p3', 'single-origin', '{"fr": "P3"}', 'medium', '{"250": 60}', false),
  ('p4', 'p4', 'signature', '{"fr": "P4"}', 'medium', '{"250": 60}', true),
  ('p5', 'p5', 'signature', '{"fr": "P5"}', 'medium', '{"250": 60}', true);
insert into public.product_recipes values ('p2', 'o2', 100), ('p3', 'o3', 100), ('p4', 'o4a', 100), ('p5', 'o5a', 100);
commit;
-- o4b and o5b: shown, used by no shown product yet
SQL
AS() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\": \"$1\", \"aal\": \"aal2\"}', false);"; }
OWNER=00000000-0000-0000-0000-0000000000a1; MANAGER=00000000-0000-0000-0000-0000000000a2
HIDE() { echo "select public.save_origin('{\"id\": \"$1\", \"active\": false}', (select updated_at from public.origins where id = '$1'));"; }
SHOW() { echo "select public.save_product('{\"id\": \"$1\", \"slug\": \"$1\", \"kind\": \"$2\", \"name\": {\"fr\": \"$1\"}, \"roastLevel\": \"medium\", \"prices\": {\"250\": 60}, \"active\": true, \"sortOrder\": 1}', '$3', (select updated_at from public.products where id = '$1'));"; }
# FIRST holds its save open 2 s (as one admin); SECOND (the other admin) starts 0.5 s later: it must wait, then be refused with $5
RACE() {
  local name=$1 first=$2 second=$3 expect=$4
  $PSQL -c "$(AS $MANAGER) begin; $first select pg_sleep(2); commit;" >"$OUT/r1" 2>&1 &
  local holder=$!
  # the second session starts only once the first has saved and sleeps in its open transaction (no timing guess)
  local i=0
  until [ "$($PSQL -t -A -c "select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%pg_sleep(2)%' and pid <> pg_backend_pid()")" -ge 1 ]; do
    i=$((i + 1)); [ "$i" -lt 200 ] || { echo "TEST FAILED: $name: the first save never held its transaction"; cat "$OUT/r1"; exit 1; }
    sleep 0.05
  done
  local t0; t0=$(date +%s%N)
  if $PSQL -c "$(AS $OWNER) $second" >"$OUT/r2" 2>&1; then echo "TEST FAILED: $name: the second save passed"; cat "$OUT/r1" "$OUT/r2"; exit 1; fi
  local waited=$(( ($(date +%s%N) - t0) / 1000000 ))
  wait "$holder" || { echo "TEST FAILED: $name: the first save failed"; cat "$OUT/r1"; exit 1; }
  grep -q "$expect" "$OUT/r2" || { echo "TEST FAILED: $name: refused, but not as $expect"; cat "$OUT/r2"; exit 1; }
  [ "$waited" -ge 1000 ] || { echo "TEST FAILED: $name: the second save did not wait for the first (${waited} ms)"; exit 1; }
}
STATE() { $PSQL -t -A -c "select (select active from public.products where id = '$1') || '/' || (select active from public.origins where id = '$2') || '/' || (select string_agg(origin_id, ',' order by origin_id) from public.product_recipes where product_id = '$1')"; }

# 1. the origin is hidden first: showing a product made of it waits, then is refused
RACE "hide, then show" "$(HIDE o2)" "$(SHOW p2 single-origin '[{"originId": "o2", "percent": 100}]')" hidden_origin
[ "$(STATE p2 o2)" = "false/false/o2" ] || { echo "TEST FAILED: hide, then show: state $(STATE p2 o2)"; exit 1; }
echo " ok race - an origin hidden while a product made of it is shown: the showing waits, then is refused (hidden_origin)"
# 2. the product is shown first: hiding its origin waits, then is refused
RACE "show, then hide" "$(SHOW p3 single-origin '[{"originId": "o3", "percent": 100}]')" "$(HIDE o3)" origin_in_use
[ "$(STATE p3 o3)" = "true/true/o3" ] || { echo "TEST FAILED: show, then hide: state $(STATE p3 o3)"; exit 1; }
echo " ok race - a product shown while its origin is hidden: the hiding waits, then is refused (origin_in_use)"
# 3. a shown product's recipe moves to an origin being hidden: waits, then refused; the recipe stays as it was
RACE "hide, then recipe" "$(HIDE o4b)" "$(SHOW p4 signature '[{"originId": "o4a", "percent": 50}, {"originId": "o4b", "percent": 50}]')" hidden_origin
[ "$(STATE p4 o4b)" = "true/false/o4a" ] || { echo "TEST FAILED: hide, then recipe: state $(STATE p4 o4b)"; exit 1; }
echo " ok race - a shown product's recipe changed to an origin being hidden: waits, then refused, the recipe unchanged"
# 4. a shown product's recipe takes an origin first: hiding that origin waits, then is refused
RACE "recipe, then hide" "$(SHOW p5 signature '[{"originId": "o5b", "percent": 50}, {"originId": "o5a", "percent": 50}]')" "$(HIDE o5b)" origin_in_use
[ "$(STATE p5 o5b)" = "true/true/o5a,o5b" ] || { echo "TEST FAILED: recipe, then hide: state $(STATE p5 o5b)"; exit 1; }
echo " ok race - an origin hidden while a shown product's recipe takes it: waits, then refused (origin_in_use)"

# Defence in depth: should a shown product still be made of a hidden origin (a direct write by the secret key),
# the database refuses its sale and saves nothing.
$PSQL -c "update public.origins set active = false where id = 'o3'" >/dev/null
P3_ORDER=$(echo "$($PSQL -t -A -c "select public.race_order(1)::text")" | sed 's/"productId": "p"/"productId": "p3"/; s/"originId": "last"/"originId": "o3"/g')
ORDERS_BEFORE=$($PSQL -t -A -c "select count(*) from public.orders")
STOCK_BEFORE=$($PSQL -t -A -c "select stock_kg from public.origins where id = 'o3'")
if $PSQL -c "select number from public.commit_order('$P3_ORDER'::jsonb, '', '', '')" >"$OUT/ic" 2>&1; then
  echo "TEST FAILED: the product of a hidden origin was sold"; cat "$OUT/ic"; exit 1
fi
grep -q "out_of_stock:o3" "$OUT/ic" || { echo "TEST FAILED: not refused as out_of_stock:o3"; cat "$OUT/ic"; exit 1; }
[ "$($PSQL -t -A -c "select count(*) from public.orders")" = "$ORDERS_BEFORE" ] && [ "$($PSQL -t -A -c "select stock_kg from public.origins where id = 'o3'")" = "$STOCK_BEFORE" ] \
  || { echo "TEST FAILED: something was saved for the refused order"; exit 1; }
$PSQL -c "update public.origins set active = true where id = 'o3'" >/dev/null
echo " ok race - a product of a hidden origin (written directly) is not sold: no order, no stock moved"

# Many sessions at once, 1000 calls each (deadlocks are not proved by design alone): two admins show and hide products
# made of 2 or 3 origins (recipes sent in shuffled order), two hide and show those origins, two customers buy
# them (commit_order locks the origins for update). Expected: no deadlock, no other error than the refusals
# below, and at no moment a shown product made of a hidden origin (a monitor reads it every 2 ms).
bash "$(dirname "$0")/lock-stress.sh" "$DB" 1000
# The expiry cron against admin saves (its stock returns take origins order after order, not in one sorted pass)
bash "$(dirname "$0")/lock-stress-expiry.sh" "$DB" 300

# B2B requests and the closing (slice 12), both orders of the locks. commit_quote_request holds the settings
# row (for share) before it takes a number: a closing waits for a request in progress, and a request that
# arrives during a closing waits, then is refused without a number.
$PSQL <<'SQL' >/dev/null
update public.site_config set settings = settings || '{"salesOpen": true}' where id = 1;
create function public.race_quote() returns jsonb language sql as $f$
  select jsonb_build_object('businessType', 'cafe', 'contactName', 'Client B2B', 'phone', '+212612345678', 'cityId', 'oujda',
    'lines', '[{"kind": "product", "productId": "p", "size": 1000, "qty": 12}]'::jsonb, 'weightKg', 12, 'indicativeTotal', 2400)
$f$;
SQL
QSEQ() { $PSQL -t -A -c "select last_value || '/' || is_called from public.quote_number_seq"; }
# 1. a request in progress, the closing meanwhile: the request is saved with the next number, the closing waits for it
Q0=$(QSEQ)
$PSQL -t -A -c "begin; select number from public.commit_quote_request(public.race_quote(), '', '', ''); select pg_sleep(2); commit;" >"$OUT/qa" 2>&1 &
sleep 0.5
T0=$(date +%s%N)
$PSQL -c "update public.site_config set settings = settings || '{\"salesOpen\": false}' where id = 1" >"$OUT/qb" 2>&1
WAITED=$(( ($(date +%s%N) - T0) / 1000000 ))
wait
QNUM=$(grep -o "QR-[0-9]*-[0-9]*" "$OUT/qa" || true)
[ -n "$QNUM" ] || { echo "TEST FAILED: the B2B request in progress was lost"; cat "$OUT/qa"; exit 1; }
[ "$WAITED" -ge 1000 ] || { echo "TEST FAILED: the closing did not wait for the B2B request in progress (${WAITED} ms)"; exit 1; }
# the first request of this database: number 1, the sequence moved once
[ "${QNUM##*-}" = "0001" ] && [ "$Q0" = "1/false" ] || { echo "TEST FAILED: numbering $Q0, saved $QNUM (expected the first number)"; exit 1; }
Q1=$(QSEQ)
[ "$Q1" = "1/true" ] || { echo "TEST FAILED: the sequence reads $Q1 after one saved request"; exit 1; }
if $PSQL -c "select number from public.commit_quote_request(public.race_quote(), '', '', '')" >"$OUT/qc" 2>&1; then echo "TEST FAILED: a B2B request went through after the closing"; exit 1; fi
grep -q "sales_closed" "$OUT/qc" || { echo "TEST FAILED: the request after the closing was not refused as sales_closed"; cat "$OUT/qc"; exit 1; }
[ "$(QSEQ)" = "$Q1" ] || { echo "TEST FAILED: the refused request took a number"; exit 1; }
echo " ok race - B2B: a request in progress is saved ($QNUM), the closing waits for it, the next request is refused without a number"
# 2. the closing in progress, a request meanwhile: it waits, then is refused, no number
$PSQL -c "update public.site_config set settings = settings || '{\"salesOpen\": true}' where id = 1" >/dev/null
Q2=$(QSEQ)
$PSQL -c "begin; update public.site_config set settings = settings || '{\"salesOpen\": false}' where id = 1; select pg_sleep(2); commit;" >"$OUT/qd" 2>&1 &
sleep 0.5
T0=$(date +%s%N)
if $PSQL -c "select number from public.commit_quote_request(public.race_quote(), '', '', '')" >"$OUT/qe" 2>&1; then echo "TEST FAILED: a B2B request went through while the closing was being saved"; cat "$OUT/qe"; exit 1; fi
WAITED=$(( ($(date +%s%N) - T0) / 1000000 ))
wait
grep -q "sales_closed" "$OUT/qe" || { echo "TEST FAILED: the waiting request was not refused as sales_closed"; cat "$OUT/qe"; exit 1; }
[ "$WAITED" -ge 1000 ] || { echo "TEST FAILED: the request did not wait for the closing (${WAITED} ms)"; exit 1; }
[ "$(QSEQ)" = "$Q2" ] || { echo "TEST FAILED: the refused request took a number ($Q2 -> $(QSEQ))"; exit 1; }
[ "$($PSQL -t -A -c "select count(*) from public.quote_requests")" = 1 ] || { echo "TEST FAILED: not exactly one B2B request saved"; exit 1; }
echo " ok race - B2B: a request arriving during the closing waits, then is refused, takes no number; one request saved in all ($QNUM)"
