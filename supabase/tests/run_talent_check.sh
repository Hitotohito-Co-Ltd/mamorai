#!/usr/bin/env bash
# 0410（人材基盤）を2回適用（冪等性）し、talent_check.sql を実行する。使い方: PGPORT=5432 PGPASSWORD=… bash supabase/tests/run_talent_check.sh
set -euo pipefail
cd "$(dirname "$0")/../migrations"
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-5432} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists tln_check" -c "create database tln_check"
$P -d tln_check -f ../tests/jyoban_supabase_stub.sql >/dev/null
for f in 0400_production_onboarding 0401_pin_recovery 0402_leave_ops 0406_jyoban 0407_jyoban_report 0408_jyoban_login_device 0409_jyoban_calls 0410_talent_foundation 0410_talent_foundation; do
  $P -d tln_check -f "$f.sql" >/dev/null 2>&1 || { echo "FAILED applying $f"; exit 1; }
done
out=$($P -d tln_check -f ../tests/talent_check.sql 2>&1)
echo "$out"
if echo "$out" | grep -q FAIL; then echo "talent check FAILED"; exit 1; fi
echo "talent DB checks: all PASS"
