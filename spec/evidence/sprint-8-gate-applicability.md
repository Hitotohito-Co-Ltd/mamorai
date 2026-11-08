# Sprint 8 ゲートの適用範囲の宣言（Orchestrator）
日付: 2026-11-08 / 宣言者: ① Orchestrator（このセッション）。RYUGEN は『正規ルート』（修正と再審査を重ねて出荷判定に進める方針）を選択した（2026-11-08）。**これは方針の選択であり、本宣言の承認ではない。**

**承認（2026-11-08）: RYUGEN は、Gate 4（性能）と Gate 5（レスポンシブ）を『Sprint 8 に限って適用外』とするこの宣言を、明示的に承認した。** 性能は NFR-05 の計測で代える。画面・API を含む Sprint では適用外にできない。

Sprint 8 は画面を持たない基盤層（TypeScript の純粋関数と PostgreSQL のマイグレーション・RLS）である。
| ゲート | 扱い | 理由 |
|---|---|---|
| ⑩ レスポンシブ・a11y | **適用外** | 画面・コンポーネントを一切含まない（apps/desktop は未変更）。UI は Sprint 9 以降 |
| ⑬ Lighthouse・Core Web Vitals | **適用外** | 同上（画面なし）。性能は NFR-05（1000人分の更新手続き一覧 < 1秒）の計測で代える。報告は spec/performance-report-sprint-8.md |
| ⑪ セキュリティ | **適用** | 個人情報（persons）と会社間の分離（RLS）を扱う。報告は spec/security-report.md |
| ⑫ Adversary | **適用** | Fresh Context。結果は spec/reviews/sprint-8/output/verdict.json |
画面を含む Sprint では、⑩⑬ を適用外にできない。この宣言は Sprint 8 に限る。
