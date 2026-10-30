#!/usr/bin/env bash
# 0406_jyoban の RLS/RPC 検証を使い捨ての Postgres 16 で実行する（Supabase の auth.uid()/anon/authenticated を最小模擬）。
# 使い方: PGPORT=5439 bash supabase/tests/run_jyoban_rls_check.sh   （postgres ユーザーで起動済みのサーバに接続）
set -euo pipefail
cd "$(dirname "$0")/../migrations"
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-5439} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists jyb_check" -c "create database jyb_check"
$P -d jyb_check -f ../tests/jyoban_supabase_stub.sql
for f in 0400_production_onboarding 0402_leave_ops 0406_jyoban 0406_jyoban; do $P -d jyb_check -f "$f.sql" >/dev/null 2>&1 || { echo "FAILED applying $f"; exit 1; }; done
$P -d jyb_check -t -A -f ../tests/jyoban_rls_check.sql | tee /dev/stderr | grep -q FAIL && { echo "RLS check FAILED"; exit 1; } || echo "RLS check: all PASS"
