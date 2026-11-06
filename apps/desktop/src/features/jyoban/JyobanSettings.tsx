// [会社] 上番報告の設定（本社のみ）。現場ごとに 共用端末の有無・報告用QR・勤務枠（起床/出発/上番/下番連絡の要否・締切・猶予・曜日・担当者）、
//   会社全体で未報告時の自動通知（アプリ通知・SMS・電話・管制メール）を設定する。
import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { buildReportUrl, type JyobanSlot, type SlotFieldError } from '@mamorai/input-core'
import {
  listSites, listSlots, saveSlot, issueReportToken, setSharedDevice, publicOrigin,
  JyobanValidationError, type JyobanSite,
} from './jyobanApi.js'
import { printSiteQr } from './jyobanPrint.js'
import {
  getNotifySettings, saveNotifySettings, listSlotStaff, setSlotStaff, setStaffPhone, listNotifications, parseEmails,
  DEFAULT_NOTIFY, type NotifySettings, type SlotStaff, type NotificationLog,
} from './callsApi.js'

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const GRACE = [0, 5, 10, 15, 30]

function Switch({ on, onChange, label, onText = 'ON', offText = 'OFF' }: {
  on: boolean; onChange: (v: boolean) => void; label: string; onText?: string; offText?: string
}): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`jy-switch ${on ? 'jy-on' : 'jy-off'}`} onClick={() => onChange(!on)}>
      <span className="jy-track"><span className="jy-knob" /></span>
      <span className="jy-switch-text">{on ? onText : offText}</span>
    </button>
  )
}

function newSlot(siteId: string): JyobanSlot {
  return {
    id: '', siteId, name: '', workStart: '08:00', workEnd: '17:00',
    wakeupRequired: false, wakeupDue: null,
    departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '07:45',
    offdutyRequired: false, offdutyDue: null,
    graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
  }
}

function ReportBox({ label, hint, on, due, id, onToggle, onDue }: {
  label: string; hint: string; on: boolean; due: string | null; id: string; onToggle: (v: boolean) => void; onDue: (v: string | null) => void
}): JSX.Element {
  return (
    <div className="jy-report">
      <div className="jy-report-h"><b>{label}</b>
        <Switch on={on} label={label} onText="要" offText="不要" onChange={onToggle} />
      </div>
      <label className="fl" htmlFor={id}>締切
        <input id={id} className="input" type="time" disabled={!on} value={due ?? ''} onChange={(e) => onDue(e.target.value || null)} />
      </label>
      <span className="muted jy-hint">{hint}</span>
    </div>
  )
}

