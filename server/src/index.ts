// [ADR-003] MAMOR-AI AI/秘匿ゲートウェイのエントリポイント（Node/Express）。
// Claude APIキー・重い処理はこの層に閉じ込める。参照系CRUDはフロントの Supabase 直結（ADR-002）。
import express, { type Express } from 'express'
import cors from 'cors'
import { createRiskRouter } from './routes/risk.js'
import { createShiftOptimizeRouter } from './routes/shift-optimize.js'
import { createJyobanCallsRouter } from './routes/jyoban-calls.js'

const PORT = Number(process.env.PORT ?? 3001)
// 開発用に許可オリジンを限定（Vite dev サーバ）。本番は環境変数で上書きする。
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

/** Express アプリを組み立てて返す（テスト/起動の双方から利用可能）。 */
export function createApp(): Express {
  const app = express()
  app.use(cors({ origin: ALLOWED_ORIGIN }))
  app.use(express.json())
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  // /api/risk は env に応じて実/モックの予測エンジンを解決してマウント。
  app.use('/api/risk', createRiskRouter())
  // /api/shift は NL→制約(Claude) / 制約→下案(最適化) / HITL確定 を提供。キーはこの層のみ。
  app.use('/api/shift', createShiftOptimizeRouter())
  // /api/jobs/jyoban-calls は外部スケジューラ専用（Bearer CRON_SECRET）。未報告の起床・出発・上番・下番を通知する。
  app.use('/api/jobs/jyoban-calls', createJyobanCallsRouter())
  return app
}

// 直接起動時のみ listen（テスト import 時は起動しない）。
const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const app = createApp()
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[mamorai/server] risk gateway listening on :${PORT} (CORS: ${ALLOWED_ORIGIN})`)
  })
}
