// [BIO] /api/passkey — 勤務員アプリの生体認証（WebAuthn パスキー）
//   POST /register/options  端末の勤務員のパスキー作成オプション
//   POST /register/verify   作成したパスキーを検証して保存
//   POST /verify/options    本人確認（署名）のオプション
//   POST /verify            署名を検証。成功で端末に確認時刻を記録し、勤務員の情報を返す
//   本文: { deviceSecret, response? } — deviceSecret は PIN で本人登録した端末のもの。
//   必要な env: WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS（カンマ区切り）/ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
import { Router, type Request, type Response } from 'express'
import { createPasskeyService, readConfig, type PasskeyService, type Result } from '../passkey/passkeyService.js'
import { createSupabasePasskeyStore } from '../passkey/supabaseStore.js'

type Env = Record<string, string | undefined>

/** 送信元IPごとの簡易な回数制限（1分あたり）。総当たりや大量の登録を抑える。 */
export function createRateLimiter(limit: number, windowMs = 60_000, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>()
  return (ip: string): boolean => {
    const t = now()
    const h = hits.get(ip)
    if (h === undefined || h.reset <= t) {
      hits.set(ip, { n: 1, reset: t + windowMs })
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k)
      return true
    }
    h.n += 1
    return h.n <= limit
  }
}

export function createPasskeyRouter(
  env: Env = process.env,
  makeService: () => PasskeyService | null = () => {
    const cfg = readConfig(env)
    const store = createSupabasePasskeyStore(env)
    return cfg === null || store === null ? null : createPasskeyService(store, cfg)
  },
): Router {
  const r = Router()
  const allow = createRateLimiter(Number(env.PASSKEY_RATE_LIMIT ?? 30))
  let service: PasskeyService | null | undefined

  const handle = (fn: (s: PasskeyService, body: Record<string, unknown>) => Promise<Result>) =>
    async (req: Request, res: Response) => {
      if (!allow(req.ip ?? 'unknown')) { res.status(429).json({ error: '回数が多すぎます。少し待ってからお試しください' }); return }
      if (service === undefined) service = makeService()
      if (service === null) { res.status(503).json({ error: '生体認証の設定がされていません' }); return }
      try {
        const out = await fn(service, (req.body ?? {}) as Record<string, unknown>)
        res.status(out.status).json(out.body)
      } catch (e) {
        console.error('[passkey]', e instanceof Error ? e.message : 'error')
        res.status(500).json({ error: 'いまは生体認証を使えません。PINでログインしてください' })
      }
    }

  r.post('/register/options', handle((s, b) => s.registerOptions(b)))
  r.post('/register/verify', handle((s, b) => s.registerVerify(b)))
  r.post('/verify/options', handle((s, b) => s.verifyOptions(b)))
  r.post('/verify', handle((s, b) => s.verify(b)))
  return r
}
