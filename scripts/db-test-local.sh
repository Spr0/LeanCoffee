#!/usr/bin/env bash
# Runs migrations and the pgTAP suite against a throwaway local Postgres with Supabase stubs.
# Fast inner loop only; CI runs the same tests on the real Supabase stack (`supabase test db`).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${TMPDIR:-/tmp}/lc-pg
PORT=${PGPORT:-54329}
AS=""
[ "$(id -u)" = 0 ] && AS="runuser -u postgres --"
if ! $AS "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  rm -rf "$DATA" "$DATA.log"
  $AS "$PGBIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
  $AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA.log" start >/dev/null
fi
export PGHOST=/tmp PGPORT=$PORT PGUSER=postgres
psql -q -d postgres -c 'drop database if exists lc' -c 'create database lc' -c "alter database lc set search_path = \"\$user\", public, extensions" >/dev/null
P="psql -q -X -v ON_ERROR_STOP=1 -d lc"
$P -f scripts/local-supabase-stubs.sql >/dev/null
for f in supabase/migrations/*.sql; do $P -f "$f" >/dev/null || { echo "MIGRATION FAILED: $f"; exit 1; }; done
fail=0
for t in supabase/tests/*.sql; do
  out=$(psql -X -d lc -At -f "$t" 2>&1) || true
  if echo "$out" | grep -qE '^not ok|ERROR|Looks like'; then
    fail=1; echo "FAIL $t"; echo "$out" | grep -E '^not ok|ERROR|#|Looks like' | head -12
  else
    echo "ok   $t ($(echo "$out" | grep -c '^ok') assertions)"
  fi
done
exit $fail
