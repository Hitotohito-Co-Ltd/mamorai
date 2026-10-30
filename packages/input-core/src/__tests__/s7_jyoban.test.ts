// [JYB] 上番報告（出発連絡・上番連絡）の純粋ロジック
//   勤務枠の設定検証 / 稼働日判定 / 締切の分換算 / ステータス判定 / 並び順・件数集計 / 報告URL
import { describe, it, expect } from 'vitest'
import {
  validateJyobanSlot, isSlotScheduledOn, dueMinutes, localMinutesFrom,
  computeSlotStatus, sortSlotRows, summarizeSlotStatuses, buildReportUrl,
  JYOBAN_STATUS_ORDER,
  type JyobanSlot, type JyobanReport,
} from '../index.js'

// ららぽーと立川立飛 日勤1（上番のみ・締切7:45）
const lalaport1: JyobanSlot = {
  id: 'slot-l1', siteId: 'site-lala', name: '日勤1（荷捌）', workStart: '08:00', workEnd: '17:00',
  departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '07:45',
  graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
}
// コーチャンフォー若葉台店 早番（出発6:30＋上番8:15）
const coachan: JyobanSlot = {
  id: 'slot-c1', siteId: 'site-coa', name: '早番', workStart: '08:15', workEnd: '15:00',
  departureRequired: true, departureDue: '06:30', ondutyRequired: true, ondutyDue: '08:15',
  graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
}
const D = '2026-10-30' // 金曜

function rep(p: Partial<JyobanReport> & Pick<JyobanReport, 'type' | 'receivedAt'>): JyobanReport {
  return { slotId: coachan.id, workDate: D, staffNo: '10234', staffName: '笠井', ...p }
}

describe('[JYB] validateJyobanSlot', () => {
  it('正しい勤務枠はエラーなし', () => {
    expect(validateJyobanSlot(lalaport1)).toEqual([])
    expect(validateJyobanSlot(coachan)).toEqual([])
  })
  it('勤務枠名が空ならエラー', () => {
    const e = validateJyobanSlot({ ...coachan, name: '  ' })
    expect(e.map((x) => x.field)).toContain('name')
  })
  it('時刻はHH:MM形式・00:00〜23:59のみ', () => {
    const e = validateJyobanSlot({ ...coachan, workStart: '8:15', ondutyDue: '24:10' })
    expect(e.map((x) => x.field)).toEqual(expect.arrayContaining(['workStart', 'ondutyDue']))
  })
  it('要にした報告には締切時刻が必須', () => {
    const e = validateJyobanSlot({ ...coachan, departureDue: null })
    expect(e.map((x) => x.field)).toContain('departureDue')
  })
  it('出発連絡・上番連絡の両方を不要にはできない', () => {
    const e = validateJyobanSlot({ ...lalaport1, ondutyRequired: false, ondutyDue: null })
    expect(e.map((x) => x.field)).toContain('ondutyRequired')
  })
  it('両方要のとき出発締切は上番締切より前', () => {
    const e = validateJyobanSlot({ ...coachan, departureDue: '08:30' })
    expect(e.map((x) => x.field)).toContain('departureDue')
  })
  it('猶予は0〜120分の整数', () => {
    expect(validateJyobanSlot({ ...coachan, graceMin: -1 }).map((x) => x.field)).toContain('graceMin')
    expect(validateJyobanSlot({ ...coachan, graceMin: 121 }).map((x) => x.field)).toContain('graceMin')
    expect(validateJyobanSlot({ ...coachan, graceMin: 2.5 }).map((x) => x.field)).toContain('graceMin')
  })
  it('適用曜日は1つ以上・0〜6', () => {
    expect(validateJyobanSlot({ ...coachan, weekdays: [] }).map((x) => x.field)).toContain('weekdays')
    expect(validateJyobanSlot({ ...coachan, weekdays: [7] }).map((x) => x.field)).toContain('weekdays')
  })
})

describe('[JYB] isSlotScheduledOn', () => {
  it('適用曜日に含まれ稼働中なら true', () => {
    expect(isSlotScheduledOn(coachan, D)).toBe(true)
  })
  it('平日のみの枠は土曜 false・金曜 true', () => {
    const weekday = { ...coachan, weekdays: [1, 2, 3, 4, 5] }
    expect(isSlotScheduledOn(weekday, '2026-10-31')).toBe(false)
    expect(isSlotScheduledOn(weekday, D)).toBe(true)
  })
  it('休止中の枠は false', () => {
    expect(isSlotScheduledOn({ ...coachan, isActive: false }, D)).toBe(false)
  })
})

