// [JYB] 起床・下番の報告と、未報告時のコール計画（planCalls）
// テスト規約: AAA / 「対象_条件_期待」
import { describe, it, expect } from 'vitest'
import {
  planCalls, reportButtons, computeSlotStatus, validateJyobanSlot, offdutyDueMinutes, minutesLabel,
  type JyobanSlot, type JyobanReport, type PlanCallsInput, type CallSettings,
} from '../index.js'

const ALL = [0, 1, 2, 3, 4, 5, 6]
// 早番 8:15〜15:00 / 起床 5:30・出発 6:30・上番 8:15・下番 15:00 / 猶予5分
const slot: JyobanSlot = {
  id: 's1', siteId: 'site', name: '早番', workStart: '08:15', workEnd: '15:00',
  wakeupRequired: true, wakeupDue: '05:30',
  departureRequired: true, departureDue: '06:30', ondutyRequired: true, ondutyDue: '08:15',
  offdutyRequired: true, offdutyDue: '15:00',
  graceMin: 5, weekdays: ALL, isActive: true,
}
const settings: CallSettings = { emailTo: ['kanri@example.com'], push: true, sms: true, voice: true, remindAfterMin: 0, voiceAfterMin: 5, escalateAfterMin: 10 }
const kasai = { staffId: 'k', staffNo: '10234', name: '笠井', phone: '09012345678', hasPush: true }
const base = (over: Partial<PlanCallsInput>): PlanCallsInput => ({
  slot, siteName: 'コーチャンフォー若葉台店', workDate: '2026-11-07', nowMinutes: 0,
  reports: [], assignees: [kasai], settings, acknowledged: false, sent: [], ...over,
})
const at = (h: number, m: number): number => h * 60 + m
const rep = (type: JyobanReport['type'], time: string): JyobanReport => ({
  slotId: 's1', workDate: '2026-11-07', type, staffNo: '10234', staffName: '笠井', receivedAt: `2026-11-07T${time}`,
  ...(type === 'other' ? { otherKind: 'oversleep' as const, eta: '08:40' } : {}),
})

describe('[JYB] 起床・下番の設定と表示', () => {
  it('validate_起床が要で期限なし_エラー', () => {
    expect(validateJyobanSlot({ ...slot, wakeupDue: null }).map((e) => e.field)).toContain('wakeupDue')
  })
  it('validate_起床の期限が出発より後_エラー', () => {
    expect(validateJyobanSlot({ ...slot, wakeupDue: '07:00' }).map((e) => e.field)).toContain('wakeupDue')
  })
  it('validate_起床・下番が未設定の旧データ_エラーなし', () => {
    const { wakeupRequired: _a, wakeupDue: _b, offdutyRequired: _c, offdutyDue: _d, ...old } = slot
    expect(validateJyobanSlot(old)).toEqual([])
  })
  it('offdutyDue_夜勤明けの下番は翌日扱い', () => {
    expect(offdutyDueMinutes('06:00', '21:00')).toBe(at(30, 0))
    expect(offdutyDueMinutes('15:00', '08:15')).toBe(at(15, 0))
  })
  it('minutesLabel_翌日は「翌」を付ける', () => {
    expect(minutesLabel(at(30, 5))).toBe('翌6:05')
    expect(minutesLabel(at(8, 15))).toBe('8:15')
  })
  it('reportButtons_起床→出発→上番→下番の順で、最初の未報告が大きいボタン', () => {
    const b = reportButtons(slot, '2026-11-07', [])
    expect(b.map((x) => x.type)).toEqual(['wakeup', 'departure', 'onduty', 'offduty'])
    expect(b.find((x) => x.primary)?.type).toBe('wakeup')
  })
  it('reportButtons_上番済みなら起床・出発は省略・下番が次', () => {
    const b = reportButtons(slot, '2026-11-07', [rep('onduty', '08:10')])
    expect(b.filter((x) => x.skipped).map((x) => x.type)).toEqual(['wakeup', 'departure'])
    expect(b.find((x) => x.primary)?.type).toBe('offduty')
  })
  it('computeSlotStatus_起床が期限＋猶予を過ぎて未着_未連絡', () => {
    const r = computeSlotStatus({ slot, workDate: '2026-11-07', nowMinutes: at(5, 36), reports: [] })
    expect(r.status).toBe('missing')
    expect(r.wakeup.state).toBe('missing')
  })
  it('computeSlotStatus_出発済みなら起床の未着は省略', () => {
    const r = computeSlotStatus({ slot, workDate: '2026-11-07', nowMinutes: at(7, 0), reports: [rep('departure', '06:20')] })
    expect(r.wakeup.state).toBe('skipped')
    expect(r.status).toBe('departed')
  })
  it('computeSlotStatus_下番が期限＋猶予を過ぎて未着_未連絡', () => {
    const r = computeSlotStatus({ slot, workDate: '2026-11-07', nowMinutes: at(15, 10), reports: [rep('onduty', '08:10')] })
    expect(r.offduty.state).toBe('missing')
    expect(r.status).toBe('missing')
  })
})

