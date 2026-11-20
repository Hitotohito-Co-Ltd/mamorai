// [JYB] 本日の現場一覧（設計 ⑦・要件 4.1 R2/R4/R5/R6）。
//   現場PC＝自現場、本社PC・管理者＝自社の全現場、支店＝担当現場（範囲は台帳が絞る）。
//   状態・人数・勤務表外の判定は input-core の computeCrewStatus、並び順と件数は sortSlotRows / summarizeSlotStatuses。
//   30秒ごとに読み直し、表示の時刻は1分ごとに進める（締切を過ぎた瞬間に「未連絡」へ）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  computeCrewStatus, sortSlotRows, summarizeSlotStatuses, localMinutesFrom, JYOBAN_OTHER_KINDS, GEO_STATUS_LABEL,
  type CrewStatusResult, type SlotStatus, type JyobanTimedType, type BoardReport,
} from '@mamorai/input-core'
import { fetchBoard, ackSlot, voidBoardReport, addBoardReport, type BoardData, type BoardRealm, type BoardSlot } from './jyobanBoardApi.js'

const STATUS_LABEL: Record<Exclude<SlotStatus, 'not_scheduled'>, string> = {
  missing: '未連絡', other_reported: '遅刻等の報告', departed: '出発済み', pending: '締切前', on_duty: '上番済み', acknowledged: '確認済み',
}
const TYPE_LABEL: Record<JyobanTimedType, string> = { wakeup: '起床', departure: '出発', onduty: '上番', offduty: '下番' }
const OTHER_LABEL = Object.fromEntries(JYOBAN_OTHER_KINDS.map((k) => [k.kind, k.label])) as Record<string, string>

interface Row { key: string; siteName: string; b: BoardSlot; crew: CrewStatusResult; status: SlotStatus }