describe('[JYB] dueMinutes / localMinutesFrom', () => {
  it('締切は勤務日0時からの分', () => {
    expect(dueMinutes('07:45', '08:00')).toBe(465)
  })
  it('勤務開始の12時間超あとの締切は前日扱い（0:30開始・締切23:45）', () => {
    expect(dueMinutes('23:45', '00:30')).toBe(-15)
  })
  it('夜勤の締切（21:00開始・締切20:45）は当日', () => {
    expect(dueMinutes('20:45', '21:00')).toBe(1245)
  })
  it('報告時刻（YYYY-MM-DDTHH:MM）を勤務日0時からの分へ。前日・翌日にも対応', () => {
    expect(localMinutesFrom(D, '2026-10-30T07:52')).toBe(472)
    expect(localMinutesFrom(D, '2026-10-29T23:50')).toBe(-10)
    expect(localMinutesFrom(D, '2026-10-31T00:10')).toBe(1450)
  })
})

describe('[JYB] computeSlotStatus', () => {
  const at = (hm: string): number => localMinutesFrom(D, `${D}T${hm}`)

  it('締切前で未報告なら pending', () => {
    const r = computeSlotStatus({ slot: lalaport1, workDate: D, nowMinutes: at('07:30'), reports: [] })
    expect(r.status).toBe('pending')
    expect(r.onduty.state).toBe('pending')
  })
  it('締切ちょうど＋猶予以内はまだ pending（7:50まで）', () => {
    const r = computeSlotStatus({ slot: lalaport1, workDate: D, nowMinutes: at('07:50'), reports: [] })
    expect(r.status).toBe('pending')
  })
  it('締切＋猶予を過ぎて未報告なら missing（7:51）', () => {
    const r = computeSlotStatus({ slot: lalaport1, workDate: D, nowMinutes: at('07:51'), reports: [] })
    expect(r.status).toBe('missing')
    expect(r.onduty.state).toBe('missing')
  })
  it('出発済み・上番は締切前なら departed', () => {
    const r = computeSlotStatus({
      slot: coachan, workDate: D, nowMinutes: at('07:52'),
      reports: [rep({ type: 'departure', receivedAt: `${D}T06:24` })],
    })
    expect(r.status).toBe('departed')
    expect(r.departure).toEqual({ state: 'done', atMinutes: at('06:24'), lateMin: 0 })
  })
  it('出発連絡が締切＋猶予を過ぎても未着なら missing', () => {
    const r = computeSlotStatus({ slot: coachan, workDate: D, nowMinutes: at('06:40'), reports: [] })
    expect(r.status).toBe('missing')
    expect(r.departure.state).toBe('missing')
  })
  it('上番済みなら on_duty。出発連絡が無くても赤にせず skipped', () => {
    const r = computeSlotStatus({
      slot: coachan, workDate: D, nowMinutes: at('09:00'),
      reports: [rep({ type: 'onduty', receivedAt: `${D}T08:05` })],
    })
    expect(r.status).toBe('on_duty')
    expect(r.departure.state).toBe('skipped')
  })
  it('締切後に届いた上番連絡は on_duty で遅延分を記録', () => {
    const r = computeSlotStatus({
      slot: lalaport1, workDate: D, nowMinutes: at('08:10'),
      reports: [rep({ slotId: lalaport1.id, type: 'onduty', receivedAt: `${D}T08:01` })],
    })
    expect(r.status).toBe('on_duty')
    expect(r.onduty).toEqual({ state: 'done', atMinutes: at('08:01'), lateMin: 16 })
  })
  it('その他報告があり未確認なら other_reported（未連絡より後、出発済みより前）', () => {
    const r = computeSlotStatus({
      slot: coachan, workDate: D, nowMinutes: at('07:00'),
      reports: [
        rep({ type: 'departure', receivedAt: `${D}T06:20` }),
        rep({ type: 'other', otherKind: 'traffic_delay', eta: '08:30', receivedAt: `${D}T06:50` }),
      ],
    })
    expect(r.status).toBe('other_reported')
    expect(r.other?.otherKind).toBe('traffic_delay')
  })
  it('未連絡でも本社が確認済みにしたら acknowledged', () => {
    const r = computeSlotStatus({ slot: lalaport1, workDate: D, nowMinutes: at('07:52'), reports: [], acknowledged: true })
    expect(r.status).toBe('acknowledged')
  })
  it('取消された報告は無視する', () => {
    const r = computeSlotStatus({
      slot: lalaport1, workDate: D, nowMinutes: at('07:52'),
      reports: [rep({ slotId: lalaport1.id, type: 'onduty', receivedAt: `${D}T07:40`, voided: true })],
    })
    expect(r.status).toBe('missing')
  })
  it('同じ種別が複数あれば最初の報告を採用', () => {
    const r = computeSlotStatus({
      slot: lalaport1, workDate: D, nowMinutes: at('08:00'),
      reports: [
        rep({ slotId: lalaport1.id, type: 'onduty', receivedAt: `${D}T07:44` }),
        rep({ slotId: lalaport1.id, type: 'onduty', receivedAt: `${D}T07:30` }),
      ],
    })
    expect(r.onduty.atMinutes).toBe(at('07:30'))
  })
  it('他の勤務枠・他の日の報告は数えない', () => {
    const r = computeSlotStatus({
      slot: lalaport1, workDate: D, nowMinutes: at('07:52'),
      reports: [
        rep({ slotId: 'other-slot', type: 'onduty', receivedAt: `${D}T07:30` }),
        rep({ slotId: lalaport1.id, workDate: '2026-10-29', type: 'onduty', receivedAt: '2026-10-29T07:30' }),
      ],
    })
    expect(r.status).toBe('missing')
  })
  it('勤務表の配置者と報告者のスタッフNoが違えば substitute=true', () => {
    const r = computeSlotStatus({
      slot: coachan, workDate: D, nowMinutes: at('08:20'), scheduledStaffNo: '10234',
      reports: [rep({ type: 'onduty', staffNo: '20001', staffName: '［交代］', receivedAt: `${D}T08:00` })],
    })
    expect(r.substitute).toBe(true)
    expect(r.reporterStaffNo).toBe('20001')
  })
  it('配置者本人の報告なら substitute=false', () => {
    const r = computeSlotStatus({
      slot: coachan, workDate: D, nowMinutes: at('08:20'), scheduledStaffNo: '10234',
      reports: [rep({ type: 'onduty', receivedAt: `${D}T08:00` })],
    })
    expect(r.substitute).toBe(false)
  })
  it('稼働日でない枠は not_scheduled', () => {
    const r = computeSlotStatus({ slot: { ...lalaport1, weekdays: [1] }, workDate: D, nowMinutes: at('09:00'), reports: [] })
    expect(r.status).toBe('not_scheduled')
  })
})

