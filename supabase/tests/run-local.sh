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
# the orders src/core builds are accepted by the database (tests/sql-parity.test.ts writes the file)
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/parity.sql | grep '^ ok'
# two sessions buy the same last kilo at the same moment
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
bash tests/race.sh "$DB"
