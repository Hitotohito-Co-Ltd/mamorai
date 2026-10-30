// [JYB] 隊員側の報告ロジック（純粋・決定論）
//   - 押した時刻がどの勤務日の勤務枠に当たるか（夜勤の日付またぎ・前夜の報告）
//   - 報告ボタンの状態（要の報告だけ表示・送信済み時刻・次に押すべきボタン）
//   - その他報告（遅刻・寝坊など）の入力検証
// DB側（0407 の jyoban_work_date）と同じ規則。片方を変えたらもう片方も合わせること。
import { toEpochDay } from '../shift/constraints.js'
import {
  isSlotScheduledOn, isValidHm, JYOBAN_OTHER_KINDS,
  type JyobanSlot, type JyobanReport, type JyobanReportType, type JyobanOtherKind,
} from './model.js'

const DAY = 24 * 60
/** 勤務開始の何分前から報告を受け付けるか（出発連絡は開始の数時間前もありうる） */
export const REPORT_WINDOW_BEFORE_MIN = 12 * 60
/** 勤務終了の何分後まで当該勤務日の報告として扱うか */
export const REPORT_WINDOW_AFTER_MIN = 2 * 60

const hm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

function addDays(date: string, n: number): string {
  const d = new Date((toEpochDay(date) + n) * 86400000)
  return d.toISOString().slice(0, 10)
}

/**
 * ローカル日時 'YYYY-MM-DDTHH:MM' に押した報告が、どの勤務日の勤務枠に当たるか。
 * 勤務日 d の受付時間 = [d の開始 − 12時間, d の終了 + 2時間]（終了が開始以前なら翌日終了）。
 * 複数当たる場合は勤務中のものを、無ければ開始が近いものを選ぶ。どれにも当たらなければ null。
 */
export function resolveWorkDate(slot: JyobanSlot, nowLocal: string): string | null {
  const today = nowLocal.slice(0, 10)
  const now = hm(nowLocal.slice(11, 16))
  const start = hm(slot.workStart)
  const endRaw = hm(slot.workEnd)
  const end = endRaw <= start ? endRaw + DAY : endRaw
  let best: { date: string; inShift: boolean; dist: number } | undefined
  for (const offset of [-1, 0, 1]) {
    const date = addDays(today, offset)
    // 勤務日 date の0時を基準にした now の分
    const t = now - offset * DAY
    if (t < start - REPORT_WINDOW_BEFORE_MIN || t > end + REPORT_WINDOW_AFTER_MIN) continue
    if (!isSlotScheduledOn(slot, date)) continue
    const cand = { date, inShift: t >= start && t <= end, dist: Math.abs(t - start) }
    if (best === undefined || (cand.inShift && !best.inShift) || (cand.inShift === best.inShift && cand.dist < best.dist)) best = cand
  }
  return best?.date ?? null
}

export interface ReportButton {
  type: Exclude<JyobanReportType, 'other'>
  label: string
  /** 締切 'HH:MM' */
  due: string
  done: boolean
  /** 送信時刻 'HH:MM' */
  doneAt?: string
  /** 上番済みのため不要になった出発連絡 */
  skipped: boolean
  /** 次に押すべきボタン（大きく表示） */
  primary: boolean
}

/** 勤務枠×勤務日の報告ボタン。reports は本人分（共用端末は当該勤務者分）。 */
export function reportButtons(slot: JyobanSlot, workDate: string, reports: JyobanReport[]): ReportButton[] {
  const mine = reports.filter((r) => r.slotId === slot.id && r.workDate === workDate && r.voided !== true)
  const first = (t: JyobanReportType): JyobanReport | undefined =>
    mine.filter((r) => r.type === t).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]
  const onduty = first('onduty')
  const out: ReportButton[] = []
  if (slot.departureRequired && slot.departureDue !== null) {
    const d = first('departure')
    out.push({ type: 'departure', label: '出発連絡', due: slot.departureDue, done: d !== undefined, doneAt: d?.receivedAt.slice(11, 16), skipped: d === undefined && onduty !== undefined, primary: false })
  }
  if (slot.ondutyRequired && slot.ondutyDue !== null) {
    out.push({ type: 'onduty', label: '上番連絡', due: slot.ondutyDue, done: onduty !== undefined, doneAt: onduty?.receivedAt.slice(11, 16), skipped: false, primary: false })
  }
  const next = out.find((b) => !b.done && !b.skipped)
  if (next !== undefined) next.primary = true
  return out
}

export interface OtherReportInput {
  kind?: JyobanOtherKind
  eta?: string
  note?: string
}

/** その他報告の入力検証。エラーメッセージの配列（空なら送信可）。 */
export function validateOtherReport(input: OtherReportInput): string[] {
  const def = JYOBAN_OTHER_KINDS.find((k) => k.kind === input.kind)
  if (def === undefined) return ['内容を選んでください']
  const errors: string[] = []
  if (def.needsEta && !isValidHm(input.eta)) errors.push('到着見込み時刻を入力してください')
  const note = (input.note ?? '').trim()
  if (def.kind === 'other' && note === '') errors.push('内容をメモに入力してください')
  if (note.length > 500) errors.push('メモは500文字以内で入力してください')
  return errors
}