describe('[JYB] sortSlotRows / summarizeSlotStatuses', () => {
  it('並び順は 未連絡→その他→出発済み→締切前→上番済み→確認済み', () => {
    expect(JYOBAN_STATUS_ORDER).toEqual(['missing', 'other_reported', 'departed', 'pending', 'on_duty', 'acknowledged'])
    const rows = [
      { id: 'a', status: 'on_duty' as const }, { id: 'b', status: 'missing' as const },
      { id: 'c', status: 'pending' as const }, { id: 'd', status: 'other_reported' as const },
    ]
    expect(sortSlotRows(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a'])
  })
  it('同じステータス内は元の順を保つ（安定ソート）', () => {
    const rows = [{ id: 'x', status: 'pending' as const }, { id: 'y', status: 'pending' as const }]
    expect(sortSlotRows(rows).map((r) => r.id)).toEqual(['x', 'y'])
  })
  it('ステータス別件数（not_scheduled は数えない）', () => {
    const s = summarizeSlotStatuses([
      { status: 'missing' }, { status: 'missing' }, { status: 'on_duty' }, { status: 'not_scheduled' },
    ])
    expect(s).toEqual({ missing: 2, other_reported: 0, departed: 0, pending: 0, on_duty: 1, acknowledged: 0 })
  })
})

describe('[JYB] buildReportUrl', () => {
  it('QR用URL = 基点 + /app/r/<トークン>（末尾スラッシュ揺れを吸収）', () => {
    expect(buildReportUrl('https://mamorai.tryangrow.com', 'AbC123_x-9')).toBe('https://mamorai.tryangrow.com/app/r/AbC123_x-9')
    expect(buildReportUrl('https://mamorai.tryangrow.com/', 'AbC123_x-9')).toBe('https://mamorai.tryangrow.com/app/r/AbC123_x-9')
  })
  it('トークンに使えない文字があれば例外（URLインジェクション防止）', () => {
    expect(() => buildReportUrl('https://x.example', 'a/b')).toThrow()
    expect(() => buildReportUrl('https://x.example', '')).toThrow()
  })
})
