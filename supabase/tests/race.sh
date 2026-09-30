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