/** 勤務枠の担当者（未報告のとき本人へ知らせる相手）と電話番号 */
function SlotAssignees({ slotId, onMsg }: { slotId: string; onMsg: (m: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<SlotStaff[] | null>(null)
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (): Promise<void> => {
    try {
      const l = await listSlotStaff(slotId)
      setList(l); setPhones(Object.fromEntries(l.map((x) => [x.staffId, x.phone ?? ''])))
    } catch (e) { onMsg(`担当者を読み込めませんでした: ${(e as Error).message}`) }
  }, [slotId, onMsg])
  useEffect(() => { if (open && list === null) void load() }, [open, list, load])
  const assigned = list?.filter((x) => x.assigned) ?? []

  const toggle = async (id: string, on: boolean): Promise<void> => {
    if (list === null) return
    const ids = list.filter((x) => (x.staffId === id ? on : x.assigned)).map((x) => x.staffId)
    setBusy(true)
    try { await setSlotStaff(slotId, ids); setList(list.map((x) => (x.staffId === id ? { ...x, assigned: on } : x))) }
    catch (e) { onMsg(`保存できませんでした: ${(e as Error).message}`) }
    finally { setBusy(false) }
  }
  const savePhone = async (x: SlotStaff): Promise<void> => {
    const v = phones[x.staffId] ?? ''
    if ((x.phone ?? '') === v.replace(/[-\s()]/g, '')) return
    try {
      const p = await setStaffPhone(x.staffId, v)
      setList((l) => l?.map((y) => (y.staffId === x.staffId ? { ...y, phone: p } : y)) ?? null)
      onMsg(`${x.name} の電話番号を保存しました`)
    } catch (e) { onMsg((e as Error).message) }
  }

  return (
    <div className="jy-assign">
      <button type="button" className="jy-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} 担当者と連絡先{list !== null ? `（${assigned.length}名）` : ''}
      </button>
      {open && (
        list === null ? <p className="muted">読み込み中…</p> : list.length === 0 ? (
          <p className="muted">この現場に所属する隊員がいません。隊員の所属現場を登録すると、ここで担当者を選べます。担当者がいない枠は、未報告のとき管制へのメールだけを送ります。</p>
        ) : (
          <table className="jy-assign-table">
            <thead><tr><th>担当</th><th>スタッフNo</th><th>氏名</th><th>電話番号（SMS・電話）</th><th>アプリ通知</th></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.staffId}>
                  <td><input type="checkbox" aria-label={`${x.name}を担当にする`} checked={x.assigned} disabled={busy} onChange={(e) => { void toggle(x.staffId, e.target.checked) }} /></td>
                  <td>{x.staffNo}</td>
                  <td>{x.name}</td>
                  <td><input className="input" type="tel" inputMode="tel" aria-label={`${x.name}の電話番号`} placeholder="090-1234-5678"
                    value={phones[x.staffId] ?? ''} onChange={(e) => setPhones((p) => ({ ...p, [x.staffId]: e.target.value }))}
                    onBlur={() => { void savePhone(x) }} /></td>
                  <td>{x.hasPush ? '受け取る' : <span className="muted">未設定</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  )
}

/** 会社全体の未報告コール設定（誰に・何で・何分後に） */
function NotifyCard({ onMsg }: { onMsg: (m: string) => void }): JSX.Element {
  const [s, setS] = useState<NotifySettings | null>(null)
  const [created, setCreated] = useState(true)
  const [emails, setEmails] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<NotificationLog[]>([])
  useEffect(() => {
    void getNotifySettings().then((v) => {
      setCreated(v !== null)
      const x = v ?? { ...DEFAULT_NOTIFY }
      setS(x); setEmails(x.emailTo.join(', '))
    }).catch((e: Error) => onMsg(`通知設定を読み込めませんでした: ${e.message}`))
    void listNotifications().then(setLog).catch(() => setLog([]))
  }, [onMsg])
  if (s === null) return <section className="card"><div className="card-b muted">通知設定を読み込み中…</div></section>
  const set = <K extends keyof NotifySettings>(k: K, v: NotifySettings[K]): void => { setS({ ...s, [k]: v }); setDirty(true) }
  const num = (k: 'remindAfterMin' | 'voiceAfterMin' | 'escalateAfterMin', label: string, max: number): JSX.Element => (
    <label className="fl">{label}
      <span className="jy-times"><input className="input jy-num" type="number" min={0} max={max} value={s[k]} onChange={(e) => set(k, Number(e.target.value))} />分後</span>
    </label>
  )
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await saveNotifySettings({ ...s, emailTo: parseEmails(emails) })
      setDirty(false); setCreated(true); onMsg('未報告の通知設定を保存しました')
    } catch (e) { onMsg(`保存できませんでした: ${(e as Error).message}`) }
    finally { setBusy(false) }
  }
  const CH: Record<string, string> = { push: 'アプリ通知', sms: 'SMS', voice: '電話', email: 'メール' }
  const ST: Record<string, string> = { sent: '送信', failed: '失敗', skipped: '未設定', sending: '送信中' }
  const TY: Record<string, string> = { wakeup: '起床', departure: '出発', onduty: '上番', offduty: '下番' }
  return (
    <section className="card" aria-label="未報告の自動通知">
      <div className="card-h">
        <h2>未報告の自動通知（起床・出発・上番・下番コール）</h2>
        <Switch on={s.enabled} label="未報告の自動通知" onText="使う" offText="止める" onChange={(v) => set('enabled', v)} />
      </div>
      <div className="card-b">
        {!created && <p className="jy-hint">まだ保存されていません。保存すると通知が始まります。</p>}
        <p className="muted">締切＋猶予を過ぎても報告がないと、担当者本人へ「アプリ通知・SMS → 電話」、続いて管制へメールで知らせます。本人が報告するか「その他」で遅刻・寝坊を連絡すると、その報告の通知は止まります（下番は下番連絡のみ）。</p>
        <div className="jy-notify-grid">
          <fieldset className="fl"><legend>本人へ</legend>
            <label className="jy-check"><input type="checkbox" checked={s.push} onChange={(e) => set('push', e.target.checked)} />アプリ通知</label>
            <label className="jy-check"><input type="checkbox" checked={s.sms} onChange={(e) => set('sms', e.target.checked)} />SMS（有料）</label>
            <label className="jy-check"><input type="checkbox" checked={s.voice} onChange={(e) => set('voice', e.target.checked)} />自動音声電話（有料）</label>
          </fieldset>
          <div className="fl">タイミング（締切＋猶予から）
            {num('remindAfterMin', 'アプリ通知・SMS', 60)}
            {num('voiceAfterMin', '電話', 120)}
            {num('escalateAfterMin', '管制へメール', 180)}
          </div>
          <label className="fl">管制・本社のメール宛先（カンマ区切り・10件まで）
            <textarea className="input" rows={3} value={emails} placeholder="kanri@example.co.jp, yakan@example.co.jp"
              onChange={(e) => { setEmails(e.target.value); setDirty(true) }} />
          </label>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" disabled={busy || (!dirty && created)} onClick={() => { void save() }}>{busy ? '保存中…' : '通知設定を保存'}</button>
        </div>
        {log.length > 0 && (
          <details className="jy-log">
            <summary>最近の送信記録（{log.length}件）</summary>
            <table className="jy-assign-table">
              <thead><tr><th>日時</th><th>報告</th><th>手段</th><th>結果</th><th>詳細</th></tr></thead>
              <tbody>{log.map((n) => (
                <tr key={n.id}>
                  <td>{new Date(n.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{TY[n.reportType] ?? n.reportType}</td><td>{CH[n.channel] ?? n.channel}</td>
                  <td>{ST[n.status] ?? n.status}</td><td className="muted">{n.detail ?? ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        )}
      </div>
    </section>
  )
}

function SlotEditor({ initial, index, onSaved, onCancel, onMsg }: {
  initial: JyobanSlot; index: number; onSaved: (s: JyobanSlot, msg: string) => void; onCancel?: () => void; onMsg?: (m: string) => void
}): JSX.Element {
  const [s, setS] = useState<JyobanSlot>(initial)
  const [errors, setErrors] = useState<SlotFieldError[]>([])
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(initial.id === '')
  useEffect(() => { setS(initial); setDirty(initial.id === ''); setErrors([]) }, [initial])

  const set = <K extends keyof JyobanSlot>(k: K, v: JyobanSlot[K]): void => { setS((p) => ({ ...p, [k]: v })); setDirty(true) }
  const err = (f: keyof JyobanSlot): string | undefined => errors.find((e) => e.field === f)?.message
  const fid = (f: string): string => `slot-${initial.id || 'new'}-${f}`

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const saved = await saveSlot(s, index)
      setErrors([]); setDirty(false)
      onSaved(saved, `勤務枠「${saved.name}」を保存しました`)
    } catch (e) {
      if (e instanceof JyobanValidationError) setErrors(e.errors)
      else setErrors([{ field: 'name', message: `保存できませんでした: ${(e as Error).message}` }])
    } finally { setBusy(false) }
  }

  return (
    <div className={`jy-slot${s.isActive ? '' : ' jy-slot-off'}`}>
      <div className="jy-slot-head">
        <label className="fl" htmlFor={fid('name')}>勤務枠名
          <input id={fid('name')} className="input" value={s.name} placeholder="例: 日勤1（荷捌）" onChange={(e) => set('name', e.target.value)} aria-invalid={err('name') !== undefined} />
        </label>
        <div className="fl">勤務時間
          <span className="jy-times">
            <input className="input" type="time" aria-label="勤務開始" value={s.workStart} onChange={(e) => set('workStart', e.target.value)} />
            〜
            <input className="input" type="time" aria-label="勤務終了" value={s.workEnd} onChange={(e) => set('workEnd', e.target.value)} />
          </span>
        </div>
        <fieldset className="fl jy-days">
          <legend>適用曜日</legend>
          <span>
            {DOW.map((d, i) => (
              <label key={d} className={`jy-day${s.weekdays.includes(i) ? ' jy-day-on' : ''}`}>
                <input type="checkbox" checked={s.weekdays.includes(i)}
                  onChange={(e) => set('weekdays', e.target.checked ? [...s.weekdays, i] : s.weekdays.filter((x) => x !== i))} />
                {d}
              </label>
            ))}
          </span>
        </fieldset>
        <div className="fl">稼働
          <Switch on={s.isActive} onChange={(v) => set('isActive', v)} label={`${s.name || '勤務枠'}の稼働`} onText="稼働中" offText="停止" />
        </div>
      </div>

      <div className="jy-reports jy-reports-4">
        <ReportBox label="起床連絡" hint="寝坊の防止" on={s.wakeupRequired === true} due={s.wakeupDue ?? null} id={fid('wake')}
          onToggle={(v) => { set('wakeupRequired', v); if (v && (s.wakeupDue ?? null) === null) set('wakeupDue', '05:30') }}
          onDue={(v) => set('wakeupDue', v)} />
        <ReportBox label="出発連絡" hint="自宅を出たとき" on={s.departureRequired} due={s.departureDue} id={fid('dep')}
          onToggle={(v) => { set('departureRequired', v); if (v && s.departureDue === null) set('departureDue', '06:30') }}
          onDue={(v) => set('departureDue', v)} />
        <ReportBox label="上番連絡" hint="現場に着いたとき" on={s.ondutyRequired} due={s.ondutyDue} id={fid('on')}
          onToggle={(v) => { set('ondutyRequired', v); if (v && s.ondutyDue === null) set('ondutyDue', s.workStart) }}
          onDue={(v) => set('ondutyDue', v)} />
        <ReportBox label="下番連絡" hint="勤務を終えたとき" on={s.offdutyRequired === true} due={s.offdutyDue ?? null} id={fid('off')}
          onToggle={(v) => { set('offdutyRequired', v); if (v && (s.offdutyDue ?? null) === null) set('offdutyDue', s.workEnd) }}
          onDue={(v) => set('offdutyDue', v)} />
        <div className="jy-report">
          <div className="jy-report-h"><b>アラート</b></div>
          <label className="fl" htmlFor={fid('grace')}>猶予
            <select id={fid('grace')} className="input" value={s.graceMin} onChange={(e) => set('graceMin', Number(e.target.value))}>
              {GRACE.map((g) => <option key={g} value={g}>{g}分</option>)}
            </select>
          </label>
          <span className="muted jy-hint">締切＋猶予を過ぎても届かなければ「未連絡」。本人と管制へ自動で知らせます</span>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="jy-errors" role="alert">{errors.map((e) => <li key={`${e.field}-${e.message}`}>{e.message}</li>)}</ul>
      )}
      <div className="row-actions jy-slot-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>取り消す</button>}
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => { void save() }}>
          {busy ? '保存中…' : initial.id === '' ? 'この勤務枠を追加' : '変更を保存'}
        </button>
      </div>
      {initial.id !== '' && onMsg && <SlotAssignees slotId={initial.id} onMsg={onMsg} />}
    </div>
  )
}

function QrCard({ site, onIssued }: { site: JyobanSite; onIssued: (msg: string) => void }): JSX.Element {
  const url = useMemo(() => (site.reportToken ? buildReportUrl(publicOrigin(), site.reportToken) : null), [site.reportToken])
  const [img, setImg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    if (url === null) { setImg(null); return }
    void QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then((d) => { if (alive) setImg(d) })
    return () => { alive = false }
  }, [url])

  const issue = async (): Promise<void> => {
    if (site.reportToken && !window.confirm(`${site.name} のQRを再発行します。いま現場に貼ってあるQRは使えなくなります。よろしいですか？`)) return
    setBusy(true)
    try { await issueReportToken(site.id); onIssued(site.reportToken ? 'QRを再発行しました。新しいQRを印刷して現場に掲示してください' : 'QRを発行しました') }
    catch (e) { onIssued(`QRを発行できませんでした: ${(e as Error).message}`) }
    finally { setBusy(false) }
  }

  return (
    <section className="card" aria-label="報告用QRコード">
      <div className="card-h"><h2>報告用QRコード</h2></div>
      <div className="card-b jy-qr">
        {img !== null && url !== null ? (
          <>
            <img src={img} alt={`${site.name} の報告用QRコード`} className="jy-qr-img" />
            <div className="jy-qr-side">
              <span className="muted">発行 {site.tokenIssuedAt ? new Date(site.tokenIssuedAt).toLocaleString('ja-JP') : '—'}</span>
              <button type="button" className="btn btn-primary" onClick={() => { if (!printSiteQr(site.name, url, img)) onIssued('印刷画面を開けませんでした（ポップアップを許可してください）') }}>印刷用PDF（A4）</button>
              <button type="button" className="btn jy-btn-danger" disabled={busy} onClick={() => { void issue() }}>QRを再発行</button>
            </div>
          </>
        ) : (
          <div className="jy-qr-side">
            <span className="muted">この現場のQRはまだ発行されていません。</span>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void issue() }}>QRを発行する</button>
          </div>
        )}
      </div>
    </section>
  )
}

