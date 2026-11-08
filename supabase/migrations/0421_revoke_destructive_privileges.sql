-- 0421_revoke_destructive_privileges.sql — セキュリティ再監査 Sprint 8 の SEC-001（High）、OQ-23（RYUGEN が『取り消すマイグレーションを追加』を選択）
-- 背景: Supabase は public スキーマの全テーブルに、anon / authenticated へ全権限を既定で付与する。RLS・トリガ・削除ガードは TRUNCATE を見ないため、
--   既存の約40テーブル（shifts、leave_requests、daily_reports、jyoban_reports、notices、app_profiles、staff など）でも
--   `truncate ... cascade` で全会社のデータが消える。TRIGGER 権限は、他社の管理者の操作を乗っ取る経路（テーブルにトリガを付けて関数を所有者権限で実行させる）になる。
--   0419 は人材基盤の新6テーブルだけを対象にしていた。本マイグレーションは範囲を public スキーマ全体と、後から作るテーブルの既定の権限に広げる。
-- 内容:
--   1) public スキーマの全テーブルから、anon / authenticated / public の TRUNCATE・REFERENCES・TRIGGER を取り消す。
--   2) 後から作るテーブルの既定の権限（ALTER DEFAULT PRIVILEGES）からも、同じ3つの権限を取り除く。
-- 取り消すのは破壊的な操作の権限だけ。SELECT / INSERT / UPDATE / DELETE は変えない（RLS の下で既存システムの動作を保つ）。
-- 影響の確認: リポジトリ内に、anon / authenticated で TRUNCATE・TRIGGER・REFERENCES を使うコードは無い。サーバは service_role で動く（別のロール）。
--   マイグレーションはテーブルの所有者の権限で実行されるため、トリガの作成には影響しない。
-- 安全・冪等: REVOKE のみ（何度実行しても同じ）。テーブル・列・データは変えない。
-- 注意: ALTER DEFAULT PRIVILEGES は、このマイグレーションを実行するロールが今後作るテーブルに効く。別のロールで作るテーブルが
--   ある場合は、そのロールでも同じ設定をする（運用手順）。
-- 依存: 0419

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated, public', t.relname);
  end loop;
end $$;

alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated, public;
