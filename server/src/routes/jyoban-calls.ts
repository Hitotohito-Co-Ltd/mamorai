// [JYB] POST /api/jobs/jyoban-calls — 未報告コールを1回まわす（外部スケジューラから数分おきに呼ぶ）
//   認証: Authorization: Bearer <CRON_SECRET>。CRON_SECRET が未設定なら 503（誤って公開しない）
import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { runJyobanCalls, type RunDeps } from '../jyoban/runCalls.js'
import { createSenders, createSupabaseCallStore } from '../jyoban/providers.js'

type Env = Record<string, string | undefined>

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createJyobanCallsRouter(
  env: Env = process.env,
  makeDeps: (now: Date) => RunDeps | null = (now) => {
    const store = createSupabaseCallStore(env)
    if (store === null) return null
    return { store, senders: createSenders(env), now, appUrl: env.JYOBAN_APP_URL ?? '/app', log: (m) => console.warn(m) }
  },
): Router {
  const r = Router()
  let running = false
  r.post('/', async (req: Request, res: Response) => {
    const secret = env.CRON_SECRET
    if (secret === undefined || secret === '') { res.status(503).json({ error: 'CRON_SECRET が未設定です' }); return }
    const got = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!sameSecret(got, secret)) { res.status(401).json({ error: 'unauthorized' }); return }
    const deps = makeDeps(new Date())
    if (deps === null) { res.status(503).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です' }); return }
    if (running) { res.status(202).json({ busy: true }); return }
    running = true
    try {
      res.json(await runJyobanCalls(deps))
    } catch (e) {
      console.error('[jyoban-calls]', e instanceof Error ? e.message : e)
      res.status(500).json({ error: 'run failed' })
    } finally {
      running = false
    }
  })
  return r
}
