// [実行時コンテキスト] 現場セッションの会社識別コード／施設コードを保持する。
// 現場(/s)ログイン時に App が実コードを設定し、各API(staff/leave)がRPCのスコープに使う。
// 既定は env(VITE_COMPANY_CODE/VITE_SITE_CODE) → 無ければパイロット定数。
import { COMPANY, SITE } from '../pilot/bulgari.js'

const env = (import.meta.env ?? {}) as Record<string, string | undefined>
let companyCode = env.VITE_COMPANY_CODE ?? COMPANY.code
let siteCode = env.VITE_SITE_CODE ?? SITE.code

/** 現場ログイン時に実コードを設定。 */
export function setSiteCodes(company?: string, site?: string): void {
  if (company && company.trim() !== '') companyCode = company.trim()
  if (site && site.trim() !== '') siteCode = site.trim()
}
export function siteCodes(): { companyCode: string; siteCode: string } {
  return { companyCode, siteCode }
}

// ── 現場PC（/s）のセッション（0411）──
// 現場PINで開いたセッションのトークン。現場の処理（sitepc_*）はこれがないと呼べない。
// タブを閉じると消えるよう sessionStorage に置く（共有PCで次の人に残さない）。
const K_SITE_SESSION = 'mamorai.site.session'
let siteSessionToken: string | null = (() => {
  try { return globalThis.sessionStorage?.getItem(K_SITE_SESSION) ?? null } catch { return null }
})()

export function setSiteSession(token: string | null): void {
  siteSessionToken = token
  try {
    if (token === null) globalThis.sessionStorage?.removeItem(K_SITE_SESSION)
    else globalThis.sessionStorage?.setItem(K_SITE_SESSION, token)
  } catch { /* ignore */ }
}
export function siteSession(): string | null { return siteSessionToken }