/** サーバ時刻 + 経過時間で「いま」を進める（端末の時計ずれに左右されない） */
function advance(nowLocal: string, ms: number): string {
  const [d, t] = nowLocal.split('T') as [string, string]
  const [y, mo, da] = d.split('-').map(Number) as [number, number, number]
  const [h, mi] = t.split(':').map(Number) as [number, number]
  const x = new Date(Date.UTC(y, mo - 1, da, h, mi) + ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`
}

export function JyobanBoard({ realm }: { realm: BoardRealm }): JSX.Element {
  const [data, setData] = useState<BoardData | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [tick, setTick] = useState(0)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<SlotStatus | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const d = await fetchBoard(realm, date); setData(d); setFetchedAt(Date.now()); setErr(null) }
    catch (e) { setErr((e as Error).message) }
  }, [realm, date])
  useEffect(() => { void load(); const t = setInterval(() => { void load() }, 30000); return () => clearInterval(t) }, [load])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
  useEffect(() => { if (toast === null) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  const now = data === null ? '' : advance(data.nowLocal, Math.max(0, Date.now() - fetchedAt))
  const rows: Row[] = useMemo(() => {
    if (data === null) return []
    const out: Row[] = []
    for (const s of data.sites) for (const b of s.slots) {
      const crew = computeCrewStatus({
        slot: b.slot, workDate: data.date, nowMinutes: localMinutesFrom(data.date, now),
        reports: b.reports, roster: b.roster, acknowledged: b.ack !== null,
      })
      if (crew.status === 'not_scheduled' && crew.people.length === 0) continue
      out.push({ key: b.slot.id, siteName: s.name, b, crew, status: crew.status })
    }
    return sortSlotRows(out)
    // tick: 1分ごとに再計算
  }, [data, now, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = summarizeSlotStatuses(rows)
  const shown = rows.filter((r) => (filter === null || r.status === filter)
    && (q.trim() === '' || r.siteName.includes(q.trim()) || r.b.slot.name.includes(q.trim())
        || r.crew.people.some((p) => p.name.includes(q.trim()) || p.staffNo.includes(q.trim()))))
  const firstMissing = rows.find((r) => r.status === 'missing')
  const callee = firstMissing?.crew.people.find((p) => p.missingOnduty || p.missingOffduty) ?? firstMissing?.crew.people[0]

  return (
    <div className="jb">
      <div className="jb-head">
        <div>
          <h1 className="jb-title">本日の現場一覧</h1>
          <p className="muted jb-sub">
            {data ? `${data.date}・${rows.length}枠` : '読み込み中…'}
            {data && <span className="jb-live" aria-live="polite">● 自動更新中（最終受信 {data.nowLocal.slice(11, 16)}）</span>}
          </p>
        </div>
        <div className="jb-tools">
          <label className="fl">勤務日<input className="input" type="date" value={date ?? data?.date ?? ''} onChange={(e) => setDate(e.target.value || undefined)} /></label>
          <label className="fl">検索<input className="input" value={q} placeholder="現場名・勤務枠・氏名・No" onChange={(e) => setQ(e.target.value)} /></label>
          <button type="button" className="btn btn-secondary" onClick={() => { void load() }}>更新</button>
        </div>
      </div>
      {err && <p className="jy-errors" role="alert">読み込めませんでした: {err}</p>}

      {firstMissing && (
        <div className="jb-alert" role="alert">
          <b>未連絡 {counts.missing}件</b>
          <span>{firstMissing.siteName}・{firstMissing.b.slot.name}{firstMissing.crew.shortage > 0 ? `（約定${firstMissing.crew.required}名／上番${firstMissing.crew.ondutyCount}名）` : ''}</span>
          {callee?.phone && <a className="btn btn-danger" href={`tel:${callee.phone}`}>{callee.name}さんに電話</a>}
        </div>
      )}

      <div className="jb-tiles" role="group" aria-label="状態で絞り込み">
        {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => (
          <button key={k} type="button" className={`jb-tile jb-st-${k}`} aria-pressed={filter === k} onClick={() => setFilter(filter === k ? null : k)}>
            <span className="jb-tile-n">{counts[k]}</span><span>{STATUS_LABEL[k]}</span>
          </button>
        ))}
      </div>

      <div className="card jb-table-wrap">
        <table className="jb-table">
          <thead><tr><th>状態</th><th>現場・勤務枠</th><th>人数</th><th>勤務員（上番・下番）</th><th>対応</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="muted">{data ? '該当する勤務枠はありません' : '読み込み中…'}</td></tr>}
            {shown.map((r) => (
              <RowView key={r.key} r={r} realm={realm} date={data!.date} open={open === r.key}
                onToggle={() => setOpen(open === r.key ? null : r.key)}
                onDone={(m) => { setToast(m); void load() }} />
            ))}
          </tbody>
        </table>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function GeoChip({ r }: { r?: BoardReport }): JSX.Element | null {
  if (r?.geoStatus == null || r.geoStatus === 'inside') return null
  return <span className="jb-chip jb-chip-warn" title={r.geoDistanceM != null ? `現場の中心から約${r.geoDistanceM}m` : undefined}>{GEO_STATUS_LABEL[r.geoStatus]}</span>
}

function RowView({ r, realm, date, open, onToggle, onDone }: {
  r: Row; realm: BoardRealm; date: string; open: boolean; onToggle: () => void; onDone: (msg: string) => void
}): JSX.Element {
  const { crew, b } = r
  const [busy, setBusy] = useState(false)
  const [e, setE] = useState<string | null>(null)
  const st = crew.status === 'not_scheduled' ? null : crew.status
  const ack = async (): Promise<void> => {
    setBusy(true); setE(null)
    try { await ackSlot(realm, b.slot.id, date, ''); onDone('確認済みにしました') } catch (x) { setE((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <tr className={st === 'missing' ? 'jb-row-missing' : undefined}>
        <td>{st ? <span className={`jb-chip jb-st-${st}`}>{STATUS_LABEL[st]}</span> : <span className="jb-chip">稼働なし</span>}</td>
        <td><b>{r.siteName}</b><br /><span className="muted">{b.slot.name} {b.slot.workStart}〜{b.slot.workEnd}</span></td>
        <td className={crew.shortage > 0 && crew.ondutyOverdue ? 'jb-short' : undefined}>
          上番 {crew.ondutyCount}／約定 {crew.required}
          {crew.shortage > 0 && <><br /><span className={crew.ondutyOverdue ? 'jb-short' : 'muted'}>不足 {crew.shortage}名</span></>}
        </td>
        <td>
          {crew.people.length === 0 && <span className="muted">まだ報告がありません</span>}
          <ul className="jb-people">
            {crew.people.map((p) => (
              <li key={p.staffNo} className={p.missingOnduty || p.missingOffduty ? 'jb-person-missing' : undefined}>
                <span className="jb-name">{p.name}<span className="muted">（No.{p.staffNo}）</span></span>
                {p.onduty.at === null && p.departure.at !== null && <span>出発 {p.departure.at}</span>}
                <span>上番 {p.onduty.at ?? (p.missingOnduty ? '未連絡' : '―')}</span><GeoChip r={p.onduty.report} />
                <span>下番 {p.offduty.at ?? (p.missingOffduty ? '未連絡' : '―')}</span><GeoChip r={p.offduty.report} />
                {p.onRoster === false && <span className="jb-chip jb-chip-info">勤務表外</span>}
                {p.corrected && <span className="jb-chip">訂正あり</span>}
                {p.other && <span className="jb-chip jb-st-other_reported">{OTHER_LABEL[p.other.otherKind ?? 'other']}{p.other.eta ? ` ${p.other.eta}着` : ''}</span>}
                {p.phone && (p.missingOnduty || p.missingOffduty) && <a href={`tel:${p.phone}`} className="jb-tel">電話</a>}
              </li>
            ))}
          </ul>
          {crew.voided.length > 0 && <p className="muted jb-voided">取消 {crew.voided.length}件（記録は残っています）</p>}
        </td>
        <td className="jb-actions">
          {b.ack ? <span className="muted">{b.ack.at.slice(11, 16)} {b.ack.by} 確認</span>
            : (st === 'missing' || st === 'other_reported') && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void ack() }}>確認済みにする</button>}
          <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={onToggle}>訂正</button>
          {e && <span className="jy-errors" role="alert">{e}</span>}
        </td>
      </tr>
      {open && <tr className="jb-fix-row"><td colSpan={5}><CorrectionPanel r={r} realm={realm} date={date} onDone={onDone} /></td></tr>}
    </>
  )
}

function CorrectionPanel({ r, realm, date, onDone }: { r: Row; realm: BoardRealm; date: string; onDone: (msg: string) => void }): JSX.Element {
  const live = r.b.reports.filter((x) => x.voided !== true && x.type !== 'other')
  const [target, setTarget] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [add, setAdd] = useState<{ type: JyobanTimedType; staffNo: string; time: string; reason: string }>({ type: 'onduty', staffNo: '', time: '', reason: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<void>, msg: string): Promise<void> => {
    setBusy(true); setErr(null)
    try { await f(); onDone(msg) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="jb-fix">
      <p className="muted">勤務員は報告を取り消せません。誤りはここで理由を書いて訂正します。元の記録は消えず、誰がいつ直したかが残ります。</p>
      <h3>報告を取り消す</h3>
      {live.length === 0 ? <p className="muted">取り消せる報告はありません</p> : (
        <ul className="jb-fix-list">
          {live.map((x) => (
            <li key={x.id}>
              <span>{x.receivedAt.slice(11, 16)} {TYPE_LABEL[x.type as JyobanTimedType]} {x.staffName}（No.{x.staffNo}）{x.enteredBy ? `｜後から登録: ${x.enteredBy}` : ''}</span>
              {target === x.id ? (
                <span className="jb-fix-form">
                  <input className="input" aria-label="取り消す理由" placeholder="理由（例: 別の人が誤って押した）" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { void run(() => voidBoardReport(realm, x.id, reason), '報告を取り消しました（記録は残ります）') }}>取り消す</button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setTarget(null); setReason('') }}>やめる</button>
                </span>
              ) : <button type="button" className="btn btn-secondary" onClick={() => { setTarget(x.id); setReason('') }}>取り消す…</button>}
            </li>
          ))}
        </ul>
      )}
      <h3>後から登録する（スマホを忘れた・電池切れなど）</h3>
      <div className="jb-fix-form">
        <label className="fl">種類
          <select className="input" value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value as JyobanTimedType })}>
            {(['onduty', 'offduty', 'departure', 'wakeup'] as JyobanTimedType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="fl">スタッフNo<input className="input" inputMode="numeric" value={add.staffNo} onChange={(e) => setAdd({ ...add, staffNo: e.target.value })} /></label>
        <label className="fl">時刻<input className="input" type="time" value={add.time} onChange={(e) => setAdd({ ...add, time: e.target.value })} /></label>
        <label className="fl jb-fix-reason">理由<input className="input" placeholder="例: スマホを自宅に忘れた（電話で上番を確認）" value={add.reason} onChange={(e) => setAdd({ ...add, reason: e.target.value })} /></label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void run(() => addBoardReport(realm, { slotId: r.b.slot.id, date, ...add }), '後から登録しました') }}>登録する</button>
      </div>
      {err && <p className="jy-errors" role="alert">{err}</p>}
      {r.crew.voided.length > 0 && (
        <>
          <h3>取り消した報告</h3>
          <ul className="jb-fix-list">
            {r.crew.voided.map((x) => <li key={x.id}><span>{x.receivedAt.slice(11, 16)} {x.type === 'other' ? 'その他' : TYPE_LABEL[x.type as JyobanTimedType]} {x.staffName}（No.{x.staffNo}）｜{x.voidedBy ?? ''}：{x.voidReason ?? ''}</span></li>)}
          </ul>
        </>
      )}
    </div>
  )
}
