// 本日の現場一覧（複数人）: 約定人数・勤務表外・取消・後から登録
import { describe, it, expect } from 'vitest'
import { computeCrewStatus, requiredCount, validateJyobanSlot, type JyobanSlot, type BoardReport } from '../index.js'

// 2026-11-20 は金曜（5）
const D = '2026-11-20'
const slot: JyobanSlot = {
  id: 's1', siteId: 'site', name: '日勤', workStart: '08:00', workEnd: '17:00',
  departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '07:45',
  offdutyRequired: true, offdutyDue: '17:15', graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
  requiredByDow: [1, 2, 2, 2, 2, 3, 0],
}
const min = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))
let n = 0
const rep = (staffNo: string, type: BoardReport['type'], hm: string, extra: Partial<BoardReport> = {}): BoardReport => ({
  id: `r${++n}`, slotId: 's1', workDate: D, type, staffNo, staffName: `架空 ${staffNo}`, receivedAt: `${D}T${hm}`, ...extra,
})
const roster = [{ staffNo: '90001', name: '架空 90001' }, { staffNo: '90002', name: '架空 90002' }]

describe('約定人数', () => {
  it('曜日別の設定 → 配置者の人数 → 1名', () => {
    expect(requiredCount(slot, D, 2)).toBe(3)
    expect(requiredCount({ ...slot, requiredByDow: null }, D, 2)).toBe(2)
    expect(requiredCount({ ...slot, requiredByDow: null }, D, 0)).toBe(1)
  })
  it('入力チェック（7つ・0〜99の整数）', () => {
    expect(validateJyobanSlot({ ...slot, requiredByDow: [1, 2] }).map((e) => e.field)).toContain('requiredByDow')
    expect(validateJyobanSlot({ ...slot, requiredByDow: [1, 2, 2, 2, 2, 3, 100] }).map((e) => e.field)).toContain('requiredByDow')
    expect(validateJyobanSlot(slot)).toEqual([])
  })
})

describe('本日の現場一覧の判定', () => {
  it('締切前は不足していても「締切前」、締切＋猶予を過ぎて不足なら「未連絡」', () => {
    const reports = [rep('90001', 'onduty', '07:40'), rep('90002', 'onduty', '07:41')]
    const before = computeCrewStatus({ slot, workDate: D, nowMinutes: min('07:49'), reports, roster })
    expect(before).toMatchObject({ status: 'pending', required: 3, ondutyCount: 2, shortage: 1 })
    const after = computeCrewStatus({ slot, workDate: D, nowMinutes: min('07:51'), reports, roster })
    expect(after).toMatchObject({ status: 'missing', shortage: 1, ondutyOverdue: true })
    expect(computeCrewStatus({ slot, workDate: D, nowMinutes: min('07:51'), reports, roster, acknowledged: true }).status).toBe('acknowledged')
  })

  it('約定人数がそろえば上番済み。勤務表にいない人は「勤務表外」として数える（R5）', () => {
    const reports = [rep('90001', 'onduty', '07:40'), rep('90002', 'onduty', '07:41'), rep('90009', 'onduty', '07:42')]
    const r = computeCrewStatus({ slot, workDate: D, nowMinutes: min('08:30'), reports, roster })
    expect(r).toMatchObject({ status: 'on_duty', ondutyCount: 3, shortage: 0, offRosterCount: 1 })
    expect(r.people.find((p) => p.staffNo === '90009')?.onRoster).toBe(false)
  })

  it('配置者を登録しない勤務枠（シフト記入なし・R6）は人数だけで判定し、勤務表外の印は付けない', () => {
    const s2 = { ...slot, requiredByDow: [2, 2, 2, 2, 2, 2, 2] }
    const reports = [rep('90001', 'onduty', '07:40'), rep('90005', 'onduty', '07:44')]
    const r = computeCrewStatus({ slot: s2, workDate: D, nowMinutes: min('09:00'), reports, roster: [] })
    expect(r).toMatchObject({ status: 'on_duty', required: 2, offRosterCount: 0 })
    expect(r.people.every((p) => p.onRoster === null)).toBe(true)
  })

  it('取消された報告は数えず、取消欄に出す。後から登録は数え、訂正の印を付ける', () => {
    const s2 = { ...slot, requiredByDow: [1, 1, 1, 1, 1, 1, 1] }
    const reports = [
      rep('90001', 'onduty', '07:40', { voided: true, voidReason: '別の人が押した', voidedBy: '現場PC（A）' }),
      rep('90002', 'onduty', '07:43', { enteredBy: '現場PC（A）', entryReason: 'スマホを忘れた' }),
    ]
    const r = computeCrewStatus({ slot: s2, workDate: D, nowMinutes: min('09:00'), reports, roster })
    expect(r.ondutyCount).toBe(1)
    expect(r.voided).toHaveLength(1)
    expect(r.people.find((p) => p.staffNo === '90002')?.corrected).toBe(true)
    expect(r.people.find((p) => p.staffNo === '90001')).toMatchObject({ onduty: { at: null }, missingOnduty: true })
  })

  it('上番した人の下番が締切＋猶予を過ぎても来なければ「未連絡」', () => {
    const s2 = { ...slot, requiredByDow: [1, 1, 1, 1, 1, 1, 1] }
    const reports = [rep('90001', 'onduty', '07:40')]
    expect(computeCrewStatus({ slot: s2, workDate: D, nowMinutes: min('17:19'), reports, roster: [] }).status).toBe('on_duty')
    const r = computeCrewStatus({ slot: s2, workDate: D, nowMinutes: min('17:21'), reports, roster: [] })
    expect(r.status).toBe('missing')
    expect(r.people[0]?.missingOffduty).toBe(true)
  })

  it('約定0名の曜日は稼働なし', () => {
    expect(computeCrewStatus({ slot, workDate: '2026-11-21', nowMinutes: min('09:00'), reports: [], roster }).status).toBe('not_scheduled')
  })
})
