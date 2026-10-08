#!/usr/bin/env bash
# Runs the schema smoke test on a local PostgreSQL (psql must reach a server as a superuser).
# Usage: DB=boga_test ./supabase/tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB:-boga_test}"
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
# every check must print its "ok" line (audit: the script did not count them)
SMOKE=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/smoke.sql | grep '^ ok')
echo "$SMOKE"
OK=$(echo "$SMOKE" | wc -l)
EXPECTED=$(grep -c "^select 'ok " tests/smoke.sql)
[ "$OK" = "$EXPECTED" ] || { echo "only $OK of $EXPECTED smoke checks passed"; exit 1; }
# admin rights need the second factor, admin writes stay within each role (pgTAP; CI installs
# postgresql-16-pgtap). finish(true) fails on a "not ok" but not on a test that never ran: the
# count is checked against plan() here
for T in aal writes; do
  dropdb --if-exists "$DB" && createdb "$DB"
  cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
  OUT=$(psql -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f "tests/$T.sql" 2>&1) || { echo "$OUT" | grep -E '^(not )?ok|^#|ERROR'; exit 1; }
  echo "$OUT" | grep '^ok'
  PLANNED=$(sed -n 's/^select plan(\([0-9]*\));$/\1/p' "tests/$T.sql")
  [ "$(echo "$OUT" | grep -c '^ok')" = "$PLANNED" ] || { echo "$T: only $(echo "$OUT" | grep -c '^ok') of $PLANNED pgTAP tests passed"; exit 1; }
done
# the orders src/core builds are accepted by the database (tests/sql-parity.test.ts writes the file)
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/parity.sql | grep '^ ok'
# two sessions buy the same last kilo at the same moment
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
bash tests/race.sh "$DB"
