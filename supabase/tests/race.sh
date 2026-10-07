#!/usr/bin/env bash
# Two customers buy the same last kilo at the same moment (audit M1): two real
# sessions. The first holds its transaction open; the second must wait for it and
# then be refused with out_of_stock (commit_order locks the origin rows), not
# slip through on the old stock figure. Usage: race.sh <database> (fresh, migrated).
set -euo pipefail
DB="$1"
PSQL="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$PSQL <<'SQL'
insert into public.site_config values (1, '{"b2bThresholdKg": 10, "bank": {"holder": "T", "bankName": "T", "rib": "T"}}', '{}');
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
