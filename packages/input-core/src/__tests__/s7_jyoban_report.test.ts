// [JYB] 隊員側の報告ロジック: 勤務日の判定 / 報告ボタンの状態 / その他報告の入力検証
import { describe, it, expect } from 'vitest'
import {
  resolveWorkDate, reportButtons, validateOtherReport,
  type JyobanSlot, type JyobanReport,
} from '../index.js'

const day: JyobanSlot = {
  id: 'd', siteId: 's', name: '早番', workStart: '08:15', workEnd: '15:00',
  departureRequired: true, departureDue: '06:30', ondutyRequired: true, ondutyDue: '08:15',
  graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
}
const night: JyobanSlot = { ...day, id: 'n', name: '夜勤', workStart: '21:00', workEnd: '06:00', departureRequired: false, departureDue: null, ondutyDue: '20:45' }
const lateNight: JyobanSlot = { ...day, id: 'l', name: '深夜', workStart: '00:30', workEnd: '08:30', departureRequired: false, departureDue: null, ondutyDue: '00:15' }

describe('[JYB] resolveWorkDate', () => {
  it('日勤の出発連絡（早朝）は当日', () => {
    expect(resolveWorkDate(day, '2026-10-30T06:24')).toBe('2026-10-30')
  })
  it('日勤の勤務中も当日', () => {
    expect(resolveWorkDate(day, '2026-10-30T14:00')).toBe('2026-10-30')
  })
  it('夜勤の明け方（翌2:00）は前日の勤務', () => {
    expect(resolveWorkDate(night, '2026-10-31T02:00')).toBe('2026-10-30')
  })
  it('夜勤の上番前（20:40）は当日の勤務', () => {
    expect(resolveWorkDate(night, '2026-10-30T20:40')).toBe('2026-10-30')
  })
  it('0:30開始の枠に前夜23:50に報告すると翌日の勤務', () => {
    expect(resolveWorkDate(lateNight, '2026-10-29T23:50')).toBe('2026-10-30')
  })
  it('月またぎ・年またぎも日付を正しく繰る', () => {
    expect(resolveWorkDate(night, '2027-01-01T03:00')).toBe('2026-12-31')
    expect(resolveWorkDate(lateNight, '2026-10-31T23:50')).toBe('2026-11-01')
  })
  it('勤務の前後どちらにも当たらない時間帯は null', () => {
    // 日勤（8:15〜15:00）: 勤務終了2時間後（17:00）以降〜翌日の開始12時間前（20:15）未満
    expect(resolveWorkDate(day, '2026-10-30T18:00')).toBeNull()
  })
  it('適用曜日でない日に当たれば null', () => {
    expect(resolveWorkDate({ ...day, weekdays: [1, 2, 3, 4, 5] }, '2026-10-31T07:00')).toBeNull() // 土曜
  })
  it('休止中の枠は null', () => {
    expect(resolveWorkDate({ ...day, isActive: false }, '2026-10-30T07:00')).toBeNull()
  })
})

describe('[JYB] reportButtons', () => {
  const r = (p: Partial<JyobanReport> & Pick<JyobanReport, 'type' | 'receivedAt'>): JyobanReport =>
    ({ slotId: 'd', workDate: '2026-10-30', staffNo: '10234', staffName: '笠井', ...p })

  it('要の報告だけボタンを出す（出発不要の枠は上番のみ）', () => {
    expect(reportButtons(night, '2026-10-30', []).map((b) => b.type)).toEqual(['onduty'])
    expect(reportButtons(day, '2026-10-30', []).map((b) => b.type)).toEqual(['departure', 'onduty'])
  })
  it('送信済みは done と時刻（HH:MM）を返し、次に押すべきボタンを primary にする', () => {
    const b = reportButtons(day, '2026-10-30', [r({ type: 'departure', receivedAt: '2026-10-30T06:24' })])
    expect(b[0]).toMatchObject({ type: 'departure', done: true, doneAt: '06:24', primary: false, due: '06:30' })
    expect(b[1]).toMatchObject({ type: 'onduty', done: false, primary: true, due: '08:15' })
  })
  it('取消済みの報告は未送信に戻る', () => {
    const b = reportButtons(day, '2026-10-30', [r({ type: 'departure', receivedAt: '2026-10-30T06:24', voided: true })])
    expect(b[0]).toMatchObject({ done: false, primary: true })
  })
  it('出発連絡が未送信でも上番連絡済みなら全部 done 扱い（primary なし）', () => {
    const b = reportButtons(day, '2026-10-30', [r({ type: 'onduty', receivedAt: '2026-10-30T08:01' })])
    expect(b.map((x) => x.primary)).toEqual([false, false])
    expect(b[0]).toMatchObject({ done: false, skipped: true })
  })
  it('他の勤務日・他の枠の報告は数えない', () => {
    const b = reportButtons(day, '2026-10-30', [
      r({ type: 'departure', workDate: '2026-10-29', receivedAt: '2026-10-29T06:20' }),
      r({ type: 'departure', slotId: 'x', receivedAt: '2026-10-30T06:20' }),
    ])
    expect(b[0]!.done).toBe(false)
  })
})

describe('[JYB] validateOtherReport', () => {
  it('遅刻・寝坊・交通遅延は到着見込み時刻が必須', () => {
    expect(validateOtherReport({ kind: 'late' })).toEqual(['到着見込み時刻を入力してください'])
    expect(validateOtherReport({ kind: 'traffic_delay', eta: '08:30' })).toEqual([])
  })
  it('体調不良・欠勤・その他は到着見込み不要', () => {
    expect(validateOtherReport({ kind: 'sick' })).toEqual([])
    expect(validateOtherReport({ kind: 'absent' })).toEqual([])
  })
  it('「その他」はメモ必須', () => {
    expect(validateOtherReport({ kind: 'other' })).toEqual(['内容をメモに入力してください'])
    expect(validateOtherReport({ kind: 'other', note: '鍵を紛失' })).toEqual([])
  })
  it('時刻形式とメモの長さ（500文字まで）', () => {
    expect(validateOtherReport({ kind: 'late', eta: '8:30' })).toEqual(['到着見込み時刻を入力してください'])
    expect(validateOtherReport({ kind: 'sick', note: 'あ'.repeat(501) })).toEqual(['メモは500文字以内で入力してください'])
  })
  it('区分が無ければエラー', () => {
    expect(validateOtherReport({})).toEqual(['内容を選んでください'])
  })
})
