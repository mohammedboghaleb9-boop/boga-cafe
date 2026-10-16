#!/usr/bin/env bash
# The expiry cron under load, in two phases.
#  A. Against admin saves (slice 12 schema review): save_product's lock on the recipe's origins never deadlocks
#     with the cron's stock returns. Two admins save products of 2 or 3 origins while one session ages three
#     random unpaid orders and expires them, in one transaction, again and again.
#  B. Against orders and an admin cancelling them (20261016180000_expiry_lock_order): two customers order, an
#     admin cancels random new orders, the cron expires three random aged ones at a time. The old cron (stock
#     returned order after order) deadlocked here with commit_order. Then every order is checked: its stock
#     taken once, given back at most once and only when it is cancelled, one history line per origin each way,
#     exactly one closing event, and each origin's stock equal to its start plus its history. A failed (rolled
#     back) call leaves nothing, so the same checks cover the failures.
# Expected in both: no deadlock, every session ends, only the expected refusals, enough work done.
# Usage: lock-stress-expiry.sh <database> [calls per session] (after lock-stress.sh: its origins and products).
set -euo pipefail
DB="$1"
N="${2:-200}"
# a test database only, on this machine: this script writes; never point it at live
# a bare name only (no "host=…" connection string slipped in after it), and no other way to name a server
[[ "$DB" =~ ^boga_test[A-Za-z0-9_]*$ ]] || { echo "refused: $DB is not a test database (boga_test*)"; exit 1; }
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE
case "${PGHOST:-}" in ''|/*|localhost|127.0.0.1|::1) ;; *) echo "refused: PGHOST=$PGHOST is not this machine"; exit 1 ;; esac
PSQL="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
# unpaid orders to expire: every product shown again, then N orders of them (stock is plenty)
$PSQL >/dev/null <<SQL
update public.site_config set settings = settings || '{"salesOpen": true}' where id = 1;
update public.origins set active = true where id like 's_';
update public.products set active = true where id like 'sp_';
select public.stress_buy() from generate_series(1, $N);
create function public.stress_expire() returns void language plpgsql as \$f\$
begin
  update public.orders set created_at = now() - interval '100 hours'
   where id in (select id from public.orders where status = 'new' and created_at > now() - interval '1 hour' order by random() limit 3);
  perform public.expire_unpaid_orders();
end \$f\$;
SQL
AS() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\": \"$1\", \"aal\": \"aal2\"}', false);"; }
script() { echo "$1"; for _ in $(seq "$N"); do echo "select public.$2();"; done; echo "select 'session done';"; }
script "$(AS 00000000-0000-0000-0000-0000000000a1)" stress_product >"$OUT/w1.sql"
script "$(AS 00000000-0000-0000-0000-0000000000a2)" stress_product >"$OUT/w2.sql"
script "" stress_expire >"$OUT/w3.sql"
PIDS=()
for w in 1 2 3; do timeout 300 psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$DB" -f "$OUT/w$w.sql" >"$OUT/w$w.out" 2>"$OUT/w$w.err" & PIDS+=($!); done
FAILED_SESSIONS=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED_SESSIONS=$((FAILED_SESSIONS + 1)); done
[ "$FAILED_SESSIONS" = 0 ] || { echo "TEST FAILED: $FAILED_SESSIONS session(s) ended with an error or a timeout"; exit 1; }
for w in 1 2 3; do grep -qx 'session done' "$OUT/w$w.out" || { echo "TEST FAILED: session $w did not reach its end"; tail -3 "$OUT/w$w.err"; exit 1; }; done
DEADLOCKS=$(cat "$OUT"/w*.err | grep -c 'deadlock detected' || true)
[ "$DEADLOCKS" = 0 ] || { echo "TEST FAILED: $DEADLOCKS deadlock(s) between the expiry and the admin saves"; exit 1; }
UNEXPECTED=$(cat "$OUT"/w*.err | grep '^psql' | grep -v -E 'ERROR:  (stale)$' || true)
[ -z "$UNEXPECTED" ] || { echo "TEST FAILED: unexpected output:"; echo "$UNEXPECTED" | sort | uniq -c | head; exit 1; }
EXPIRED=$($PSQL -t -A -c "select count(*) from public.order_events where label = 'status.expired'")
[ "$EXPIRED" -ge "$N" ] || { echo "TEST FAILED: only $EXPIRED orders expired, too few to test the locks"; exit 1; }
echo " ok race - the expiry cron ($EXPIRED orders expired, 3 at a time in random age order) against $((2 * N)) admin saves: no deadlock"

# ── B. the cron against orders and an admin cancelling them ──
$PSQL -c "update public.origins set active = true where id like 's_'; update public.products set active = true where id like 'sp_'" >/dev/null
# every order still open from before is expired first, so that every expiry and cancellation counted below falls
# on an order of this phase, bought while the others ran
# plus N more, as a backlog after a cron outage: one run expires them all and holds their origins until it ends,
# so how long it takes is reported (a checkout waits that long at most)
$PSQL -c "select public.stress_buy() from generate_series(1, $N)" >/dev/null
$PSQL -c "update public.orders set created_at = now() - interval '100 hours' where status = 'new'" >/dev/null
T0=$(date +%s%N)
BACKLOG=$($PSQL -t -A -c "select public.expire_unpaid_orders()")
BACKLOG_MS=$(( ($(date +%s%N) - T0) / 1000000 ))
$PSQL >/dev/null <<SQL
-- an admin cancels a random new order (as invoker: the admin's own rights)
create function public.stress_cancel() returns void language plpgsql as \$f\$
declare
  v uuid := (select id from public.orders where status = 'new' and lines::text ~ '"sp[123]"' order by random() limit 1);
begin
  -- none left (the others took them all): nothing to do this time
  if v is not null then
    perform public.set_order_status(v, 'cancelled');
  end if;
end \$f\$;
grant execute on function public.stress_cancel() to authenticated;
SQL
COUNTS="select (select count(*) from public.orders), (select count(*) from public.orders where status = 'new'),
  (select count(*) from public.order_events where label = 'status.expired'), (select count(*) from public.order_events where label = 'status.cancelled')"
C=$($PSQL -t -A -F ' ' -c "$COUNTS"); read -r ORD0 OPEN0 EXP0 CAN0 <<<"$C"
[ "$OPEN0" = 0 ] || { echo "TEST FAILED: B: $OPEN0 order(s) still open before the phase"; exit 1; }
# a first pool of new orders, then the four sessions
$PSQL -c "select public.stress_buy() from generate_series(1, $N)" >/dev/null
script "" stress_buy >"$OUT/b1.sql"
script "" stress_buy >"$OUT/b2.sql"
script "$(AS 00000000-0000-0000-0000-0000000000a1)" stress_cancel >"$OUT/b3.sql"
script "" stress_expire >"$OUT/b4.sql"
PIDS=()
for w in 1 2 3 4; do timeout 300 psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$DB" -f "$OUT/b$w.sql" >"$OUT/b$w.out" 2>"$OUT/b$w.err" & PIDS+=($!); done
FAILED_SESSIONS=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED_SESSIONS=$((FAILED_SESSIONS + 1)); done
[ "$FAILED_SESSIONS" = 0 ] || { echo "TEST FAILED: B: $FAILED_SESSIONS session(s) ended with an error or a timeout"; exit 1; }
for w in 1 2 3 4; do grep -qx 'session done' "$OUT/b$w.out" || { echo "TEST FAILED: B: session $w did not reach its end"; tail -3 "$OUT/b$w.err"; exit 1; }; done
DEADLOCKS=$(cat "$OUT"/b*.err | grep -c 'deadlock detected' || true)
[ "$DEADLOCKS" = 0 ] || { echo "TEST FAILED: B: $DEADLOCKS deadlock(s) between the expiry cron, the orders and the cancellations"; exit 1; }
# an order cancelled by one while the other was about to: 'closed'; nothing else is expected (an order never fails)
UNEXPECTED=$(cat "$OUT"/b*.err | grep '^psql' | grep -v -E 'ERROR:  closed$' || true)
[ -z "$UNEXPECTED" ] || { echo "TEST FAILED: B: unexpected output:"; echo "$UNEXPECTED" | sort | uniq -c | head; exit 1; }
C=$($PSQL -t -A -F ' ' -c "$COUNTS"); read -r ORD1 OPEN1 EXP1 CAN1 <<<"$C"
ORDERS=$((ORD1 - ORD0)); EXPIRED=$((EXP1 - EXP0)); CANCELLED=$((CAN1 - CAN0))
# every order of the phase went through, and most were closed by the cron or the admin while the others ran
[ "$ORDERS" = $((3 * N)) ] || { echo "TEST FAILED: B: $ORDERS orders went through out of $((3 * N))"; exit 1; }
[ "$EXPIRED" -ge "$N" ] && [ "$CANCELLED" -ge $((N / 10)) ] \
  || { echo "TEST FAILED: B: too little went through ($EXPIRED expired, $CANCELLED cancelled of $ORDERS orders)"; exit 1; }
# every order of the stress (phases A and B): its stock taken once, origin by origin and to the gram, as its
# deductions say; given back the same way once, only when it is cancelled; exactly one closing event
BROKEN=$($PSQL -t -A -c "
  create function pg_temp.moves(p_ref text, p_reason text, p_sign int) returns jsonb language sql as \$f\$
    select jsonb_agg(jsonb_build_array(origin_id, p_sign * delta_kg) order by origin_id, delta_kg)
      from public.stock_movements where ref = p_ref and reason = p_reason \$f\$;
  create function pg_temp.deducted(p jsonb) returns jsonb language sql as \$f\$
    select jsonb_agg(jsonb_build_array(x ->> 'originId', (x ->> 'kg')::numeric) order by x ->> 'originId', (x ->> 'kg')::numeric)
      from jsonb_array_elements(p) x \$f\$;
  select count(*) from public.orders o
   where o.lines::text ~ '\"sp[123]\"'
     and (pg_temp.moves(o.number, 'order', -1) is distinct from pg_temp.deducted(o.stock_deductions)
       or pg_temp.moves(o.number, 'order_cancelled', 1)
          is distinct from case when o.stock_returned then pg_temp.deducted(o.stock_deductions) end
       or (o.status = 'cancelled') <> o.stock_returned
       or (select count(*) from public.order_events e where e.order_id = o.id and e.label in ('status.expired', 'status.cancelled'))
          <> case when o.status = 'cancelled' then 1 else 0 end)")
[ "$BROKEN" = 0 ] || { echo "TEST FAILED: B: $BROKEN order(s) whose stock, history or status do not agree"; exit 1; }
# each origin: its stock is its start (10000) plus its whole history, to the gram
LEDGER=$($PSQL -t -A -c "select count(*) from public.origins o where o.id like 's_' and o.stock_kg <> 10000 + coalesce((select sum(delta_kg) from public.stock_movements m where m.origin_id = o.id), 0)")
[ "$LEDGER" = 0 ] || { echo "TEST FAILED: B: $LEDGER origin(s) whose stock is not their history"; exit 1; }
# the cron expired only aged orders (the timeout is 48 h here; the stress ages them to 100 h)
FRESH=$($PSQL -t -A -c "select count(*) from public.orders o where o.created_at > now() - interval '48 hours'
  and exists (select 1 from public.order_events e where e.order_id = o.id and e.label = 'status.expired')")
[ "$FRESH" = 0 ] || { echo "TEST FAILED: B: $FRESH order(s) expired before their time"; exit 1; }
CHECKED=$($PSQL -t -A -c "select count(*) from public.orders where lines::text ~ '\"sp[123]\"'")
[ "$CHECKED" -ge $((5 * N)) ] || { echo "TEST FAILED: B: only $CHECKED orders checked (the filter no longer finds the stress orders?)"; exit 1; }
echo " ok race - one cron run on a backlog of $BACKLOG orders: ${BACKLOG_MS} ms"
echo " ok race - the expiry cron against $ORDERS orders and an admin cancelling ($EXPIRED expired, $CANCELLED cancelled): no deadlock; $CHECKED orders each with its stock taken once and given back once only when cancelled, every origin's stock equal to its history"
