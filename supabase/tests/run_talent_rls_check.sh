#!/usr/bin/env bash
# 0410_talent_foundation の RLS / 関数 検証を使い捨て Postgres 16 で実行する。
# 使い方:
#   PGPASSWORD=x PGPORT=5432 bash supabase/tests/run_talent_rls_check.sh
#   （postgres ユーザーで起動済みのサーバに接続。Supabase の auth.uid() / anon / authenticated を最小模擬）
# Postgres が起動していない場合:
#   pg_ctlcluster 16 main start
set -euo pipefail
cd "$(dirname "$0")/../migrations"
P="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-5432} -U postgres -v ON_ERROR_STOP=1 -q"
# 使い捨てデータベースを作成（冪等）
$P -c "drop database if exists tln_rls" -c "create database tln_rls"
# Supabase 互換スタブ（anon / authenticated / auth.uid() / app_is_platform / app_company_id）
$P -d tln_rls -f ../tests/jyoban_supabase_stub.sql >/dev/null
# Supabase の既定に合わせ、以後に作る関数・テーブルへ anon / authenticated の権限が既定で付く状態にする
# （これが無いと、マイグレーションの revoke を消しても検証が通ってしまう）
$P -d tln_rls -c "alter default privileges in schema public grant all on functions to anon, authenticated; alter default privileges in schema public grant all on tables to anon, authenticated;" >/dev/null
# 依存マイグレーションを適用（上番報告まで）
# 本番と同じ連鎖で検証する（0200〜0202 の FORCE RLS を含む。省くと staff の RLS が無い状態で PASS してしまう）
for f in \
  0000_base_assumed \
  0100_report_additive \
  0102_shift_additive \
  0103_notify_training_additive \
  0200_rls \
  0201_app_role \
  0202_rls_hardening \
  0400_production_onboarding \
  0401_pin_recovery \
  0402_leave_ops \
  0406_jyoban \
  0407_jyoban_report \
  0408_jyoban_login_device \
  0409_jyoban_calls \
  0410_talent_foundation \
  0410_talent_foundation \
  0411_talent_search_candidates \
  0411_talent_search_candidates \
  0412_talent_hardening \
  0412_talent_hardening \
  0413_talent_hardening2 \
  0413_talent_hardening2 \
  0414_talent_integrity \
  0414_talent_integrity \
  0415_talent_integrity2 \
  0415_talent_integrity2 \
  0416_talent_boundary_jst \
  0416_talent_boundary_jst; do   # 2回=冪等性確認
  $P -d tln_rls -f "$f.sql" >/dev/null 2>&1 || { echo "FAILED applying $f"; exit 1; }
done
# RLS/関数 検証シナリオを実行
out=$($P -d tln_rls -t -A -f "../tests/talent_rls_check.sql" 2>&1) || { echo "$out"; echo "talent RLS check: ERROR（シナリオの実行に失敗）"; exit 1; }
echo "$out"
# FAIL を含む行があれば終了コード 1
if echo "$out" | grep -q FAIL; then
  echo "talent RLS check: FAILED"
  exit 1
fi
echo "talent RLS check: all PASS"