describe('[JYB] planCalls（未報告時のコール計画）', () => {
  it('期限＋猶予の前_何も送らない', () => {
    expect(planCalls(base({ nowMinutes: at(5, 34) }))).toEqual([])
  })
  it('期限＋猶予ちょうど_本人へアプリ通知とSMS（起床）', () => {
    const a = planCalls(base({ nowMinutes: at(5, 35) }))
    expect(a.map((x) => `${x.reportType}/${x.step}/${x.channel}`)).toEqual(['wakeup/remind/push', 'wakeup/remind/sms'])
    expect(a[1]!.to).toEqual(['09012345678'])
    expect(a[1]!.body).toContain('起床連絡（期限5:30）')
  })
  it('5分後_音声電話が加わる', () => {
    const a = planCalls(base({ nowMinutes: at(5, 40) }))
    expect(a.map((x) => x.channel)).toEqual(['push', 'sms', 'voice'])
  })
  it('10分後_管制へメール（担当者名つき）', () => {
    const a = planCalls(base({ nowMinutes: at(5, 45) }))
    const mail = a.find((x) => x.channel === 'email')!
    expect(mail.to).toEqual(['kanri@example.com'])
    expect(mail.title).toBe('【未報告】コーチャンフォー若葉台店（早番） 起床連絡（期限5:30）')
    expect(mail.body).toContain('笠井（No.10234）')
  })
  it('送信済みの知らせ_二度送らない', () => {
    const a = planCalls(base({ nowMinutes: at(5, 40), sent: [
      { staffId: 'k', reportType: 'wakeup', step: 'remind', channel: 'push' },
      { staffId: 'k', reportType: 'wakeup', step: 'remind', channel: 'sms' },
    ] }))
    expect(a.map((x) => x.channel)).toEqual(['voice'])
  })
  it('起床を報告済み_起床の知らせは送らない', () => {
    expect(planCalls(base({ nowMinutes: at(5, 45), reports: [{ staffId: 'k', type: 'wakeup' }] }))).toEqual([])
  })
  it('出発を報告済み_起床の知らせも送らない（後の報告で満たす）', () => {
    expect(planCalls(base({ nowMinutes: at(6, 50), reports: [{ staffId: 'k', type: 'departure' }] }))).toEqual([])
  })
  it('寝坊を「その他」で連絡済み_本人への督促も管制メールも送らない', () => {
    expect(planCalls(base({ nowMinutes: at(5, 50), reports: [{ staffId: 'k', type: 'other' }] }))).toEqual([])
  })
  it('本社が確認済み_何も送らない', () => {
    expect(planCalls(base({ nowMinutes: at(5, 50), acknowledged: true }))).toEqual([])
  })
  it('他の人の報告では本人の未報告は消えない', () => {
    const a = planCalls(base({ nowMinutes: at(5, 35), reports: [{ staffId: 'other', type: 'wakeup' }] }))
    expect(a.length).toBe(2)
  })
  it('電話番号なし_SMS・電話は送らず、アプリ通知と管制メールだけ', () => {
    const a = planCalls(base({ nowMinutes: at(5, 45), assignees: [{ ...kasai, phone: null }] }))
    expect(a.map((x) => x.channel)).toEqual(['push', 'email'])
  })
  it('SMS・電話を使わない設定_アプリ通知と管制メールだけ', () => {
    const a = planCalls(base({ nowMinutes: at(5, 45), settings: { ...settings, sms: false, voice: false } }))
    expect(a.map((x) => x.channel)).toEqual(['push', 'email'])
  })
  it('期限から60分を超えた本人督促_送らない（管制メールは180分まで）', () => {
    const a = planCalls(base({ nowMinutes: at(5, 35) + 61 }))
    expect(a.filter((x) => x.reportType === 'wakeup').map((x) => x.channel)).toEqual(['email'])
    expect(planCalls(base({ nowMinutes: at(5, 35) + 181 })).filter((x) => x.reportType === 'wakeup')).toEqual([])
  })
  it('担当者未設定_誰も報告していなければ管制メールだけ', () => {
    const a = planCalls(base({ nowMinutes: at(5, 45), assignees: [] }))
    expect(a.map((x) => `${x.step}/${x.channel}/${String(x.staffId)}`)).toEqual(['escalate/email/null'])
    expect(planCalls(base({ nowMinutes: at(5, 45), assignees: [], reports: [{ staffId: 'x', type: 'onduty' }] }))).toEqual([])
  })
  it('下番_上番済みでも下番がなければ知らせる・「その他」があっても止めない', () => {
    const a = planCalls(base({ nowMinutes: at(15, 5), reports: [{ staffId: 'k', type: 'onduty' }, { staffId: 'k', type: 'other' }] }))
    expect(a.map((x) => `${x.reportType}/${x.channel}`)).toEqual(['offduty/push', 'offduty/sms'])
  })
  it('夜勤明けの下番（翌6:00）_翌朝に知らせる', () => {
    const night: JyobanSlot = { ...slot, workStart: '21:00', workEnd: '06:00', wakeupRequired: false, wakeupDue: null,
      departureRequired: false, departureDue: null, ondutyDue: '20:45', offdutyDue: '06:00' }
    const a = planCalls(base({ slot: night, nowMinutes: at(30, 5), reports: [{ staffId: 'k', type: 'onduty' }] }))
    expect(a.map((x) => `${x.reportType}/${x.channel}`)).toEqual(['offduty/push', 'offduty/sms'])
    expect(a[0]!.body).toContain('期限翌6:00')
  })
  it('停止中の勤務枠_何も送らない', () => {
    expect(planCalls(base({ nowMinutes: at(5, 45), slot: { ...slot, isActive: false } }))).toEqual([])
  })
})
