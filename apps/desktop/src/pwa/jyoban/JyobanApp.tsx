// [勤務員PWA・上番報告] 現場QR（/app/r/<トークン>）から開く報告画面。
//   個人スマホ: 初回のみ スタッフNo＋PIN で本人登録 → 以後は ボタン → ［はい］ の2タップ。
//   現場スマホ（共用）: 報告のたびに スタッフNo＋PIN で本人確認（端末に何も残さない）。
//   電波がないときは送信待ちに入れ、つながった時点で自動送信する（個人スマホのみ）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { reportButtons, JYOBAN_OTHER_KINDS, validateOtherReport, type JyobanOtherKind } from '@mamorai/input-core'
import {
  fetchContext, registerDevice, submitReport, flushOutbox, voidReport, outbox,
  saveDevice, localNow, resolveStart, rememberSite, forgetSite, recentSites,
  ReportAuthError, NetworkError,
  type ReportContext, type CtxSlot, type ReportType, type Device, type RecentSite,
} from './reportApi.js'
import './jyoban.css'

const TYPE_LABEL: Record<ReportType, string> = { departure: '出発連絡', onduty: '上番連絡', other: 'その他の報告' }
const hm = (s: string): string => s.replace(/^0(\d):/, '$1:')
const mdw = (date: string): string => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`
}

type Screen =
  | { kind: 'home' }
  | { kind: 'register' }
  | { kind: 'confirmMe'; device: Device & { pinMustChange: boolean } }
  | { kind: 'other' }
  | { kind: 'done'; type: ReportType; at: string | null; reportId: string | null; queued: boolean; label?: string }

function Header({ ctx, slot, shared, online, onSwitch }: { ctx: ReportContext | null; slot?: CtxSlot; shared: boolean; online: boolean; onSwitch?: () => void }): JSX.Element {
  return (
    <header className="jy-head">
      <div className="jy-head-top">
        <span className="jy-brand">MAMOR-AI 上番報告</span>
        {shared ? <span className="jy-shared-badge">現場スマホ（共用）</span>
          : <span className={online ? 'jy-online' : 'jy-offline'}>{online ? '● オンライン' : '● オフライン'}</span>}
      </div>
      <div className="jy-site-row">
        <h1 className="jy-site">{ctx?.site.name ?? '　'}</h1>
        {onSwitch && <button type="button" className="jy-switch-site" onClick={onSwitch}>現場を切替</button>}
      </div>
      {slot && <p className="jy-head-sub">{mdw(slot.workDate)} {slot.name} {hm(slot.workStart)}〜{hm(slot.workEnd)}</p>}
    </header>
  )
}

function Register({ token, onDone }: { token: string; onDone: (d: Device & { pinMustChange: boolean }) => void }): JSX.Element {
  const [no, setNo] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (): void => {
    if (no.trim() === '' || pin === '') { setErr('スタッフNoとPINを入力してください'); return }
    setBusy(true); setErr(null)
    registerDevice(token, no, pin).then(onDone).catch((e: Error) => {
      setErr(e instanceof NetworkError ? '通信できません。電波の良い場所でもう一度お試しください' : e.message)
    }).finally(() => setBusy(false))
  }
  return (
    <main className="jy-main">
      <ol className="jy-steps" aria-label="登録の手順"><li className="on">1 スタッフNo・PIN</li><li>2 本人確認</li></ol>
      <h2 className="jy-h2">スタッフNoで本人登録</h2>
      <p className="jy-lead">初回だけ入力します。照合後、このスマホをあなた専用として登録します。</p>
      <label className="jy-field" htmlFor="jy-no">スタッフNo
        <input id="jy-no" className="jy-input jy-input-big" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} />
      </label>
      <label className="jy-field" htmlFor="jy-pin">PIN
        <input id="jy-pin" className="jy-input jy-input-big" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>
      <p className="jy-note">PINは勤務員アプリと同じものです。わからない場合は本社へお問い合わせください。入力ミスが続くと一時的にロックされます。</p>
      {err && <p className="jy-err" role="alert">{err}</p>}
      <button type="button" className="jy-btn jy-btn-navy jy-btn-tall jy-push" disabled={busy} onClick={submit}>{busy ? '照合中…' : '照合する'}</button>
    </main>
  )
}

function ConfirmMe({ device, onYes, onNo }: { device: Device & { pinMustChange: boolean }; onYes: () => void; onNo: () => void }): JSX.Element {
  return (
    <main className="jy-main">
      <ol className="jy-steps" aria-label="登録の手順"><li>1 スタッフNo・PIN</li><li className="on">2 本人確認</li></ol>
      <h2 className="jy-h2">ご本人ですか？</h2>
      <div className="jy-me">
        <span className="jy-avatar" aria-hidden="true">{device.staffName.slice(0, 1)}</span>
        <span><b className="jy-me-name">{device.staffName}</b><br /><span className="jy-muted">スタッフNo {device.staffNo}</span></span>
      </div>
      {device.pinMustChange && <p className="jy-warn">PINが初期値のままです。勤務員アプリでPINを変更してください。</p>}
      <p className="jy-note">登録後、ブラウザの共有メニューから<b>「ホーム画面に追加」</b>すると1タップで開けます。</p>
      <button type="button" className="jy-btn jy-btn-green jy-btn-tall jy-push" onClick={onYes}>はい、登録する</button>
      <button type="button" className="jy-btn jy-btn-outline" onClick={onNo}>いいえ、入力し直す</button>
    </main>
  )
}

function ConfirmSheet({ ctx, slot, type, shared, onCancel, onSend }: {
  ctx: ReportContext; slot: CtxSlot; type: ReportType; shared: boolean
  onCancel: () => void; onSend: (who?: { staffNo: string; pin: string }) => Promise<string | null>
}): JSX.Element {
  const [no, setNo] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(localNow())
  useEffect(() => { const t = setInterval(() => setNow(localNow()), 15000); return () => clearInterval(t) }, [])
  const yes = (): void => {
    if (shared && (no.trim() === '' || pin === '')) { setErr('スタッフNoとPINを入力してください'); return }
    setBusy(true); setErr(null)
    void onSend(shared ? { staffNo: no.trim(), pin } : undefined).then((e) => { setErr(e); setBusy(false) })
  }
  return (
    <div className="jy-overlay" role="presentation">
      <section className="jy-sheet" role="dialog" aria-modal="true" aria-labelledby="jy-cf">
        <h2 id="jy-cf" className="jy-sheet-title">{TYPE_LABEL[type]}を<br />報告しますか？</h2>
        <dl className="jy-dl">
          <dt>現場</dt><dd>{ctx.site.name}</dd>
          <dt>勤務枠</dt><dd>{slot.name} {hm(slot.workStart)}〜{hm(slot.workEnd)}</dd>
          {!shared && <><dt>氏名</dt><dd>{ctx.staff?.name}</dd></>}
          <dt>時刻</dt><dd>{hm(now.slice(11, 16))}</dd>
        </dl>
        {shared && (
          <div className="jy-shared-auth">
            <label className="jy-field" htmlFor="jy-sno">スタッフNo
              <input id="jy-sno" className="jy-input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} />
            </label>
            <label className="jy-field" htmlFor="jy-spin">PIN
              <input id="jy-spin" className="jy-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
          </div>
        )}
        {err && <p className="jy-err" role="alert">{err}</p>}
        <button type="button" className="jy-btn jy-btn-green jy-btn-yes" disabled={busy} onClick={yes}>{busy ? '送信中…' : 'はい'}</button>
        <button type="button" className="jy-btn jy-btn-outline" disabled={busy} onClick={onCancel}>いいえ</button>
      </section>
    </div>
  )
}

function OtherForm({ ctx, slot, shared, onBack, onSend }: {
  ctx: ReportContext; slot: CtxSlot; shared: boolean; onBack: () => void
  onSend: (kind: JyobanOtherKind, eta: string | undefined, note: string, who?: { staffNo: string; pin: string }) => Promise<string | null>
}): JSX.Element {
  const [kind, setKind] = useState<JyobanOtherKind | undefined>(undefined)
  const [eta, setEta] = useState('')
  const [note, setNote] = useState('')
  const [no, setNo] = useState('')
  const [pin, setPin] = useState('')
  const [errs, setErrs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const def = JYOBAN_OTHER_KINDS.find((k) => k.kind === kind)
  const send = (): void => {
    const e = validateOtherReport({ kind, eta: eta || undefined, note })
    if (shared && (no.trim() === '' || pin === '')) e.push('スタッフNoとPINを入力してください')
    setErrs(e)
    if (e.length > 0 || kind === undefined) return
    setBusy(true)
    void onSend(kind, def?.needsEta ? eta : undefined, note, shared ? { staffNo: no.trim(), pin } : undefined)
      .then((m) => { if (m) setErrs([m]); setBusy(false) })
  }
  return (
    <>
      <header className="jy-head jy-head-sub-page">
        <button type="button" className="jy-back" aria-label="戻る" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5L8 12L15 19" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div><b className="jy-sub-title">その他の報告</b><br /><span className="jy-head-sub">{ctx.site.name}{ctx.staff ? ` ｜ ${ctx.staff.name}` : ''} ｜ {slot.name}</span></div>
      </header>
      <main className="jy-main">
        <fieldset className="jy-kinds">
          <legend className="jy-label">内容を選んでください</legend>
          <div className="jy-kind-grid" role="radiogroup" aria-label="内容">
            {JYOBAN_OTHER_KINDS.map((k) => (
              <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind}
                className={`jy-kind${kind === k.kind ? ' on' : ''}`} onClick={() => setKind(k.kind)}>{k.label}</button>
            ))}
          </div>
        </fieldset>
        {def?.needsEta && (
          <label className="jy-field" htmlFor="jy-eta"><span>到着見込み時刻<span className="jy-req">必須</span></span>
            <input id="jy-eta" className="jy-input jy-input-big" type="time" value={eta} onChange={(e) => setEta(e.target.value)} />
          </label>
        )}
        <label className="jy-field" htmlFor="jy-note"><span>メモ{kind === 'other' ? <span className="jy-req">必須</span> : '（任意）'}</span>
          <textarea id="jy-note" className="jy-input" rows={3} maxLength={500} placeholder="例：中央線の遅延で15分ほど遅れます" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {shared && (
          <div className="jy-shared-auth">
            <label className="jy-field" htmlFor="jy-ono">スタッフNo<input id="jy-ono" className="jy-input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} /></label>
            <label className="jy-field" htmlFor="jy-opin">PIN<input id="jy-opin" className="jy-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
          </div>
        )}
        {errs.length > 0 && <ul className="jy-err" role="alert">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
        <button type="button" className="jy-btn jy-btn-orange jy-btn-tall jy-push" disabled={busy} onClick={send}>{busy ? '送信中…' : '本社へ報告する'}</button>
        <p className="jy-note jy-center">送信後、本社から電話で確認することがあります</p>
      </main>
    </>
  )
}

/** 掛け持ちの隊員向け: これまでQRを読んだ現場から、今日報告する現場を選ぶ。 */
function SitePicker({ sites, current, notice, onPick, onCancel }: {
  sites: RecentSite[]; current: string | null; notice?: string; onPick: (token: string) => void; onCancel?: () => void
}): JSX.Element {
  return (
    <main className="jy-main">
      <h2 className="jy-h2">どの現場の報告ですか？</h2>
      {notice && <p className="jy-warn" role="alert">{notice}</p>}
      <ul className="jy-pick-list">
        {sites.map((s) => (
          <li key={s.token}>
            <button type="button" className={`jy-pick${s.token === current ? ' on' : ''}`} onClick={() => onPick(s.token)}>
              <b>{s.name}</b>
              <span>最後に開いた日 {mdw(s.usedAt.slice(0, 10))}{s.token === current ? ' ｜ いま表示中' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="jy-note">一覧にない現場は、その現場に掲示されたQRコードを読み取ってください。</p>
      {onCancel && <button type="button" className="jy-btn jy-btn-outline jy-push" onClick={onCancel}>戻る</button>}
    </main>
  )
}

export function JyobanApp({ pathname }: { pathname: string }): JSX.Element {
  const start = useMemo(() => resolveStart(pathname), [pathname])
  const [token, setToken] = useState<string | null>(start.token)
  const [picking, setPicking] = useState(start.pick)
  const [pickNotice, setPickNotice] = useState<string | undefined>(undefined)
  const [ctx, setCtx] = useState<ReportContext | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>({ kind: 'home' })
  const [slotId, setSlotId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ReportType | null>(null)
  const [pending, setPending] = useState(outbox().length)
  const [online, setOnline] = useState(globalThis.navigator?.onLine !== false)
  const [toast, setToast] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    if (token === null) return
    try {
      const c = await fetchContext(token)
      setCtx(c); setLoadErr(null)
      rememberSite(token, c.site.name)
      setSlotId((cur) => (cur !== null && c.slots.some((s) => s.id === cur) ? cur : c.slots[0]?.id ?? null))
    } catch (e) {
      const msg = (e as Error).message
      if (!(e instanceof NetworkError) && msg.startsWith('QRコードが無効')) {
        // QRが再発行された等で使えない現場は一覧から外し、他に覚えている現場があれば選び直してもらう
        const name = recentSites().find((x) => x.token === token)?.name ?? '前回の現場'
        forgetSite(token)
        if (recentSites().length > 0) { setCtx(null); setToken(null); setPickNotice(`${name}のQRは使えなくなりました（再発行されています）。現場に掲示された新しいQRを読み取るか、下から選んでください。`); setPicking(true); return }
      }
      setLoadErr(e instanceof NetworkError ? '通信できません。電波の良い場所で開き直してください' : msg)
    }
  }, [token])

  const switchTo = (t: string): void => {
    setPicking(false); setPickNotice(undefined)
    if (t === token) return
    setCtx(null); setLoadErr(null); setSlotId(null); setConfirm(null); setScreen({ kind: 'home' })
    setToken(t)
    try { window.history.replaceState(null, '', `/app/r/${t}`) } catch { /* ignore */ }
  }

  const flush = useCallback(async (): Promise<void> => {
    if (outbox().length === 0) return
    const r = await flushOutbox()
    setPending(r.remaining)
    if (r.sent > 0) setToast(`送信待ちの報告を${r.sent}件送信しました`)
    if (r.failed.length > 0) setToast(`送信できなかった報告があります: ${r.failed[0]!.message}`)
    if (r.sent > 0 || r.failed.length > 0) void reload()
  }, [reload])

  useEffect(() => { void reload().then(flush) }, [reload, flush])
  useEffect(() => {
    const on = (): void => { setOnline(true); void flush() }
    const off = (): void => setOnline(false)
    const vis = (): void => { if (document.visibilityState === 'visible') void reload().then(flush) }
    window.addEventListener('online', on); window.addEventListener('offline', off); document.addEventListener('visibilitychange', vis)
    const t = setInterval(() => { void reload() }, 60000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); clearInterval(t) }
  }, [reload, flush])
  useEffect(() => { if (toast === null) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  if (picking) {
    return (
      <div className="jy-app"><Header ctx={ctx} shared={false} online={online} />
        <SitePicker sites={recentSites()} current={token} notice={pickNotice} onPick={switchTo}
          onCancel={token !== null && ctx !== null ? () => setPicking(false) : undefined} />
      </div>
    )
  }
  if (token === null) {
    return <div className="jy-app"><Header ctx={null} shared={false} online={online} /><main className="jy-main"><p className="jy-lead">現場に掲示されたQRコードをスマホのカメラで読み取ってください。</p></main></div>
  }
  if (loadErr !== null && ctx === null) {
    return <div className="jy-app"><Header ctx={null} shared={false} online={online} /><main className="jy-main"><p className="jy-err" role="alert">{loadErr}</p><button type="button" className="jy-btn jy-btn-outline" onClick={() => { void reload() }}>再読み込み</button></main></div>
  }
  if (ctx === null) return <div className="jy-app"><Header ctx={null} shared={false} online={online} /><main className="jy-main"><p className="jy-lead" role="status">読み込み中…</p></main></div>

  const personal = ctx.staff !== null
  const shared = !personal && ctx.site.shared
  const slot = ctx.slots.find((s) => s.id === slotId)

  // 本人登録（個人スマホで未登録。共用端末ONの現場でも「自分のスマホとして登録」できる）
  if (screen.kind === 'register' || (!personal && !shared && screen.kind === 'home')) {
    return <div className="jy-app"><Header ctx={ctx} shared={false} online={online} /><Register token={token} onDone={(d) => setScreen({ kind: 'confirmMe', device: d })} /></div>
  }
  if (screen.kind === 'confirmMe') {
    return (
      <div className="jy-app"><Header ctx={ctx} shared={false} online={online} />
        <ConfirmMe device={screen.device}
          onYes={() => { const { pinMustChange: _p, ...d } = screen.device; saveDevice(d); setScreen({ kind: 'home' }); void reload() }}
          onNo={() => setScreen({ kind: 'register' })} />
      </div>
    )
  }

  const send = async (type: ReportType, extra: { otherKind?: JyobanOtherKind; eta?: string; note?: string }, who?: { staffNo: string; pin: string }): Promise<string | null> => {
    if (slot === undefined) return '勤務枠を選んでください'
    try {
      const out = await submitReport(token, { slotId: slot.id, type, ...extra, ...(who ?? {}) })
      setConfirm(null)
      if (out.status === 'queued') { setPending(outbox().length); setScreen({ kind: 'done', type, at: null, reportId: null, queued: true }) }
      else setScreen({ kind: 'done', type, at: out.result.receivedAt, reportId: shared ? null : out.result.reportId, queued: false, label: out.result.duplicate ? '送信済みの報告があります' : undefined })
      void reload()
      return null
    } catch (e) {
      if (e instanceof NetworkError) return '通信できません。現場スマホの場合は電波の良い場所でもう一度押してください'
      if (e instanceof ReportAuthError && !shared && /本人登録/.test(e.message)) { saveDevice(null); setConfirm(null); setScreen({ kind: 'register' }) }
      return (e as Error).message
    }
  }

  if (screen.kind === 'other' && slot !== undefined) {
    return (
      <div className="jy-app">
        <OtherForm ctx={ctx} slot={slot} shared={shared} onBack={() => setScreen({ kind: 'home' })}
          onSend={(kind, eta, note, who) => send('other', { otherKind: kind, eta, note: note.trim() || undefined }, who)} />
      </div>
    )
  }

  if (screen.kind === 'done') {
    const myButtons = slot ? reportButtons(slot, slot.workDate, slot.reports) : []
    return (
      <div className="jy-app"><Header ctx={ctx} shared={shared} online={online} />
        <main className="jy-main jy-done" role="status">
          <svg width="112" height="112" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill={screen.queued ? '#f59e0b' : '#10B981'} />{screen.queued
            ? <path d="M60 32V62L78 74" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M34 61L52 79L87 44" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />}</svg>
          <h2 className={`jy-done-title${screen.queued ? ' jy-done-wait' : ''}`}>{screen.queued ? `${TYPE_LABEL[screen.type]}は送信待ちです` : `${TYPE_LABEL[screen.type]}を送信しました`}</h2>
          {screen.at && <p className="jy-done-time">{hm(screen.at.slice(11, 16))}</p>}
          <p className="jy-lead jy-center">{screen.queued ? '電波が戻ると自動で本社へ送ります。アプリを閉じても大丈夫です。' : (screen.label ?? '本社に届きました')}</p>
          {personal && myButtons.length > 0 && (
            <dl className="jy-done-sum">
              {myButtons.map((b) => <div key={b.type}><dt>{b.label}</dt><dd className={b.done ? 'ok' : ''}>{b.done ? `済 ${hm(b.doneAt ?? '')}` : b.skipped ? '不要' : '未送信'}</dd></div>)}
              <div><dt>氏名</dt><dd>{ctx.staff?.name}</dd></div>
            </dl>
          )}
          <button type="button" className="jy-btn jy-btn-outline-navy jy-push" onClick={() => setScreen({ kind: 'home' })}>閉じる</button>
          {screen.reportId !== null && (
            <button type="button" className="jy-link-danger" onClick={() => {
              if (!window.confirm(`${TYPE_LABEL[screen.type]}を取り消しますか？`)) return
              void voidReport(token, screen.reportId!).then(() => { setToast('取り消しました。もう一度報告できます'); setScreen({ kind: 'home' }); void reload() })
                .catch((e: Error) => setToast(e.message))
            }}>間違えた場合は取り消す</button>
          )}
        </main>
      </div>
    )
  }

  // ── ホーム ──
  const buttons = slot ? reportButtons(slot, slot.workDate, slot.reports) : []
  return (
    <div className="jy-app">
      <Header ctx={ctx} slot={slot} shared={shared} online={online} onSwitch={recentSites().length > 1 ? () => setPicking(true) : undefined} />
      <main className="jy-main">
        {personal && (
          <div className="jy-card jy-who">
            <span><b className="jy-who-name">{ctx.staff!.name} さん</b><br /><span className="jy-muted">スタッフNo {ctx.staff!.no} ｜ 本人登録済み</span></span>
            <button type="button" className="jy-link" onClick={() => { saveDevice(null); setScreen({ kind: 'register' }) }}>別の人で登録</button>
          </div>
        )}
        {shared && <p className="jy-lead">報告するときに、スタッフNoとPINで本人確認します。</p>}
        {pending > 0 && <p className="jy-pending" role="status">送信待ち {pending}件 ｜ 電波が戻ると自動で送ります</p>}

        {ctx.slots.length > 1 && (
          <div className="jy-slots" role="radiogroup" aria-label="勤務枠">
            {ctx.slots.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === slotId} className={`jy-slot-chip${s.id === slotId ? ' on' : ''}`} onClick={() => setSlotId(s.id)}>
                {s.name}<span>{hm(s.workStart)}〜</span>
              </button>
            ))}
          </div>
        )}

        {slot === undefined ? (
          <p className="jy-card jy-lead">いま報告を受け付けている勤務枠はありません。勤務の12時間前から報告できます。</p>
        ) : (
          <>
            {buttons.map((b) => {
              if (b.done) {
                return (
                  <div key={b.type} className="jy-done-row">
                    <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="17" fill="#10B981" /><path d="M10 18.5L15.5 24L26 13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <span><b>{b.label} 済み</b><br />{hm(b.doneAt ?? '')} 送信（締切 {hm(b.due)}）{shared && slot.reports.find((r) => r.type === b.type) ? ` ｜ ${slot.reports.find((r) => r.type === b.type)!.staffName}` : ''}</span>
                  </div>
                )
              }
              if (b.skipped) return <p key={b.type} className="jy-skip">{b.label}：上番連絡済みのため不要</p>
              return (
                <button key={b.type} type="button" className={b.primary ? 'jy-big' : 'jy-btn jy-btn-navy jy-btn-tall'} onClick={() => setConfirm(b.type)}>
                  {b.primary && <svg width="40" height="40" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 4L37 9.5V21C37 30 30.5 37 22 40C13.5 37 7 30 7 21V9.5Z" fill="none" stroke="#10B981" strokeWidth="2.5" /><path d="M15 22L20 27L29.5 17" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  <span className={b.primary ? 'jy-big-label' : ''}>{b.label}</span>
                  <span className={b.primary ? 'jy-big-sub' : 'jy-small'}>締切 {hm(b.due)} ｜ 現在 {hm(localNow().slice(11, 16))}</span>
                </button>
              )
            })}
            <button type="button" className="jy-btn jy-btn-orange-outline" onClick={() => setScreen({ kind: 'other' })}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#C2410C" strokeWidth="2" /><path d="M12 7V12.5L15.5 14.5" fill="none" stroke="#C2410C" strokeWidth="2" strokeLinecap="round" /></svg>
              その他の報告（遅刻・寝坊など）
            </button>
          </>
        )}
        {shared && <button type="button" className="jy-link jy-center" onClick={() => setScreen({ kind: 'register' })}>自分のスマホとして登録する</button>}
        <p className="jy-note jy-center jy-foot">{personal ? <>電波がない場所でも押せます。<br />つながった時点で本社へ自動送信します。</> : <>共用端末のため、このスマホに名前やPINは保存しません。</>}</p>
      </main>
      {confirm !== null && slot !== undefined && (
        <ConfirmSheet ctx={ctx} slot={slot} type={confirm} shared={shared} onCancel={() => setConfirm(null)} onSend={(who) => send(confirm, {}, who)} />
      )}
      {toast && <div className="jy-toast" role="status">{toast}</div>}
    </div>
  )
}
