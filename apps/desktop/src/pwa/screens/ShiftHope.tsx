// [勤務員PWA] シフト希望提出。対象月の各日に希望(勤務可/夜勤希望/休み希望)をタップで登録し提出。
// 提出内容は現場管理コンソールのシフト作成に反映される想定（本結線時はDB）。
import { useMemo, useState } from 'react'
import type { Staff } from '../staff.js'
import { submitHope, type HopeCode } from '../../features/shift/shiftHopeApi.js'

type Hope = '' | '可' | '夜' | '休'
const CYCLE: Hope[] = ['', '可', '夜', '休']
const HOPE_LABEL: Record<Hope, string> = { '': '—', '可': '勤務可', '夜': '夜勤希望', '休': '休み希望' }
const HOPE_CLS: Record<Hope, string> = { '': '', '可': 'h-ok', '夜': 'h-night', '休': 'h-off' }

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y ?? 2026, m ?? 1, 0).getDate()
}
const WD = ['日', '月', '火', '水', '木', '金', '土']
function weekday(ym: string, d: number): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y ?? 2026, (m ?? 1) - 1, d).getDay()
}

export function ShiftHope({ staff, site }: { staff: Staff; site: string }): JSX.Element {
  const [ym, setYm] = useState('2026-09')
  const [hopes, setHopes] = useState<Record<number, Hope>>({})
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const n = useMemo(() => daysInMonth(ym), [ym])

  const tap = (d: number): void => {
    setHopes((p) => {
      const cur = p[d] ?? ''
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]!
      return { ...p, [d]: next }
    })
  }
  const counts = useMemo(() => {
    let ok = 0, night = 0, off = 0
    for (const d of Object.values(hopes)) { if (d === '可') ok++; else if (d === '夜') night++; else if (d === '休') off++ }
    return { ok, night, off }
  }, [hopes])

  const submit = (): void => {
    // 空欄を除いた希望のみを対象月として現場へ提出（共有ストア）。
    const days: Record<number, HopeCode> = {}
    for (const [d, v] of Object.entries(hopes)) { if (v !== '') days[Number(d)] = v as HopeCode }
    void submitHope({ staffNo: staff.no, name: staff.name, site, ym, days, note, submittedAt: ym })
      .then(() => setSubmitted(`${ym} の希望を提出しました（勤務可${counts.ok}・夜勤${counts.night}・休み${counts.off}）。現場のシフト作成に反映されます。`))
      .catch((e: unknown) => setSubmitted(e instanceof Error && e.message !== '' ? `提出できませんでした：${e.message}` : '提出に失敗しました。通信状況をご確認ください。'))
  }

  return (
    <div className="pwa-page">
      <h1 className="pwa-title">シフト希望提出</h1>
      <p className="pwa-lead">{site}／{staff.name} さんの希望を登録します。日付をタップで切替。</p>

      <div className="pwa-row">
        <label className="pwa-field">対象月
          <input className="pwa-input" type="month" value={ym} onChange={(e) => { setYm(e.target.value); setHopes({}); setSubmitted(null) }} />
        </label>
      </div>

      <div className="hope-legend">
        <span className="chip h-ok">勤務可</span>
        <span className="chip h-night">夜勤希望</span>
        <span className="chip h-off">休み希望</span>
        <span className="chip">タップで切替</span>
      </div>

      <div className="hope-grid">
        {Array.from({ length: n }, (_, i) => i + 1).map((d) => {
          const wd = weekday(ym, d)
          const h = hopes[d] ?? ''
          return (
            <button key={d} type="button" className={`hope-cell ${HOPE_CLS[h]}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}`} onClick={() => tap(d)}>
              <span className="hope-d">{d}</span>
              <span className="hope-wd">{WD[wd]}</span>
              <span className="hope-v">{h === '' ? '' : HOPE_LABEL[h]}</span>
            </button>
          )
        })}
      </div>

      <div className="pwa-row">
        <label className="pwa-field">備考（任意）
          <input className="pwa-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="連続勤務の希望・通院日 等" />
        </label>
      </div>

      <div className="pwa-summary">勤務可 {counts.ok}／夜勤 {counts.night}／休み {counts.off}</div>
      <button type="button" className="pwa-btn pwa-btn-primary pwa-btn-block" onClick={submit}>この内容で提出する</button>
      {submitted && <p className="pwa-ok" role="status">{submitted}</p>}
    </div>
  )
}
