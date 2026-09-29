#!/usr/bin/env bash
# Runs the schema smoke test on a local PostgreSQL (psql must reach a server as a superuser).
# Usage: DB=boga_test ./supabase/tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB:-boga_test}"
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/smoke.sql | grep '^ ok'
# the orders src/core builds are accepted by the database (tests/sql-parity.test.ts writes the file)
dropdb --if-exists "$DB" && createdb "$DB"
cat tests/00-local-auth-stub.sql migrations/*.sql tests/99-grants-like-supabase.sql | psql -q -v ON_ERROR_STOP=1 -d "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/parity.sql | grep '^ ok'
