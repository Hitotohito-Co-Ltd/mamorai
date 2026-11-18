// [Auth] パスでログイン系統を振り分ける入口ルーター（同一Reactコードを Web/Tauri 両出し）。
//   /co/      → 会社（本社・権限者）
//   /s/       → 施設（現場）
//   /tradmin/ → 運営（TRYANGROW）
//   その他     → 認証済みなら本体アプリ（既定は会社導線）
// サービスページ(/)・LP(/lp) は静的HTMLでSPA外（Webサーバ側でルーティング）。
import { useEffect, useState } from 'react'
import { App } from '../../App.js'
import { CompanyLogin } from './CompanyLogin.js'
import { SiteLogin } from './SiteLogin.js'
import { TradminLogin } from './TradminLogin.js'
import { signOut } from './authService.js'
import type { Realm, Session } from './authTypes.js'
import { SITE_SESSION_EXPIRED } from '../../shared/secureRpc.js'

function realmFromPath(pathname: string): Realm {
  if (pathname.startsWith('/tradmin')) return 'tradmin'
  if (pathname.startsWith('/s')) return 'site'
  return 'company' // /co/ および既定
}

export function EntryRouter(): JSX.Element {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/co/'
  const realm = realmFromPath(path)
  const [session, setSession] = useState<Session | null>(null)
  // 現場PCのセッションが切れたら（12時間使わなかった・別の端末でログアウト等）ログイン画面に戻す
  useEffect(() => {
    const onExpired = (): void => setSession((s) => (s?.realm === 'site' ? null : s))
    window.addEventListener(SITE_SESSION_EXPIRED, onExpired)
    return () => window.removeEventListener(SITE_SESSION_EXPIRED, onExpired)
  }, [])

  if (session !== null) {
    // 認証後は本体アプリ。role/scope に応じてタブを出し分け（capabilitiesForRole）。
    return <App session={session} onLogout={() => { void signOut(); setSession(null) }} />
  }
  if (realm === 'tradmin') return <TradminLogin onLogin={setSession} />
  if (realm === 'site') return <SiteLogin onLogin={setSession} />
  return <CompanyLogin onLogin={setSession} />
}
