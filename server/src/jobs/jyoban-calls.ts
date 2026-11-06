// [JYB] 未報告コールを1回まわして終了するジョブ（Railway Cron など「コマンドを定期実行」型の基盤用）
//   実行: pnpm --filter @mamorai/server job:jyoban-calls
import { runJyobanCalls } from '../jyoban/runCalls.js'
import { createSenders, createSupabaseCallStore } from '../jyoban/providers.js'

const store = createSupabaseCallStore(process.env)
if (store === null) {
  console.error('[jyoban-calls] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}
const senders = createSenders(process.env)
const summary = await runJyobanCalls({
  store, senders, now: new Date(), appUrl: process.env.JYOBAN_APP_URL ?? '/app', log: (m) => console.warn(m),
})
console.log('[jyoban-calls]', JSON.stringify({ ...summary, channels: Object.keys(senders) }))
