// [セキュリティ] ログインした現場PC・本人登録した端末からだけ呼べる RPC の共通入口（0411）。
//   ・siteRpc: 現場PCのセッション（現場PINで開いたもの）を付けて sitepc_* を呼ぶ。切れていたら知らせる。
//   ・workerRpc: 勤務員アプリの端末シークレット（スタッフNo＋PINで本人登録した端末）を付けて worker_* を呼ぶ。
// どちらもエラーを握りつぶさず例外にする（画面で「保存できませんでした」と出せるように）。
import { getSupabase } from '../lib/supabaseClient.js'
import { siteSession, setSiteSession } from './runtimeCtx.js'
import { loadDevice } from '../pwa/jyoban/reportApi.js'

/** 現場PCのセッションが切れた（ログイン画面に戻す合図）。 */
export const SITE_SESSION_EXPIRED = 'mamorai:site-session-expired'

export class SessionExpiredError extends Error {}

function clean(message: string): string {
  return message.replace(/^(SESSION|DEVICE):\s*/, '')
}

export async function siteRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = siteSession()
  if (token === null) {
    globalThis.dispatchEvent?.(new Event(SITE_SESSION_EXPIRED))
    throw new SessionExpiredError('現場のログインが切れました。もう一度ログインしてください')
  }
  const { data, error } = await getSupabase()!.rpc(fn, { p_session: token, ...args })
  if (error !== null) {
    if (error.message.includes('SESSION:')) {
      setSiteSession(null)
      globalThis.dispatchEvent?.(new Event(SITE_SESSION_EXPIRED))
      throw new SessionExpiredError(clean(error.message))
    }
    throw new Error(clean(error.message))
  }
  return data as T
}

export async function workerRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const device = loadDevice()
  if (device === null) throw new Error('この端末は本人登録されていません。ログインし直してください')
  const { data, error } = await getSupabase()!.rpc(fn, { p_device_secret: device.secret, ...args })
  if (error !== null) throw new Error(clean(error.message))
  return data as T
}
