// [会社] 上番報告の設定（本社のみ）。現場ごとに 共用端末の有無・報告用QR・勤務枠（出発/上番連絡の要否・締切・猶予・曜日）を設定する。
import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { buildReportUrl, type JyobanSlot, type SlotFieldError } from '@mamorai/input-core'
import {
  listSites, listSlots, saveSlot, issueReportToken, setSharedDevice, publicOrigin,
  JyobanValidationError, type JyobanSite,
} from './jyobanApi.js'
import { printSiteQr } from './jyobanPrint.js'

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
    departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '07:45',
    graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
  }
}

function SlotEditor({ initial, index, onSaved, onCancel }: {
  initial: JyobanSlot; index: number; onSaved: (s: JyobanSlot, msg: string) => void; onCancel?: () => void
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

      <div className="jy-reports">
        <div className="jy-report">
          <div className="jy-report-h"><b>出発連絡</b>
            <Switch on={s.departureRequired} label="出発連絡" onText="要" offText="不要"
              onChange={(v) => { set('departureRequired', v); if (v && s.departureDue === null) set('departureDue', '06:30') }} />
          </div>
          <label className="fl" htmlFor={fid('dep')}>締切
            <input id={fid('dep')} className="input" type="time" disabled={!s.departureRequired}
              value={s.departureDue ?? ''} onChange={(e) => set('departureDue', e.target.value || null)} />
          </label>
        </div>
        <div className="jy-report">
          <div className="jy-report-h"><b>上番連絡</b>
            <Switch on={s.ondutyRequired} label="上番連絡" onText="要" offText="不要"
              onChange={(v) => { set('ondutyRequired', v); if (v && s.ondutyDue === null) set('ondutyDue', s.workStart) }} />
          </div>
          <label className="fl" htmlFor={fid('on')}>締切
            <input id={fid('on')} className="input" type="time" disabled={!s.ondutyRequired}
              value={s.ondutyDue ?? ''} onChange={(e) => set('ondutyDue', e.target.value || null)} />
          </label>
        </div>
        <div className="jy-report">
          <div className="jy-report-h"><b>アラート</b></div>
          <label className="fl" htmlFor={fid('grace')}>猶予
            <select id={fid('grace')} className="input" value={s.graceMin} onChange={(e) => set('graceMin', Number(e.target.value))}>
              {GRACE.map((g) => <option key={g} value={g}>{g}分</option>)}
            </select>
          </label>
          <span className="muted jy-hint">締切＋猶予を過ぎても届かなければ「未連絡」</span>
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
        <span className="muted">現場 {sites.length} ／ 勤務枠ごとに出発連絡・上番連絡の要否と締切を設定します（本社のみ）</span>
      </header>
      {loadError && <div className="card"><div className="card-b jy-errors" role="alert">{loadError}</div></div>}

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
                {slots.map((s, i) => <SlotEditor key={s.id} initial={s} index={i} onSaved={onSaved} />)}
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
