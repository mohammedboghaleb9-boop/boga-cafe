#!/usr/bin/env bash
# The expiry cron against admin saves (slice 12 schema review): expire_unpaid_orders returns stock order after
# order (each sorted, not across orders), with plain UPDATEs on origins. save_product's lock on the recipe's
# origins must never deadlock with it. Two admins save products of 2 or 3 origins, one session ages three
# random unpaid orders and expires them, in one transaction, again and again (no customers here: see
# PROJECT_NOTES, the expiry cron against commit_order). Expected: no deadlock, only expected refusals.
# Usage: lock-stress-expiry.sh <database> [calls per session] (after lock-stress.sh: its origins and products).
set -euo pipefail
DB="$1"
N="${2:-200}"
# a test database only, on this machine: this script writes; never point it at live
case "$DB" in boga_test*) ;; *) echo "refused: $DB is not a test database (boga_test*)"; exit 1 ;; esac
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
