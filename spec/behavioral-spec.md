# MAMOR-AI（再開発 / Tauri PC専用MVP） 行動仕様書

**作成:** Planner (#05) / プロダクト企画部 部長　**作成日:** 2026-08-10　**版:** v1.1（Spec-Validator CONDITIONAL 是正・軽微追記）
**参照:** spec/trend-research-report.md（Trend Researcher #04 / Phase 0）、MAMORAI_all_screens_v2.html（全画面モックアップ v2）
**対象:** TRAIDパイプライン Phase 1a（行動仕様策定）

---

## Executive Summary

MAMOR-AI は、中小警備会社（施設警備1号業務中心・隊員数十名規模）向けの業務管理デスクトップアプリである。既存の React+Vite / Node+Express / Supabase 資産と **6モジュール・25テーブル** を破壊的変更なしで継承し、Tauri でラップした **PC専用デスクトップMVP** として再構築する。差別化の核は (a) 最短タップで約1分で書き終える **軽量日報入力フロー**、(b) 既存 Claude API による **リスク予測エンジンとの統合表示**、(c) 中小向け低価格帯の **AIシフト最適化（LLM＋数理最適化のハイブリッド／人間確認前提）** の3点である。入力ロジックは UI から分離した **共通入力ロジック層（shared input logic layer）** として実装し、将来の Expo（スマホ）展開でそのまま再利用できる設計を最優先の設計要件とする。「日報が溜まる → リスク予測とシフト最適化の精度が上がる」というデータ循環（フライホイール）を単機能競合に対する差別化軸に据える。

## In Scope / Out of Scope

### In Scope（今回作るもの）
- **共通入力ロジック層（shared input logic layer）**: 日報・シフトの入力バリデーション、プリフィル、テンプレート解決、集計を UI から分離したドメイン層として実装（Desktop/将来Mobileで再利用）。← **最重要設計要件**
- **軽量日報（1分日報）入力フロー**: 前日・テンプレートからのプリフィル、counter/table/check/meta 型セクションによる最短タップ入力、下書き保存・提出・プレビュー。
- **日報一覧・検索・承認フロー**: 状態（未作成/下書き/提出済/承認済/差し戻し）管理、月・状態・報告者フィルタ。
- **月報集計・出力**: 報告日数/対応件数合計/インシデント/承認率の集計、インシデント種別内訳、日別推移、PDF/Excel出力。
- **リスク予測連携表示**: 既存 Claude API 予測エンジンの結果をダッシュボード・リスク予測画面へ表示（読み取り統合）。
- **シフト管理・配置表**: カレンダー型勤務表の表示・編集、日次配置表の生成、欠員検出。
- **AIシフト最適化（段階導入・後半Sprint）**: LLMで制約・要望を構造化 → 数理最適化で割付下案生成 → 管制員が確認・微修正・確定。配置理由の説明生成付き。
- **通知・業務指示 / 教育記録・資格者管理**: 重要事項/業務指示/本部通知（対象別）、教育記録一覧、資格更新間近アラート。
- **テンプレート設定**: 現場ごとにセクションのON/OFFを切り替え。
- **Tauri デスクトップ統合**: 既存 React/Vite フロントの WebView ラップ、印刷・Excel/PDF出力・自動更新の連携（Windows中心）。

### Out of Scope（今回作らないもの + 理由）
- **スマホ（Expo）UIの実装**: 本MVPは Tauri PC専用のため（trend-research 推奨5）。ただし将来のExpo展開に備え、**共通入力ロジック層の分離（REQ-001）はIn Scope** とし、UI実装のみをOutとする。
- **給与計算・請求書発行の作り込み**: 業務ロジックが重く法対応コストが高いため（trend-research「避けるべき」）。MVPは集計CSV/Excel出力で会計・給与ソフト連携に留める。
- **機械警備・AIカメラ・遠隔監視等のハード連携**: 大手/セコム系領域で開発検証コストが小規模開発のキャパを超えるため。ソフトウェアで完結させる。
- **AIによる完成シフトの全自動確定**: 現場の信頼を損なうため（trend-research「避けるべき」）。必ず管制員の確認・微修正を挟む。
- **交通誘導（2号）業務向けの日報様式・配置ロジック**: 施設警備と日報項目・配置基準が異なるため、MVP後の拡張とする（OQ-08）。
- **既存25テーブルのスキーマ改変（列削除・型変更・リネーム）**: 既存モジュールへの破壊的影響を避けるため。追加テーブル・追加列のみで実装する（REQ-025 / NFR-01）。
- **モバイル/Mac/Linux 向けビルドの品質保証**: 検証範囲を限定するため MVPは Windows(WebView2) を主対象とする（trend-research 4-1、OQ-09）。

## ユーザーペルソナ

- **管制・事務管理者「三角さん（管理者 — BHT）」**: 事務所PCで複数現場（ブルガリホテル東京 等）を横断管理。日報の承認、シフト作成、配置の欠員確認、月報のPDF/Excel出力を行う。ブラウザタブに埋もれない常駐デスクトップの快適さと、印刷・Excel連携を重視する。
- **現場責任者・隊員「藤井さん / 松葉さん」**: 勤務終わりに日報を入力。項目が多い・PCでしか書けない従来ツールに不満。前日コピーと選択式中心で **約1分で書き終える** ことを最重視。警備員の47%が60歳以上のため、大きな文字・広いタップ領域・少ない工程数が必須。
- **新任隊員「佐藤さん」**: 新任基本研修（32/45時間）受講中。教育記録・資格の進捗が可視化されることを期待。
- **将来のスマホ利用者（Expo展開後）**: 現場からスマホで日報入力する想定。共通入力ロジック層の再利用により、Desktopと同一の検証・集計挙動が保証されることを期待。

## スプリント計画

| Sprint | テーマ | REQ数 | リスク | 変更対象ファイル（追加が基本） |
|--------|------|-------|--------|----------------|
| Sprint 1 | 共通入力ロジック層 + 軽量日報コア | 7 | Mid〜High | packages/input-core/src/report/model.ts, .../report/validation.ts, .../report/prefill.ts, .../report/template.ts, .../types.ts, supabase/migrations/0100_report_additive.sql |
| Sprint 2 | 月報集計 + 日報一覧・承認・リスク連携 | 7 | Mid〜High | packages/input-core/src/report/aggregate.ts, .../report/workflow.ts, .../report/search.ts, packages/input-core/src/risk/view.ts, apps/desktop/src/features/month/*, server/routes/risk.ts |
| Sprint 3 | シフト/配置表 + AIシフト最適化 | 7 | High | packages/input-core/src/shift/model.ts, .../shift/constraints.ts, .../shift/assignment.ts, server/routes/shift-optimize.ts, server/services/optimizer.ts, server/services/claude.ts |
| Sprint 4 | 通知・教育記録 + テンプレート設定 + Tauri統合 | 6 | Mid | packages/input-core/src/notify/model.ts, .../training/model.ts, .../template/config.ts, apps/desktop/src-tauri/src/main.rs, apps/desktop/src-tauri/tauri.conf.json |

> 順序の根拠: 共通入力ロジック層（REQ-001）と日報モデルが全機能の土台のため Sprint1 に先行。月報・一覧・リスク連携は日報データに依存するため Sprint2。シフト/AI最適化は最も不確実性が高くPoC結果に左右されるため後半のSprint3（trend-research 推奨1「AIシフトは日報の次」）。通知・教育・Tauri統合は独立性が高く仕上げ工程として Sprint4。

---

## 要件定義（EARS形式）

### REQ-001: 共通入力ロジック層（shared input logic layer）の UI 分離
**EARS:** THE システム SHALL 日報・シフトの入力バリデーション・プリフィル・テンプレート解決・集計ロジックを、UI（React/Tauri）およびデータアクセス（Supabase）から独立した純粋関数中心の共通ドメイン層（packages/input-core）として提供し、DesktopとMobile(将来のExpo)から同一APIで呼び出せるようにする
**リスク:** High — この分離が崩れると将来のExpo再利用が不可能になり、差別化戦略（横展開）の前提が失われる。層の責務境界を初期に固定する必要がある
**依存:** なし（基盤REQ）
**Sprint:** 1
**テスト可能性:** Vitest: input-core の各関数が DOM/Supabaseクライアントに一切依存せず（import禁止をlint/テストで検証）、同一入力に対し同一出力を返す純粋性を検証。UI・DB非依存でユニットテスト可能なことをカバレッジで担保

### REQ-002: 日報テンプレートのセクション型定義と解決
**EARS:** THE システム SHALL 日報テンプレートを meta / table / counter / check / gate の5セクション型で定義し、現場ごとの有効セクション構成を共通入力ロジック層で解決して入力フォーム構造を返す
**リスク:** Mid — セクション型の抽象化を誤ると新様式追加のたびに改修が必要になる。モックの「10セクション/69項目」を型で表現できるか検証が要る
**依存:** REQ-001
**Sprint:** 1
**テスト可能性:** Vitest: テンプレート定義（有効セクションのリスト）から、期待されるセクション型・項目数のフォーム構造が生成されることを検証

### REQ-003: 前日・テンプレートからのプリフィル（1分日報の核）
**EARS:** WHEN 隊員が日報入力を開始する THE システム SHALL 直近の承認済/提出済日報または現場テンプレートの既定値を初期値として各セクションにプリフィルする
**リスク:** Mid — プリフィルの対象選定（前日か直近提出か）を誤ると誤った値が引き継がれ現場の記録品質が下がる（OQ-02）
**依存:** REQ-001, REQ-002
**Sprint:** 1
**テスト可能性:** Vitest: 直近日報の内容とテンプレート既定値から、正しいプリフィル済み初期フォーム値が生成されることを検証（承認済優先ルールの分岐含む）

### REQ-004: 軽量日報（1分日報）の最短入力フロー
**EARS:** WHEN 隊員がプリフィル済みフォームで counter の増減・select の選択・check のトグルのみを操作し提出操作を行う THE システム SHALL 追加のテキスト自由入力を必須とせずに日報レコードを生成できるようにする
**リスク:** High — 「最短タップ・約1分」という中核差別化。必須項目が多いと1分日報が成立しない。必須項目の最小集合はOQ-01で確定が必要
**依存:** REQ-002, REQ-003, REQ-006
**Sprint:** 1
**テスト可能性:** Vitest: 自由入力を空のまま counter/select/check のみを設定した入力で日報レコードが正常生成されること、および入力操作数（タップ換算）が定義閾値以内であることをロジックレベルで検証

### REQ-005: 日報の下書き保存
**EARS:** WHEN 隊員が日報入力中に下書き保存操作を行う THE システム SHALL 未完成状態の日報を status="下書き" で保存し、後で再開できるようにする
**リスク:** Low — 標準的な永続化。ただし部分入力（必須未充足）でも保存できる分岐が必要
**依存:** REQ-001, REQ-006
**Sprint:** 1
**テスト可能性:** Vitest: 必須項目未充足の入力でも下書きとして保存可能で、再読込時に入力値が復元されることを検証

### REQ-006: 日報の入力バリデーション（共通層）
**EARS:** WHEN 日報が提出（status="提出済"へ遷移）されようとする THE システム SHALL 共通入力ロジック層で必須項目・数値範囲・時刻整合（開始<終了、翌日跨ぎ）を検証し、不備があれば提出を拒否して違反項目を返す
**リスク:** Mid — バリデーションがUI側に漏れるとExpo再利用時に挙動差異が生じる。翌日跨ぎ（例「翌9:00」）の時刻整合ロジックに注意
**依存:** REQ-001
**Sprint:** 1
**テスト可能性:** Vitest: 必須欠落・数値範囲外・時刻逆転・翌日跨ぎの各ケースで期待どおりの違反リストが返ること、正常系で違反ゼロになることを境界値で検証

### REQ-007: 既存日報データとの後方互換保持（追加のみ）
**EARS:** THE システム SHALL NOT 既存の日報関連テーブルの列削除・型変更・リネームを行い、新機能に必要なデータは追加テーブルまたは NULL 許容の追加列としてのみ実装する
**リスク:** High — 既存6モジュールへの破壊的変更は稼働中データの毀損に直結。追加のみ制約は全Sprint横断で厳守が必要（NFR-01の日報領域への具体化）
**依存:** REQ-001
**Sprint:** 1
**テスト可能性:** Vitest/マイグレーションテスト: 既存スキーマのスナップショットと比較し、DROP/ALTER TYPE/RENAME を含まないこと、既存列が保持されることを検証（DB層はDatabase Engineerが結合テストで確認）

### REQ-008: 日報の提出・承認・差し戻しワークフロー
**EARS:** WHEN 承認者が提出済（status="提出済"）の日報に対し承認または差し戻し操作を行う THE システム SHALL status を "承認済" または "差し戻し" に遷移させ、承認者・処理時刻を記録する
**リスク:** Mid — 状態遷移の制約（下書き→提出済→承認済/差し戻し）を誤ると不正な承認が発生。差し戻し後の再提出フローの定義が要る
**依存:** REQ-006
**Sprint:** 2
**テスト可能性:** Vitest: 許可された状態遷移のみ成功し、不正遷移（例 下書きから承認済への直接遷移）が拒否されることを状態遷移マトリクスで検証

### REQ-009: 日報一覧の検索・フィルタ
**EARS:** WHEN 管理者が日報一覧で対象月・状態・報告者・キーワードを指定する THE システム SHALL 条件に合致する日報のみを一覧として返す
**リスク:** Mid — データ増加時のパフォーマンス劣化（N+1・インデックス設計）に注意。「未作成」日（レコード非存在）の扱いを定義する必要
**依存:** REQ-008
**Sprint:** 2
**テスト可能性:** Vitest: 複合条件フィルタが正しい結果集合を返すこと、レコード非存在日が「未作成」として補完されることを検証

### REQ-010: 業務対応件数（counter）の集計
**EARS:** WHEN 月報が対象月について生成される THE システム SHALL 当月の全日報の counter セクション（巡回時未施錠・ELV呼出・カード登録 等）を項目別に合算し集計値を返す
**リスク:** Mid — テンプレートで項目ON/OFFが現場ごとに異なるため、項目差異を吸収した集計ロジックが必要
**依存:** REQ-002, REQ-008
**Sprint:** 2
**テスト可能性:** Vitest: 複数日報の counter 配列から項目別合計が正しく算出されること、テンプレート差異（項目欠落）でも欠損扱いにならないことを検証

### REQ-011: 月報サマリーの集計
**EARS:** WHEN 管理者が月報画面で対象月を選択する THE システム SHALL 報告日数・対応件数合計・インシデント件数・承認率を集計して表示する
**リスク:** Mid — 承認率の分母定義（提出済/全対象日/作成済）が曖昧だと数値が現場感覚とずれる（OQ-04）
**依存:** REQ-008, REQ-010
**Sprint:** 2
**テスト可能性:** Vitest: 既知の日報データ集合に対し4指標（報告日数/対応件数合計/インシデント/承認率）が期待値どおり算出されることを検証

### REQ-012: インシデント種別内訳と日別推移の集計
**EARS:** WHEN 月報が生成される THE システム SHALL インシデントを種別ごとに集計し前月比を付与するとともに、日別対応件数の時系列データを返す
**リスク:** Low — 集計ロジックは REQ-010/011 の延長で難易度は低い。前月データ非存在時の前月比表示に注意
**依存:** REQ-010, REQ-011
**Sprint:** 2
**テスト可能性:** Vitest: 種別別件数と前月比（±0・増減・前月データなし）、日別配列が正しく生成されることを検証

### REQ-013: 月報の PDF / Excel 出力
**EARS:** WHEN 管理者が月報画面で PDF出力 または Excel出力 を実行する THE システム SHALL 集計済み月報を該当形式のファイルとして生成する
**リスク:** Mid — レイアウト再現とTauri環境での保存/印刷連携（REQ-024）に依存。出力フォーマット確定はOQ-07
**依存:** REQ-011, REQ-012
**Sprint:** 2
**テスト可能性:** Vitest: 月報集計データから出力用の中間データ構造（行・列・ヘッダ）が正しく生成されることを検証。実ファイル生成・印刷は結合テストで確認

### REQ-014: リスク予測結果の連携表示
**EARS:** WHEN 管理者がダッシュボードまたはリスク予測画面を開く THE システム SHALL 既存 Claude API 予測エンジンが返すリスク項目（種別・ポジション・リスク度・発生確率・要因タグ）を取得し、リスク度降順でランキング表示する
**リスク:** High — 予測エンジンはクライアントから直叩きせず既存 Node/Express ゲートウェイ経由とする必要（APIキー露出・課金保護、trend-research 4-3）。エンジンのI/F仕様確認が必要（OQ-05）
**依存:** REQ-001
**Sprint:** 2
**テスト可能性:** Vitest: 予測APIレスポンス（モック）から、リスク度降順ソート・High/Mid/Low分類・フィルタ（種別/ポジション）が正しく適用されることを検証

### REQ-015: リスク予測のフィルタと絞り込み
**EARS:** WHEN 管理者がリスク予測画面でインシデント種別・ポジション・並び替え条件を指定する THE システム SHALL 条件に合致するリスク項目のみを指定順で返す
**リスク:** Low — クライアント側の絞り込みロジックで難易度は低い
**依存:** REQ-014
**Sprint:** 2
**テスト可能性:** Vitest: 種別/ポジション絞り込みとリスク度/確率の並び替えが正しく機能することを検証

### REQ-016: シフト（勤務表）の表示・編集
**EARS:** WHEN 管理者がシフト管理画面で対象月を選択する THE システム SHALL スタッフ×日付のカレンダー型勤務表（日勤/夜勤/明休/公休/研修 等の勤務区分）を表示し、セル単位の編集を保存できるようにする
**リスク:** High — 既存シフトデータ構造が未確認（OQ-06）。既存25テーブルの構造に追加のみで載せられるか検証が必要
**依存:** REQ-001, REQ-007
**Sprint:** 3
**テスト可能性:** Vitest: 勤務区分の割当・変更が共通層のシフトモデルに正しく反映され、月内の勤務区分集計（契約人区数）が算出されることを検証
**設計注記（v1.1 / HIGH-1）:** セル単位の手動編集は既存 `shifts` に触れず、追加テーブル `shift_overrides`（`source='manual'`・現場スコープRLS）へ保存する。実運用シフト表は「既存 `shifts` ＋ `shift_overrides` のマージ」で解決（database-design.md §3.5 / architecture.md ADR-008）。既存 `shifts` 実DDL判明（OQ-DB1/UQ-12）後に載せ替え可否を再判定。

### REQ-017: 日次配置表の生成と欠員検出
**EARS:** WHEN 管理者が配置表画面で対象日を選択する THE システム SHALL 当日のシフトからポジション別（責任者/日勤A・B/夜勤A・B）の配置表を生成し、担当者未割当のポジションを「欠員」として明示する
**リスク:** Mid — ポジション定義と必要人数（配置基準）が現場ごとに異なるため、基準データの持ち方に注意（OQ-06）
**依存:** REQ-016
**Sprint:** 3
**テスト可能性:** Vitest: シフトデータから日次配置表が生成され、担当者nullのポジションが欠員として抽出されること（欠員ゼロ/複数の境界）を検証

### REQ-018: AIシフト最適化の制約構造化（LLM）
**EARS:** WHEN 管理者がAIシフト最適化を開始し自然言語の要望・制約（希望休・資格要件・勤務間隔 等）を入力する THE システム SHALL 既存 Claude API を用いて要望を構造化された制約データへ変換する
**リスク:** High — LLM出力の不確実性。制約の取りこぼしは違法・不当な配置に直結。割付そのものはLLMに委ねない（trend-research 推奨2）。制約項目の網羅はOQ-03
**依存:** REQ-016
**Sprint:** 3
**テスト可能性:** Vitest: Claude APIレスポンス（モック）から、期待される制約データ構造（有資格・勤務間隔・希望休・必要人数）へのパースが正しく行われ、想定外出力時にエラーを返すことを検証

### REQ-019: AIシフト最適化の割付下案生成（数理最適化）
**EARS:** WHEN 構造化された制約データが与えられる THE システム SHALL 制約付き最適化により、資格・休日・勤務間隔・配置基準を満たすシフト割付の下案を1つ以上生成する
**リスク:** High — 最適化ソルバーで警備制約が解けるかはPoC依存（trend-research 推奨6）。計算はサーバ側で実行しクライアント直叩きしない。制約充足不能時の扱いを定義する必要
**依存:** REQ-018
**Sprint:** 3
**テスト可能性:** Vitest: 小規模な制約データ集合に対し、生成された割付が全ハード制約（資格・勤務間隔・必要人数）を違反しないことを検証。充足不能ケースで違反理由が返ることを検証

### REQ-020: シフト下案の管制員による確認・微修正・確定
**EARS:** WHEN AIが生成したシフト下案が管制員に提示される THE システム SHALL 管制員が下案を確認・手動修正した上でのみ確定でき、AIが自動で確定することを行わない
**EARS(否定):** THE システム SHALL NOT 管制員の確認操作を経ずにAI生成シフトを確定状態にする
**リスク:** High — 全自動確定は現場の信頼を損なう（trend-research「避けるべき」）。確定前の人間ゲートは必須要件
**依存:** REQ-019
**Sprint:** 3
**テスト可能性:** Vitest: 確認フラグ無しのシフト確定要求が拒否されること、管制員修正後の確定でのみ status="確定" へ遷移することを検証
**設計注記（v1.1 / HIGH-2・HIGH-3）:** 確定操作および最適化結果の書込はクライアント直結を許さず、service_role を持つ Node/Express の専用RPC経由に限定する（AI経路テーブルはフロントSELECTのみ）。確定後は Node の反映処理が確定割当を `shift_overrides`（`source='ai_apply'`）へ冪等 upsert して実運用シフトへ反映する（architecture.md ADR-008 / database-design.md §3.5・§4 群B）。

### REQ-021: シフト配置理由の説明生成（説明可能性）
**EARS:** WHEN AIシフト下案が生成される THE システム SHALL 各割付について「なぜこの配置か」（充足した制約・優先根拠）の説明テキストを付与する
**リスク:** Mid — 説明が実際の割付根拠と乖離すると誤誘導になる。最適化結果とLLM説明の整合性担保が必要
**依存:** REQ-019
**Sprint:** 3
**テスト可能性:** Vitest: 割付結果に対し、参照した制約に基づく説明データが各割当に付与されること、説明が存在しない割当がないことを検証

### REQ-022: 通知・業務指示の作成と対象別配信
**EARS:** WHEN 管理者が通知を作成し種別（重要事項/業務指示/本部通知）と対象（全員/夜勤者/特定現場 等）を指定する THE システム SHALL 対象に一致する利用者に通知を配信し、未確認件数を集計できるようにする
**リスク:** Mid — 対象の絞り込み条件（役割・勤務種別・現場）が曖昧だと誤配信が起きる
**依存:** REQ-007
**Sprint:** 4
**テスト可能性:** Vitest: 種別・対象条件から配信対象集合が正しく決定され、未確認件数が集計されることを検証

### REQ-023: 教育記録・資格者管理と更新間近アラート
**EARS:** WHILE 資格の有効期限が基準日数以内に迫っている THE システム SHALL 該当資格者を「更新間近」として抽出し、教育記録（研修種別・時間・進捗）とあわせて管理画面に表示する
**リスク:** Mid — 「更新間近」の基準日数が未確定（OQ-10）。法定研修時間（例 新任45時間）の要件確認が必要
**依存:** REQ-007
**Sprint:** 4
**テスト可能性:** Vitest: 有効期限と基準日数から「有効/更新間近/期限切れ」の分類、および研修進捗（32/45h等）の達成率算出が正しいことを境界値で検証

### REQ-024: テンプレート設定によるセクションON/OFF
**EARS:** WHEN 管理者がテンプレート設定画面で現場のセクションをON/OFF切替し保存する THE システム SHALL 該当現場の日報入力フォーム（REQ-002の解決結果）に設定を反映する
**リスク:** Mid — 既に日報が存在するセクションをOFFにした際の過去データ・集計（REQ-010）への影響を定義する必要
**依存:** REQ-002
**Sprint:** 4
**テスト可能性:** Vitest: セクションのON/OFF設定が REQ-002 のフォーム解決に反映され、OFFセクションが入力対象から除外されること、過去集計が壊れないことを検証

### REQ-025: Tauri デスクトップ統合（WebViewラップ・印刷・出力・自動更新）
**EARS:** WHERE アプリが Tauri デスクトップ（Windows/WebView2 主対象）として動作している THE システム SHALL 既存 React/Vite フロントを WebView でラップし、ローカルでの印刷・PDF/Excelファイル保存・アプリ自動更新を提供する
**リスク:** Mid — WebView2 のレンダリング差異・ランタイム配布の検証が必要（trend-research 4-1、OQ-09）。Rust側実装は最小限（保存・印刷・更新）に留める
**依存:** REQ-013
**Sprint:** 4
**テスト可能性:** Vitest: フロント側の保存/印刷呼び出しが Tauri API 抽象（モック）を正しく呼ぶことを検証。実機での印刷・自動更新・WebView2挙動は結合/E2Eで別途確認

---

## 非機能要件（NFR / 制約）

### NFR-01: 既存25テーブルへの追加のみ制約（破壊的変更禁止）
**EARS:** THE システム SHALL NOT 既存25テーブルおよび6モジュールに対し列削除・型変更・リネーム・非互換な制約追加を行い、全ての新機能を追加テーブル・NULL許容の追加列・追加ビューとしてのみ実装する
**リスク:** High — 稼働中データ・既存機能の毀損リスク。全Sprint横断の絶対制約
**テスト可能性:** マイグレーション差分の静的検査（DROP/RENAME/ALTER TYPE検出）＋既存スキーマスナップショット比較

### NFR-02: 低ITリテラシー・高齢層向けアクセシビリティ
**EARS:** THE システム SHALL 日報入力の主要導線について、**本文フォント ≧ 16px・操作対象（ボタン/タップ領域）≧ 44×44px・1分日報の操作工程数 ≦ 10タップ**（いずれも暫定値。最終値はOQ-01で確定）を満たす
**リスク:** Mid — 警備員の47%が60歳以上（trend-research 1-2）。上記は測定軸を明示した暫定基準で、確定値はOQ-01（UQ-03）で置換する（「十分な」等の曖昧語を排除／MEDIUM-3是正）
**テスト可能性:** UIコンポーネントテストで最小フォント（≧16px）・最小タップ領域（≧44×44px）・操作ステップ数（≦10）の各下限/上限を検証（閾値はOQ-01確定値に追随）

### NFR-03: セキュリティ境界（APIキー保護・RLS）
**EARS:** THE システム SHALL Claude API キーおよびシフト最適化計算をクライアント（Tauri/フロント）から直接実行せず既存 Node/Express ゲートウェイ経由とし、Supabase 直結部分は RLS でテナント/現場ごとにデータを分離する
**リスク:** High — 直結構成では RLS が唯一の防御線（trend-research 4-3）。Security Engineer #14 が別途審査
**テスト可能性:** クロスユーザーテストで担当外現場のクエリが空/エラーになること、フロントバンドルにAPIキーが含まれないことを検証

### NFR-04: パフォーマンス
**EARS:** WHILE 日報・シフトのデータ量が増加している（**代表データ量: 1現場あたり日報36,000件≒3年分・スタッフ50名**） THE システム SHALL 一覧・集計クエリのN+1を回避し、**主要画面（日報一覧・月報・シフト表）の表示応答を P95 < 1.5秒**（初期表示・上記データ量・ローカルネットワーク条件）に保つ
**リスク:** Mid — インデックス設計・集計クエリ最適化が必要（Database Engineer連携）。上記数値は暫定基準（代表データ量・目標値の確定は運用データ判明後に見直す。「実用範囲」の曖昧語を排除／MEDIUM-2是正）
**テスト可能性:** 代表データ量（上記）を投入し主要画面の応答時間を計測し **P95 < 1.5s** を合否線とする。`EXPLAIN ANALYZE` で対象クエリにN+1・不要Seq Scanが無いことを確認

## 依存関係マップ

```
REQ-001 → REQ-002 → REQ-003 → REQ-004
REQ-001 → REQ-006 → REQ-004
REQ-001 → REQ-005
REQ-001 → REQ-007（→ NFR-01 具体化）
REQ-006 → REQ-008 → REQ-009
REQ-002, REQ-008 → REQ-010 → REQ-011 → REQ-012 → REQ-013 → REQ-025
REQ-001 → REQ-014 → REQ-015
REQ-001, REQ-007 → REQ-016 → REQ-017
REQ-016 → REQ-018 → REQ-019 → REQ-020
REQ-019 → REQ-021
REQ-007 → REQ-022
REQ-007 → REQ-023
REQ-002 → REQ-024
REQ-013 → REQ-025
```

## Open Questions

| OQ | 質問 | 重要度 | 技術判断リスク | 担当 |
|----|------|--------|--------------|------|
| OQ-01 | 「1分日報」の必須入力項目の最小集合と、許容される操作（タップ/クリック）工程数の上限。NFR-02のアクセシビリティ数値基準もこれに連動 | High | REQ-004/NFR-02 の中核。誤ると差別化の核が成立しない | RYUGEN |
| OQ-02 | プリフィルの参照元優先順位（前日 / 直近提出済 / 現場テンプレート既定値のどれを優先するか） | High | REQ-003 の初期値決定ロジックに直結 | RYUGEN |
| OQ-03 | AIシフト最適化で扱う制約条件の網羅（有資格要件・勤務間隔＝インターバル・希望休・配置基準の必要人数・連続勤務上限 等）とハード/ソフト制約の区別 | High | REQ-018/REQ-019 の最適化モデル設計に直結。抜けは違法配置リスク | RYUGEN / Architect |
| OQ-04 | 月報「承認率」の分母定義（提出済に対する承認 / 全対象日 / 作成済 のいずれか） | Mid | REQ-011 の集計値が現場感覚とずれる | RYUGEN |
| OQ-05 | 既存 Claude API リスク予測エンジンの入出力I/F仕様（返却フィールド・呼び出し方法・更新頻度） | High | REQ-014 の連携実装に必須。未確認だと結合不能 | Architect / Database Engineer |
| OQ-06 | 既存シフト・配置表テーブルのデータ構造（勤務区分マスタ・ポジション定義・配置基準の持ち方） | High | REQ-016/REQ-017 を追加のみで載せられるかの分岐 | Database Engineer |
| OQ-07 | 月報PDF/Excelの確定レイアウト（提出先フォーマット・帳票様式） | Mid | REQ-013 の出力実装に影響 | RYUGEN |
| OQ-08 | 交通誘導（2号）業務を将来対象に含めるか、含める場合の日報様式差分 | Mid | スコープ境界。MVP後拡張の設計余地に影響 | RYUGEN |
| OQ-09 | Tauri のOSサポート範囲（Windows/WebView2 単独か、Mac/Linuxも含めるか）とWebView2ランタイム配布方式 | Mid | REQ-025 の検証範囲を左右 | Architect |
| OQ-10 | 資格「更新間近」の基準日数と、法定研修時間（新任/現任/業務別）の要件値 | Mid | REQ-023 の分類・アラート閾値に必要 | RYUGEN / Legal |
| OQ-11 | 低価格帯の目標価格（隊員規模別の月額レンジ）と課金単位（現場数/隊員数） | Mid | 直接の開発対象外だがNFR-03の現場単位RLS/課金整合に影響 | RYUGEN / Finance |

---

## 出力サマリー

```
Planner 完了

仕様書: spec/behavioral-spec.md
総REQ数: 25件（機能REQ）+ NFR 4件
スプリント数: 4
リスク分布（機能REQ）: High:9 Mid:12 Low:4
依存関係: 15本の依存パス
Open Questions: 11件

→ Chief Secretary へ部署状況報告送付
→ Spec-Validator (#06) へ引き渡し
```

---

## v1.1 是正履歴（Spec-Validator CONDITIONAL 80点 差し戻し対応 / 軽微追記）

Architect(#07)・Database Engineer(#08) 合同是正に伴う本仕様書の軽微追記。詳細な設計是正は architecture.md（ADR-002/ADR-008）・database-design.md（§3.5/§4/§4.5）を正とする。

| 指摘 | 対応（behavioral-spec.md） |
|---|---|
| **MEDIUM-3** | NFR-02 の曖昧語「十分なタップ/クリック領域」を測定軸（本文≧16px・タップ領域≧44×44px・工程数≦10タップ、確定値はOQ-01）へ書き換え。 |
| **MEDIUM-2** | NFR-04 の「実用範囲」を代表データ量（1現場 日報36,000件・50名）での **P95 < 1.5秒** に数値化。 |
| **HIGH-1/2/3** | REQ-016 に手動編集の保存先 `shift_overrides`、REQ-020 に確定・反映のNode経由限定と write-back を設計注記として追記（詳細はADR-008 / database-design.md）。 |
| 残課題 | 新REQ（write-back専用REQの正式起票）・MEDIUM-4（REQ-013のSprint2受入範囲明記）・MEDIUM-5（AIシフトPoCゲート化）は Planner 判断のコスト高項目として本是正の対象外＝残課題。 |

---

# 追補 v2.0 — Sprint 8〜10: 人材基盤（スタッフ台帳・案件・応募・更新手続き）

**作成:** Planner (#03) 白木 咲　**作成日:** 2026-11-07　**状態:** v2.7 再承認待ち（REQ-026/032/035 と契約節のみ。他は v2.5 のまま凍結）／v2.5 は APPROVED（Spec-Validator 96点、2026-11-07。RYUGEN 承認済み）。ただし OQ-15 が未決のため REQ-036/037/039/040 のテスト生成は凍結中。OQ-12 が未決のため REQ-035 の画面は着手しない
**参照:** 「MAMOR-AI 人材プラットフォーム構想」「MAMOR-AI 構成案・設計書（2026年11月版）」「UIデザイン案」「帳票一覧」
**目的:** 複数のExcelと紙の管理を、MAMOR-AI 1つに置き換える。第一弾の対象は 有休申請・労働条件・更新手続き・現任申込・配置入力・スタッフ台帳・採用・案件・配置・シフト。

> **プロセス逸脱の記録（遡及仕様）:** Sprint 8 の REQ-026〜034 は、仕様より先に `feat/talent-foundation`（コミット 3b711d1）で実装とテストが書かれた。TRAID原則1（Spec Supremacy）・3（Red Before Green）に反する。対処: ①本節で実装済みの振る舞いを仕様として確定する ②REQ-026〜034 は Spec-Validator 承認後に TDD-Writer が仕様からテストを再導出し、既存テストとの差分を Adversary（Fresh Context）が評価する ③それまで当該ブランチはマージしない。

## 用語
- **人（person）**: ヒトトヒトHDグループで1人1件。**雇用（staff）**: ある会社での雇用。1人が複数の雇用を持てる。
- **契約の形**: 警備（security）/ 派遣（dispatch）/ スポット直接雇用（spot）/ 職業紹介（referral）。
- **警備の枠が応募可能**: 警備業務の案件で、新任教育を修了し、かつ応募日の年度に現任教育を満たす（またはその年度に新任を修了した）状態。年度は4月始まり。

## スプリント計画（追補）
| Sprint | テーマ | REQ | 状態 |
|---|---|---|---|
| 8 | 応募可否の判定・更新手続き・台帳/案件/応募のDB土台 | 026〜034、035（DBのみ） | 実装済み（遡及仕様。再検証待ち） |
| 9 | スタッフ台帳画面・採用・案件作成と公開・隊員アプリ「しごと」・応募→採否 | 035（画面）、036〜040 | 未着手 |
| 10 | 応援依頼（未報告コール連動）・会社都合キャンセル・今日やること統合 | 041〜045 | 未着手 |

## 要件定義（EARS形式）

### REQ-026: 応募可否の判定
**EARS:** WHEN スタッフが案件に応募しようとする、または管理者が候補を検索する THE システム SHALL 契約の形・職種・本人の状態（同意・雇用・教育・在留・年齢・既存勤務）から、案件の全シフト日について応募可否と不可の理由コード（`no_consent` を含む。コード一覧は「追補のインターフェース契約」）を 1 つの純粋関数で返す。雇用主への在籍（入社日以後かつ退社日以前）も全シフト日で確認し、1 日でも在籍外の日があれば不可とする。理由が 1 つでもあれば不可とする。
**Verification Type:** HAPPY_PATH / EDGE_CASE　**リスク:** HIGH（法令違反の応募を通す）　**依存:** なし　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts, model.ts
**テスト観点:** 全シフト日の判定、最終シフト日より前に退社する人は不可、複数理由の同時返却、理由が空なら可、同一入力で同一出力（日時・乱数に非依存）
**計測要件:** イベント `application_eligibility_checked`（発火: 応募APIが `eligible` と `reason_codes` を算出した直後に 1 回）/ プロパティ: job_form, eligible(bool), reason_codes[] / 失敗: `application_eligibility_check_failed`(error_code) / KPI: 不可理由別の件数。PII 不含。

### REQ-027: 警備業務は派遣にできない
**EARS:** IF 案件が警備業務の職種かつ契約の形が派遣 THEN THE システム SHALL その案件を公開前チェックで拒否し、DB への登録もトリガで拒否する。
**Verification Type:** ERROR_HANDLING　**リスク:** HIGH（労働者派遣法第4条）　**依存:** REQ-026　**Sprint:** 8
**変更対象:** talent/eligibility.ts（validateJobForPublish）, supabase/migrations/0410_talent_foundation.sql（jobs_guard_security_dispatch）
**テスト観点:** 警備×派遣は拒否、警備×直接雇用は登録可、警備でない職種×派遣は登録可、トリガは insert と update の両方
**計測要件:** `job_publish_rejected`（発火: 公開 API が公開前チェックの結果で拒否を返した直前に 1 回）/ プロパティ: error_code(security_dispatch_forbidden|boundary_not_confirmed), job_form / KPI: 拒否件数。

### REQ-028: 警備の枠への応募資格（教育）
**EARS:** WHEN 警備業務の案件（直接雇用）へ応募する THE システム SHALL 応募対象の各シフト日において、新任教育の修了日が当日以前であり、かつ（当日の年度の現任教育が満たされている、または新任教育をその年度に修了している）場合に限り応募を許可する。年度は4月1日〜翌3月31日とする。
**Verification Type:** EDGE_CASE　**リスク:** HIGH　**依存:** REQ-026　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（securityTraining）
**テスト観点:** 新任未修了→不可 / 現任未了→不可 / 今年度に新任修了→可 / 3月31日と4月1日の年度境界 / 修了日が未来→不可 / 年度をまたぐ複数日シフトは各日で判定
**計測要件:** REQ-026 のイベントで代替（計測不要: 重複を避けるため）。

### REQ-029: 日雇派遣（30日以内）の例外
**EARS:** WHEN 契約の形が派遣で雇用期間が 30 日以内の案件へ応募する THE システム SHALL 本人に、申告かつ証明の確認が済んだ例外区分（60歳以上・昼間学生・副業・世帯収入）がある場合に限り応募を許可する。雇用期間が 31 日以上の場合は例外を要求しない。
**Verification Type:** EDGE_CASE　**リスク:** HIGH　**依存:** REQ-026　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（日雇派遣の判定）
**テスト観点:** 30日ちょうど（要例外）/ 31日（不要）/ 例外あり・なし
**計測要件:** REQ-026 のイベントで代替。

### REQ-030: 年齢制限
**EARS:** WHEN 案件が警備業務、または夜間勤務を含む THE システム SHALL 各シフト日の満年齢が 18 歳未満の人の応募を拒否する（誕生日当日から 18 歳として扱う）。
**Verification Type:** EDGE_CASE　**リスク:** HIGH　**依存:** REQ-026　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（ageOn）
**テスト観点:** 18歳の誕生日の前日と当日 / 夜間でも警備でもない案件は年齢で拒否しない（本要件の対象外）
**計測要件:** REQ-026 で代替。

### REQ-031: 時間の重なりと労働時間の通算
**EARS:** WHEN スタッフに既存の勤務がある THE システム SHALL 応募するシフトと時間が重なる場合に応募を拒否し（日をまたぐ勤務を含む）、同じ日の他社分を含む合計が 8 時間を超える場合は応募を許可したうえで警告を返す。
**Verification Type:** EDGE_CASE　**リスク:** MEDIUM　**依存:** REQ-026　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（shiftsOverlap, dailyHours）
**テスト観点:** 22:00〜06:00 と翌日 05:00〜09:00 は重なる / 翌日 06:00 開始は重ならない / 合計 8 時間ちょうどは警告なし、8 時間 1 分超は警告
**計測要件:** `application_daily_hours_warned`（発火: 応募APIが警告付きで応募を受理した直後に 1 回）/ プロパティ: total_hours / KPI: 警告件数。

### REQ-032: 在留カードの就労可否と期限
**EARS:** WHEN 外国籍のスタッフ（在留情報あり）が応募する THE システム SHALL 就労不可、またはシフト日に在留期限が切れている場合は応募を拒否し、いずれかのシフト日について「シフト日から在留期限日までの日数」が 0 以上 60 以下の場合は応募を許可したうえで警告 `residence_expiring` を返す（複数のシフト日があるときは、その日数の最小値を `days_left` とする）。基準日は今日ではなくシフト日とする。在留情報がない人（日本国籍など）には本要件を適用しない。
**Verification Type:** EDGE_CASE　**リスク:** HIGH　**依存:** REQ-026　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（在留の判定）
**テスト観点:** 期限当日（可）/ 期限の翌日（不可）/ 就労不可 / 60日ちょうどで警告 / 61日は警告なし / 複数シフト日の最小値 / 在留情報なし
**計測要件:** 拒否は REQ-026 の `application_eligibility_checked`（reason_codes に residence_invalid）で記録する。警告は `residence_expiry_warned`（発火: 応募APIが警告付きで応募を受理した直後に 1 回）/ プロパティ: days_left / KPI: 期限切れ前の通知件数。

### REQ-033: 更新手続きの期限一覧
**EARS:** WHEN 管理者が更新手続き一覧を開く THE システム SHALL 基準日に対し、在籍中の雇用の契約満了日・当年度の現任教育（期限は年度末の 3 月 31 日）・在留期限について、期限切れまたは 30 日以内のものだけを、期限切れ→期限が近い順で返す。退社済みの雇用は契約満了の対象外とする。在籍中の雇用が 1 件もない人（全雇用が退社済み）、新任教育が未修了の人、今年度に新任を修了した人は、現任教育の対象外とする。
**Verification Type:** HAPPY_PATH / EDGE_CASE　**リスク:** MEDIUM　**依存:** なし　**Sprint:** 8
**一覧の3状態:** 空（対象なし → 空配列を返す）/ 単数 / 大量（1,000 人分を 1 秒以内に返す。→ NFR-05 で検証）
**変更対象:** packages/input-core/src/talent/renewal.ts
**計測要件:** `renewal_list_viewed`（発火: 一覧の取得が成功し描画が完了した直後に 1 回）/ プロパティ: item_count, expired_count / 失敗: `renewal_list_failed`(error_code) / KPI: 期限切れの滞留数。

### REQ-034: 運営枠と警備枠の線引き確認
**EARS:** IF 案件が「業務内容で判断が必要」とされ、確認者と確認日の記録がない THEN THE システム SHALL 公開を拒否し、その案件への応募も拒否する。確認者は現場責任者または支店とする。
**Verification Type:** ERROR_HANDLING（確認者のロール判定は REQ-040 で ROLE_ACCESS として検証する）　**リスク:** HIGH（雑踏警備の無資格配置）　**依存:** REQ-026, REQ-027　**Sprint:** 8
**変更対象:** packages/input-core/src/talent/eligibility.ts（validateJobForPublish）, supabase/migrations/0410_talent_foundation.sql
**テスト観点:** 記録なし→拒否 / 記録あり→可 / （確認者のロール判定は REQ-040 の受入で検証する。本 REQ は「確認者と確認日が記録されているか」だけを判定する）
**計測要件:** 公開の拒否は REQ-027 の `job_publish_rejected`（error_code=boundary_not_confirmed）で記録する。応募の拒否は REQ-026 の `application_eligibility_checked`（reason_codes に boundary_not_confirmed）で記録する。単独のイベントは作らない。

### REQ-035: スタッフ台帳（人と雇用）とグループ共同利用の同意
**EARS:** WHEN 登録 RPC が人を保存する THE システム SHALL 人をグループで 1 件、雇用を会社ごとに保持する。WHEN 会社の管理者が人を参照する THE システム SHALL 自社に雇用がある人だけを返す。WHEN 本人が共同利用に同意していない THE システム SHALL 理由コード `no_consent` によりどの会社の案件への応募も拒否し、グループ横断の候補検索から外す（自社の管理者が自社の雇用として参照・管理することは許可する）。**v2.6 で「他社の案件」から「どの会社の案件」に確定。同意のない自社スタッフの扱いは RYUGEN の確認待ち（OQ-12）。**候補検索は同意済みの人だけを返すサーバ側の関数で行い、同意の有無で直接のテーブル参照を変えない。
**Verification Type:** AUTH_GATE / DATA_PERSISTENCE　**リスク:** HIGH（個人情報）　**依存:** REQ-026　**Sprint:** 8（DB）/ 9（画面）
**一覧の3状態（台帳画面・候補検索）:** 空（「該当するスタッフはいません」）/ 単数 / 大量（5,000 人を 50 件ずつ表示）
**変更対象:** supabase/migrations/0410_talent_foundation.sql（persons, staff.person_id, RLS）, apps/desktop/src/features/talent/*
**テスト観点（DB）:** 他社の管理者は他社の雇用の person を読めない / 運営は全件 / 同意なしは応募不可 / 同意なしは横断の候補検索に出ない（自社の一覧には出る）
**計測要件:** `person_registered`（発火: 登録 RPC の成功時）/ プロパティ: consent_joint_use(bool) / 失敗: `person_registration_failed`(error_code) / 禁止: 氏名・連絡先。

### REQ-036: 採用応募の取り込みと一覧
**EARS:** WHEN 応募者が募集ページから応募する、または管理者が求人媒体（エンゲージ・タウンワーク）の応募を登録する THE システム SHALL 応募を 1 つの一覧にまとめ、応募経路を記録し、応募の状態（`new`→`contacted`→`interviewed`→`hired`/`declined`）を持つ。WHILE 状態が `new` のまま 24 時間を超えている THE システム SHALL 応募を受けた会社の採用担当ロールに通知する（採用担当ロールは REQ-040 の許可表で定義する）。
**Verification Type:** HAPPY_PATH / ERROR_HANDLING　**リスク:** MEDIUM　**依存:** REQ-035, REQ-040　**Sprint:** 9
**一覧の3状態:** 空（「応募はありません」を表示）/ 単数 / 大量（500 件）
**計測要件:** `candidate_applied`（発火: 応募が一覧に保存された直後に 1 回）/ プロパティ: source, `candidate_unhandled_24h_notified`（発火: 通知の送信が成功した直後に 1 回）/ プロパティ: source / 失敗: `candidate_unhandled_notify_failed`(error_code) / 失敗: `candidate_import_failed`(source, error_code) / KPI: 媒体別の採用単価。
**変更対象:** packages/input-core/src/talent/recruit.ts（新規）, server/routes/recruit.ts（新規）, supabase/migrations（採用の追加テーブル）
**Open:** 媒体との連携方法は OQ-16。

### REQ-037: 案件の作成と公開
**EARS:** WHEN 管理者が案件（雇用主・契約の形・職種・必要人数・シフト・公開範囲・配置の決め方・単価）を作成して公開する THE システム SHALL REQ-027 と REQ-034 の公開前チェックを実行し、通った案件だけを公開状態にする。公開範囲は「登録スタッフ全員／その現場で働いた人／指名」の 3 種に限り、一般公開は選べない。
**Verification Type:** HAPPY_PATH / ERROR_HANDLING / ROLE_ACCESS　**リスク:** HIGH　**依存:** REQ-027, REQ-034, REQ-040　**Sprint:** 9
**変更対象:** server/routes/jobs.ts（新規）, apps/desktop/src/features/talent/JobEditor.tsx（新規）, packages/input-core/src/talent/eligibility.ts（validateJobForPublish）
**計測要件:** `job_published`（発火: 公開 API が状態を published に更新して応答を返した直後に 1 回）/ プロパティ: job_form, placement_mode / 拒否は REQ-027 の `job_publish_rejected` を使う。

### REQ-038: 隊員アプリ「しごと」タブ
**EARS:** WHEN スタッフが「しごと」タブを開く THE システム SHALL REQ-026 で応募できる案件だけを表示し、応募できない案件とその理由は表示しない。応募前の画面に雇用主・時給・交通費・持ち物・服装・キャンセル規定を必ず表示する。
**Verification Type:** HAPPY_PATH / ACCESSIBILITY　**リスク:** MEDIUM　**依存:** REQ-026, REQ-037　**Sprint:** 9
**一覧の3状態:** 空（「いま応募できるお仕事はありません」）/ 単数 / 大量（200 件）
**ACCESSIBILITY:** ボタン 44px 以上、文字のコントラスト 4.5:1 以上。
**変更対象:** apps/desktop/src/features/staff/JobsTab.tsx（新規）, packages/input-core/src/talent/eligibility.ts（listApplicableJobs）
**計測要件:** `job_list_viewed`（発火: 一覧の取得が成功し描画が完了した時に 1 回）/ プロパティ: item_count, `job_applied`（発火: 応募 API が受理を返した直後に 1 回）/ 失敗: `job_apply_failed`(error_code)。

### REQ-039: 応募から確定、労働条件通知
**EARS:** WHEN 配置の決め方が「応募→採否」の案件で管理者が採用する、または「即確定」の案件に応募が成立する THE システム SHALL 応募を確定にし、労働条件通知書を発行して通知時刻を記録する。WHEN 本人が労働条件通知を確認した THE システム SHALL 確認時刻を記録する。
**Verification Type:** HAPPY_PATH / DATA_PERSISTENCE　**リスク:** HIGH（応募成立で労働契約が成立する）　**依存:** REQ-037, REQ-040　**Sprint:** 9
**変更対象:** server/routes/applications.ts（新規）, supabase/migrations（確定の RPC）, packages/input-core/src/talent/eligibility.ts
**計測要件:** `application_confirmed`（発火: 確定の DB 更新が成功した直後に 1 回）/ プロパティ: placement_mode, `conditions_notice_issued`（発火: 通知書の発行記録が保存された直後に 1 回）/ 失敗: `application_confirm_failed`(error_code)。

### REQ-040: 権限（誰が何をできるか）
**EARS:** WHEN 利用者が案件の公開・採否・応援依頼・線引き確認・採用応募の対応を実行しようとする THE システム SHALL 次の許可表に従って利用者の役割を判定し、許可のない役割の操作を拒否して `permission_denied` を記録する。

| 操作 | 現場責任者 | 管制 | 支店 | 本社 | 根拠 |
|---|---|---|---|---|---|
| 応援依頼を出す | 許可 | 許可 | 許可 | 拒否 | 決定済み |
| 線引き確認を記録する | 許可 | 拒否 | 許可 | 拒否 | 決定済み |
| 案件を公開する | 自現場の案件のみ許可 | 拒否 | 自支店の案件のみ許可 | 許可 | **提案（OQ-15で承認）** |
| 応募の採否を決める | 自現場の案件のみ許可 | 許可 | 自支店の案件のみ許可 | 許可 | **提案（OQ-15で承認）**。応援依頼の採否は依頼した人（決定済み） |
| 採用応募の対応（REQ-036） | 拒否 | 拒否 | 拒否 | 許可（採用担当ロール） | **提案（OQ-15で承認）** |

**Verification Type:** ROLE_ACCESS　**リスク:** HIGH　**依存:** REQ-027, REQ-034　**Sprint:** 9
**変更対象:** packages/input-core/src/auth/authz.ts, supabase/migrations（RLS）
**計測要件:** `permission_denied`（発火: 認可判定の拒否時 1 回）/ プロパティ: action, role / KPI: 拒否件数。
**受入:** REQ-034 の確認者が現場責任者・支店以外なら拒否されること（本 REQ のテストで検証する）。

### REQ-041: 応援依頼（未報告コールからの作成）
**EARS:** WHEN 現場責任者・管制・支店が欠員の枠から応援依頼を作る THE システム SHALL 現場・日時・人数・必要資格を引き継いだ単発案件を作成し、必要な教育・資格を満たし、その時間に他の勤務がないスタッフだけに通知する。キャリアライズだけに登録している人には表示しない。
**Verification Type:** HAPPY_PATH / ERROR_HANDLING　**リスク:** HIGH　**依存:** REQ-026, REQ-039, REQ-040　**Sprint:** 10
**変更対象:** server/routes/support.ts（新規）, apps/desktop/src/features/jyoban/（欠員の枠からの作成ボタン）, packages/input-core/src/jyoban/calls.ts
**計測要件:** `support_request_created`（発火: 案件の保存と通知対象の確定が成功した直後に 1 回）, `support_request_filled`（発火: 必要人数分の応募が確定した直後に 1 回）/ 失敗: `support_request_failed`(error_code) / KPI: 充足までの時間。

### REQ-042: 補填済みの反映
**EARS:** WHEN 応援依頼の応募が確定する THE システム SHALL 支店・本部の画面で該当枠を補填済みにし、確定した人の上番報告枠を自動で追加し、未報告コールの対象に含める。
**Verification Type:** DATA_PERSISTENCE　**リスク:** MEDIUM　**依存:** REQ-041　**Sprint:** 10
**変更対象:** supabase/migrations（補填の RPC）, packages/input-core/src/jyoban/calls.ts
**計測要件:** `support_shift_assigned`（発火: 補填確定時 1 回）/ プロパティ: job_id / 失敗: `support_shift_assign_failed`(error_code)。PII 不含。

### REQ-043: 会社都合キャンセルの休業手当
**EARS:** WHEN 会社都合で確定済みの応募が取り消される THE システム SHALL 休業手当の要否と金額を算定対象として記録し、月末締めの給与計算に引き渡す。本人都合の取り消しには適用しない。
**Verification Type:** EDGE_CASE　**リスク:** HIGH　**依存:** REQ-039　**Sprint:** 10
**変更対象:** supabase/migrations（取消と休業手当の RPC）, server/routes/applications.ts
**計測要件:** `cancellation_compensation_recorded`（発火: 会社都合の取消確定の DB 更新が成功した直後に 1 回。本人都合では発火しない）/ プロパティ: application_id / 失敗: `cancellation_compensation_failed`(error_code)。PII 不含。
**Open:** 金額の算定式は社労士の確認後（OQ-17）。

### REQ-044: 「今日やること」への統合
**EARS:** WHEN 管理者が現場コンソールのホームを開く THE システム SHALL 次の表の「未処理」の項目を 1 つの一覧に、「期限」の近い順（期限切れが先頭）に表示する。

| 種別 | 未処理 | 期限 |
|---|---|---|
| 更新手続き（REQ-033） | 期限切れまたは 30 日以内 | REQ-033 の期限日 |
| 応募の採否（REQ-039） | 状態が applied | 応募日時 + 24 時間 |
| 応援依頼（REQ-041） | 必要人数に満たない | 依頼したシフトの開始日時 |
| 採用応募（REQ-036） | 状態が new | 応募日時 + 24 時間 |

有休・現任申込は OQ-18 で REQ を追加した後に対象へ加える。
**Verification Type:** HAPPY_PATH　**リスク:** MEDIUM　**依存:** REQ-033, REQ-036, REQ-039, REQ-041　**Sprint:** 10
**一覧の3状態:** 空（「今日やることはありません」）/ 単数 / 大量（100 件は先頭 50 件＋件数表示）
**変更対象:** apps/desktop/src/features/site/TodayTodo.tsx（新規）, packages/input-core/src/talent/todo.ts（新規）
**計測要件:** `todo_item_completed`（発火: 各項目の処理 API が成功を返した直後に 1 回）/ プロパティ: kind / 失敗: `todo_item_complete_failed`(kind, error_code) / KPI: 紙・Excel 廃止後の処理時間。

### REQ-045: 同日の複数応募
**EARS:** WHEN 同じスタッフが時間の重なる複数の案件に同時に応募する THE システム SHALL 先に確定した応募を有効とし、後の応募を REQ-031 に従い拒否する。
**Verification Type:** EDGE_CASE　**リスク:** MEDIUM　**依存:** REQ-031, REQ-039　**Sprint:** 10
**計測要件:** 応募時の拒否は REQ-026 の `application_eligibility_checked`（reason_codes に time_overlap）で記録する。確定時の排他で後の応募が弾かれた場合は REQ-039 の `application_confirm_failed`（error_code=time_overlap）で記録する。単独のイベントは作らない。
**変更対象:** packages/input-core/src/talent/eligibility.ts（shiftsOverlap）, supabase/migrations（確定の RPC での排他）

## 追補のインターフェース契約（REQ-026 / 032 / 035 の補足。v2.7）
**Bead:** REQ-026, REQ-032, REQ-035 に従属（独立した REQ は立てない）　**リスク:** HIGH　**依存:** REQ-026　**変更対象:** packages/input-core/src/talent/model.ts, eligibility.ts, renewal.ts, supabase/migrations（`search_candidates`）　**Sprint:** 8
TDD-Writer が仕様だけからテストを書いた際、戻り値の形が仕様に無く、テストが形を作り出していたため追加した。REQ-026〜034 の振る舞いは変えず、REQ-035 の同意の扱いのみ v2.6 で確定した（REQ-035 の本文に反映済み）。

**型の正本:** `packages/input-core/src/talent/model.ts` の `PersonProfile`, `JobPost`, `BusyShift`, `EligibilityReason`, `EligibilityResult`。テストはこの型から入力を組み立てる。

**理由コード（`EligibilityReason` の全要素）:** `no_consent` / `under_age` / `residence_invalid` / `not_registered` / `security_dispatch_forbidden` / `security_basic_training_missing` / `security_annual_training_missing` / `daily_dispatch_not_allowed` / `time_overlap` / `boundary_not_confirmed`。`reasons` に同じコードは 1 度だけ入り、並び順は規定しない（テストは集合として比較する）。

| 関数 | 呼び出し | 戻り値 |
|---|---|---|
| `checkEligibility` | (person, job, busy = []) | `{ eligible, reasons, warnings }`。`reasons` が空なら `eligible` は true。`warnings` の要素は `daily_hours_over_8` と `residence_expiring` |
| `validateJobForPublish` | (job) | `EligibilityReason[]`。空配列なら公開できる。要素があれば公開を拒否する（`security_dispatch_forbidden`, `boundary_not_confirmed` のみ返しうる） |
| `listApplicableJobs` | (person, jobs, busy = []) | 応募できる `JobPost[]`（入力順を維持） |
| `listRenewals` | (people, referenceDate: 'YYYY-MM-DD', soonDays = 30) | `RenewalItem[]` = `{ personId, kind: 'contract'\|'annual_training'\|'residence', dueOn: 'YYYY-MM-DD', daysLeft, urgency: 'expired'\|'soon' }` |
| `search_candidates`（DB の関数） | (p_company_id uuid, p_filter jsonb default '{}') | `TABLE(person_id uuid, name text)`。呼んだ会社と同じグループで、`consent_joint_use` が true の人だけを返す。`p_filter` は今回は使わない（空でよい） |

**境界の確定（WHEN 形）**
- WHEN 応募するシフト日から在留期限日までの日数が 0 以上 60 以下 THE システム SHALL `residence_expiring` の警告を返す（60 日は警告、61 日は警告なし）。
- WHEN 本人が共同利用に同意していない THE システム SHALL 全案件で `no_consent` により応募を拒否する（REQ-035）。
- WHEN `listRenewals` が項目を並べる THE システム SHALL `dueOn` が基準日より前なら `expired`、`daysLeft` が 0 以上 `soonDays` 以下なら `soon` とし、`expired` を先頭に、`daysLeft` の小さい順、同日は `personId` の昇順で並べる。期限切れの項目の `daysLeft` は負の値（期限日が基準日の前日なら -1）とする。同じ `personId` で同日の項目は入力順とする。
- WHEN 現任教育の更新手続きを作る THE システム SHALL `dueOn` を基準日の年度末（3 月 31 日）にする（REQ-033）。

## 追補の非機能要件
- **NFR-05（性能）** リスク: MID — 一覧の遅延は現場の運用に影響するが、データは壊さない。WHEN 1,000 人分の人と雇用を渡して更新手続き一覧（REQ-033）を求める THE システム SHALL 1 秒以内に結果を返す（Vitest で計測）。

## 追補の Open Questions
| ID | 内容 | 影響 | 担当 |
|---|---|---|---|
| OQ-16 | エンゲージ・タウンワークの応募取り込み方法（API／CSV／メール） | REQ-036 | RYUGEN（媒体との契約確認） |
| OQ-17 | 休業手当の算定式と対象範囲 | REQ-043 | 社労士 |
| OQ-12 | 共同利用する項目と、既存スタッフから同意を取り直す方法。あわせて、同意のない人を「どの案件にも応募不可」とする保守的な扱い(v2.6)で良いか | REQ-035 | RYUGEN・弁護士 |
| OQ-13 | 当日キャンセルのペナルティ | REQ-039, 043 | RYUGEN |
| OQ-15 | 案件の公開・応募の採否・採用応募の対応を、どの役割に許可するか。採用担当ロールの付与方法も含む（REQ-040 の許可表の「提案」行）。**解決まで、この3行に関する REQ-036/037/039/040 のテストは生成しない** | REQ-036, 037, 039, 040, 044 | RYUGEN |
| OQ-18 | 有休・現任申込の承認を、既存実装(0402/0103)の遡及仕様 REQ として Sprint 10 に追加する（追加後に REQ-044 の対象へ戻す） | REQ-044 | Planner |
| OQ-14 | 「欠時間」「約定人数」の定義（UI案の7指標） | 配備状況画面 | RYUGEN |

## 審査履歴
- 2026-11-07 Spec-Validator 初回: REJECTED（計測要件の欠落3件=REQ-042/043/045、失敗イベント欠落8件、変更対象欠落、REQ-034の依存漏れ）。本版(v2.1)で是正。
- 2026-11-07 Spec-Validator 再審査: REJECTED 28点(−72: 発火タイミング未特定9件=−45、REQ-034→040 の依存逆流=−10、変更対象欠落7件=−14、REQ-040 の EARS=−3)。本版(v2.2)で是正: 発火点を特定、REQ-034 の依存を REQ-027 のみにして権限テストを REQ-040 の受入へ移動、変更対象を追記、REQ-040 を WHEN 形に、拒否イベントを `job_publish_rejected` に一本化。
- 2026-11-07 Spec-Validator 第3回: CONDITIONAL 82点(−18: REQ-033の発火点=−5、REQ-044の依存=−2、REQ-035のスプリント不整合=−2・EARS=−3、REQ-036の未定義語=−3、REQ-040の許可表=−3)。本版(v2.3)で是正。許可表の公開・採否は私案のため OQ-15 で RYUGEN の承認を待つ。
- 2026-11-07 Spec-Validator 第4回: REJECTED 68点(−32: REQ-026/043の発火点=−10、REQ-039/036のEARS=−6、REQ-036の依存=−2、REQ-044の未定義語=−3、REQ-035の3状態=−3、NFR-05のリスク=−2、OQ-10/11の番号重複=−6)。本版(v2.4)で是正。追補のOQは OQ-16 以降に採番し直し、REQ-044 は元REQのある4種別に絞り、有休・現任申込は OQ-18 で別途REQ化する。
- 2026-11-07 v2.6: TDD-Writer の初回テスト(56件中12件 RED)を精査。実装の欠陥は REQ-026(在籍の全シフト日確認)の1件。REQ-027/034 の6件は戻り値の形が仕様に無かった、REQ-033 の3件と REQ-032 の1件はテスト側の誤り(存在しないフィールド名、日付計算の誤り)。REQ-035 の同意は、全案件で応募不可と確定(保守側)。インターフェース契約を追加。RYUGEN の確認が必要な点は OQ-12 に追記。
- 2026-11-07 Spec-Validator v2.6 再承認: CONDITIONAL 78点(−22: REQ-035本文と契約の矛盾=−5、履歴の食い違い=−2、境界のEARS形=−3、契約のBead欠落=−2、理由コード/入力の未定義=−3、search_candidatesの未定義=−3、listRenewalsの境界=−2、REQ-032の基準日=−2)。v2.7 で是正。再承認とRYUGENの確認(OQ-12)まで、REQ-026/032/035 に関わるテスト再生成は暫定。
- 2026-11-07 Spec-Validator 第5回: **APPROVED 96点**(−4: REQ-039とREQ-034の依存漏れ各−2)。本版(v2.5)で是正。RYUGEN の仕様承認を受領（2026-11-07）。承認の範囲は v2.5 の本文。OQ-15・OQ-12 は未承認。
- 遡及実装との食い違い3件を仕様側で確定: ①全雇用が退社済みの人は現任教育の対象外(REQ-033) ②同意なしは横断検索から外し、自社の管理者の参照は許可(REQ-035。応募の扱いは v2.6 でどの案件も不可に変更) ③在籍は全シフト日で確認(REQ-026)。実装は仕様承認後、先に失敗するテストを書いてから直す。

## REQ 台帳（追補）
| REQ | 状態 | Sprint |
|---|---|---|
| 026〜034 | 実装済み（遡及・再検証待ち） | 8 |
| 035 | DB のみ実装済み／画面は未着手 | 8・9 |
| 036〜040 | 未着手 | 9 |
| 041〜045 | 未着手 | 10 |