export function JyobanSettings(): JSX.Element {
  const [sites, setSites] = useState<JyobanSite[]>([])
  const [siteId, setSiteId] = useState<string>('')
  const [slots, setSlots] = useState<JyobanSlot[]>([])
  const [draft, setDraft] = useState<JyobanSlot | null>(null)
  const [q, setQ] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reloadSites = useCallback(async (): Promise<void> => {
    try {
      const list = await listSites()
      setSites(list); setLoadError(null)
      setSiteId((cur) => (cur !== '' && list.some((x) => x.id === cur) ? cur : list[0]?.id ?? ''))
    } catch (e) { setLoadError(`現場一覧を読み込めませんでした: ${(e as Error).message}`) }
  }, [])
  useEffect(() => { void reloadSites() }, [reloadSites])
  useEffect(() => {
    setDraft(null)
    if (siteId === '') { setSlots([]); return }
    void listSlots(siteId).then(setSlots).catch((e: Error) => setLoadError(`勤務枠を読み込めませんでした: ${e.message}`))
  }, [siteId])

  const site = sites.find((x) => x.id === siteId)
  const shown = sites.filter((x) => q.trim() === '' || x.name.includes(q.trim()) || x.code.includes(q.trim()))

  const onSaved = (saved: JyobanSlot, msg: string): void => {
    setSlots((p) => (p.some((x) => x.id === saved.id) ? p.map((x) => (x.id === saved.id ? saved : x)) : [...p, saved]))
    setDraft(null); setToast(msg); void reloadSites()
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">上番報告 設定</h1>
        <span className="muted">現場 {sites.length} ／ 勤務枠ごとに起床・出発・上番・下番連絡の要否と締切、未報告時の自動通知を設定します（本社のみ）</span>
      </header>
      {loadError && <div className="card"><div className="card-b jy-errors" role="alert">{loadError}</div></div>}
      <NotifyCard onMsg={setToast} />

      <div className="jy-layout">
        <aside className="card jy-sites" aria-label="現場一覧">
          <div className="card-h"><h2>現場（{sites.length}）</h2></div>
          <div className="card-b">
            <label className="fl" htmlFor="jy-q">現場を検索
              <input id="jy-q" className="input" type="search" value={q} placeholder="現場名・施設コード" onChange={(e) => setQ(e.target.value)} />
            </label>
            <ul className="jy-site-list">
              {shown.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`jy-site${x.id === siteId ? ' jy-site-active' : ''}`} aria-current={x.id === siteId ? 'true' : undefined} onClick={() => setSiteId(x.id)}>
                    <span className="jy-site-name">{x.name}{x.isActive ? '' : '（休止中）'}</span>
                    <span className="muted">{x.dept ? `${x.dept}・` : ''}{x.slotCount}枠{x.reportToken ? '' : '・QR未発行'}</span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="muted">該当する現場はありません</li>}
            </ul>
          </div>
        </aside>

        {site ? (
          <section className="jy-detail" aria-label={`${site.name} の設定`}>
            <div className="jy-detail-head">
              <h2 className="page-title">{site.name}</h2>
              <span className="muted">施設コード {site.code}</span>
            </div>

            <div className="jy-grid2">
              <section className="card" aria-label="端末">
                <div className="card-h"><h2>端末</h2></div>
                <div className="card-b">
                  <div className="jy-row">
                    <span><b>現場スマホ（共用端末）</b><br /><span className="muted">ONにすると、名前を保存しない共用端末から報告できます</span></span>
                    <Switch on={site.sharedDevice} label="現場スマホ（共用端末）"
                      onChange={(v) => {
                        void setSharedDevice(site.id, v)
                          .then(() => { setSites((p) => p.map((x) => (x.id === site.id ? { ...x, sharedDevice: v } : x))); setToast(`現場スマホを${v ? 'ON' : 'OFF'}にしました`) })
                          .catch((e: Error) => setToast(`保存できませんでした: ${e.message}`))
                      }} />
                  </div>
                </div>
              </section>
              <QrCard site={site} onIssued={(m) => { setToast(m); void reloadSites() }} />
            </div>

            <section className="card" aria-label="勤務枠と報告時刻">
              <div className="card-h">
                <h2>勤務枠と報告時刻</h2>
                <button type="button" className="btn btn-secondary" disabled={draft !== null} onClick={() => setDraft(newSlot(site.id))}>＋ 勤務枠を追加</button>
              </div>
              <div className="card-b">
                {slots.length === 0 && draft === null && <p className="muted">勤務枠がまだありません。「＋ 勤務枠を追加」から登録してください。</p>}
                {slots.map((s, i) => <SlotEditor key={s.id} initial={s} index={i} onSaved={onSaved} onMsg={setToast} />)}
                {draft && <SlotEditor initial={draft} index={slots.length} onSaved={onSaved} onCancel={() => setDraft(null)} />}
              </div>
            </section>
          </section>
        ) : (
          <section className="card"><div className="card-b muted">左の一覧から現場を選んでください。</div></section>
        )}
      </div>
      {toast && <div className="toast" role="status" aria-live="polite" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  )
}
