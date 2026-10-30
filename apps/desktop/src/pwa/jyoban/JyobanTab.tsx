// [勤務員PWA] 「上番報告」タブ。ログイン済みの隊員が、登録した現場を選んで報告する。
//   現場の登録はアプリ内のQR読み取りで行い、このスマホに記録する（ログイン時に上番報告用の端末登録も済ませている）。
import { useState } from 'react'
import { JyobanApp } from './JyobanApp.js'
import { QrScanner } from './QrScanner.js'
import { fetchContext, rememberSite, forgetSite, recentSites, NetworkError, type RecentSite } from './reportApi.js'
import './jyoban.css'

type View = { kind: 'list' } | { kind: 'scan' } | { kind: 'report'; token: string }

const mdw = (date: string): string => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`
}

export function JyobanTab({ deviceError }: { deviceError: string | null }): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [sites, setSites] = useState<RecentSite[]>(() => recentSites())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const register = (token: string): void => {
    setBusy(true); setMsg(null)
    fetchContext(token)
      .then((c) => {
        rememberSite(token, c.site.name)
        setSites(recentSites())
        setMsg({ ok: true, text: `${c.site.name} を登録しました` })
        setView({ kind: 'report', token })
      })
      .catch((e: Error) => {
        setView({ kind: 'list' })
        setMsg({ ok: false, text: e instanceof NetworkError ? '通信できないため登録できませんでした。電波の良い場所でもう一度読み取ってください' : e.message })
      })
      .finally(() => setBusy(false))
  }

  if (view.kind === 'report') {
    return <JyobanApp initialToken={view.token} onExit={() => { setSites(recentSites()); setView({ kind: 'list' }) }} />
  }
  if (view.kind === 'scan') {
    return <div className="jy-app"><main className="jy-main"><QrScanner onToken={register} onCancel={() => setView({ kind: 'list' })} /></main></div>
  }

  return (
    <div className="jy-app">
      <main className="jy-main">
        <h2 className="jy-h2">上番報告</h2>
        {deviceError !== null && <p className="jy-warn" role="alert">上番報告の準備ができませんでした（{deviceError}）。いったんログアウトして、もう一度ログインしてください。</p>}
        {msg !== null && <p className={msg.ok ? 'jy-okmsg' : 'jy-err'} role="status">{msg.text}</p>}
        {sites.length === 0 ? (
          <p className="jy-lead">まず勤務する現場を登録します。現場に掲示された「MAMOR-AI 上番報告」のQRを読み取ってください。</p>
        ) : (
          <>
            <p className="jy-lead">報告する現場を選んでください。</p>
            <ul className="jy-pick-list">
              {sites.map((s) => (
                <li key={s.token} className="jy-pick-row">
                  <button type="button" className="jy-pick" onClick={() => setView({ kind: 'report', token: s.token })}>
                    <b>{s.name}</b>
                    <span>最後に開いた日 {mdw(s.usedAt.slice(0, 10))}</span>
                  </button>
                  <button type="button" className="jy-link jy-unlink" aria-label={`${s.name} の登録を外す`}
                    onClick={() => { if (window.confirm(`${s.name} の登録を外しますか？（あとでQRを読み取れば再登録できます）`)) { forgetSite(s.token); setSites(recentSites()) } }}>外す</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="jy-btn jy-btn-navy jy-btn-tall" disabled={busy || deviceError !== null} onClick={() => { setMsg(null); setView({ kind: 'scan' }) }}>
          {busy ? '確認中…' : '＋ 現場を登録（QRを読み取る）'}
        </button>
        <p className="jy-note">登録した現場はこのスマホに保存されます（最大10件）。スマホのカメラアプリでQRを読み取って開いても報告できます。</p>
      </main>
    </div>
  )
}
