// [JYB] 上番報告（起床・出発・上番・下番の連絡）の純粋ロジック（UI/DB非依存・決定論）
//   - 勤務枠（現場×勤務枠ごとの報告要否・締切・猶予）の設定検証
//   - 稼働日判定 / 締切の分換算
//   - ステータス判定（未連絡・その他報告・出発済み・締切前・上番済み・確認済み）
//   - 本社一覧の並び順・件数集計 / QR用の報告URL生成
// 時刻はすべて「勤務日 0:00 からの分（ローカル時刻）」で扱い、タイムゾーン変換は呼び出し側（JST）で行う。
// 現在時刻・乱数などの非決定APIは使わない（now は引数で受け取る）。
import { toEpochDay } from '../shift/constraints.js'

export type JyobanReportType = 'wakeup' | 'departure' | 'onduty' | 'offduty' | 'other'
/** 期限つきの報告（その他以外）。時系列順。 */
export type JyobanTimedType = Exclude<JyobanReportType, 'other'>
export const JYOBAN_TIMED_TYPES: JyobanTimedType[] = ['wakeup', 'departure', 'onduty', 'offduty']
export const JYOBAN_TYPE_LABEL: Record<JyobanTimedType, string> = {
  wakeup: '起床連絡', departure: '出発連絡', onduty: '上番連絡', offduty: '下番連絡',
}
export type JyobanOtherKind = 'late' | 'oversleep' | 'traffic_delay' | 'sick' | 'absent' | 'other'

/** その他報告の区分ラベル（UI表示用）。遅刻系は到着見込み時刻が必須。 */
export const JYOBAN_OTHER_KINDS: { kind: JyobanOtherKind; label: string; needsEta: boolean }[] = [
  { kind: 'late', label: '遅刻', needsEta: true },
  { kind: 'oversleep', label: '寝坊', needsEta: true },
  { kind: 'traffic_delay', label: '交通遅延', needsEta: true },
  { kind: 'sick', label: '体調不良', needsEta: false },
  { kind: 'absent', label: '欠勤', needsEta: false },
  { kind: 'other', label: 'その他', needsEta: false },
]

/** 勤務枠（現場 × 勤務枠）。報告の要否と締切はこの単位で持つ。 */
export interface JyobanSlot {
  id: string
  siteId: string
  /** 勤務枠名（例: 日勤1（荷捌）/ 早番） */
  name: string
  /** 勤務時間 'HH:MM' */
  workStart: string
  workEnd: string
  departureRequired: boolean
  /** 出発連絡の締切 'HH:MM'（不要なら null） */
  departureDue: string | null
  ondutyRequired: boolean
  /** 上番連絡の締切 'HH:MM'（不要なら null） */
  ondutyDue: string | null
  /** 起床連絡（未設定の旧データは不要扱い） */
  wakeupRequired?: boolean
  wakeupDue?: string | null
  /** 下番連絡（未設定の旧データは不要扱い）。期限が勤務開始以前の時刻なら翌日 */
  offdutyRequired?: boolean
  offdutyDue?: string | null
  /** 締切からアラート（未連絡）までの猶予（分） */
  graceMin: number
  /** 適用曜日（0=日〜6=土） */
  weekdays: number[]
  isActive: boolean
}

/** 隊員からの報告。receivedAt はサーバ受信時刻（ローカル 'YYYY-MM-DDTHH:MM'）。 */
export interface JyobanReport {
  slotId: string
  /** 勤務日（=勤務開始日）'YYYY-MM-DD' */
  workDate: string
  type: JyobanReportType
  staffNo: string
  staffName: string
  otherKind?: JyobanOtherKind
  /** 到着見込み時刻 'HH:MM'（遅刻系のその他報告） */
  eta?: string
  note?: string
  receivedAt: string
  voided?: boolean
}

export type SlotStatus =
  | 'missing'         // 未連絡（締切＋猶予を超過）
  | 'other_reported'  // 遅刻等のその他報告あり（本社未確認）
  | 'departed'        // 出発済み・上番は締切前
  | 'pending'         // 締切前
  | 'on_duty'         // 上番済み
  | 'acknowledged'    // 本社が確認済み
  | 'not_scheduled'   // 本日は稼働日ではない

/** 本社一覧の並び順（対応が必要なものほど上）。 */
export const JYOBAN_STATUS_ORDER: Exclude<SlotStatus, 'not_scheduled'>[] = [
  'missing', 'other_reported', 'departed', 'pending', 'on_duty', 'acknowledged',
]

export type ReportState = 'not_required' | 'pending' | 'done' | 'missing' | 'skipped'

export interface ReportCheck {
  state: ReportState
  /** 報告時刻（勤務日0時からの分） */
  atMinutes?: number
  /** 締切からの遅れ（分）。締切内なら 0 */
  lateMin?: number
}

export interface SlotStatusResult {
  status: SlotStatus
  wakeup: ReportCheck
  departure: ReportCheck
  onduty: ReportCheck
  offduty: ReportCheck
  /** 最新の未取消その他報告 */
  other?: JyobanReport
  /** 勤務表の配置者と報告者が異なる（交代・代理） */
  substitute: boolean
  /** 上番（無ければ出発）を報告したスタッフNo */
  reporterStaffNo?: string
}

export interface SlotFieldError {
  field: keyof JyobanSlot
  message: string
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/

/** 'HH:MM' が正しい時刻か。 */
export function isValidHm(hm: string | null | undefined): hm is string {
  return typeof hm === 'string' && HM.test(hm)
}

function hmToMin(hm: string): number {
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
}

/** 勤務枠の設定を検証する。エラーが無ければ空配列。 */
export function validateJyobanSlot(slot: JyobanSlot): SlotFieldError[] {
  const errors: SlotFieldError[] = []
  if (slot.name.trim() === '') errors.push({ field: 'name', message: '勤務枠名を入力してください' })
  if (!isValidHm(slot.workStart)) errors.push({ field: 'workStart', message: '勤務開始はHH:MMで入力してください' })
  if (!isValidHm(slot.workEnd)) errors.push({ field: 'workEnd', message: '勤務終了はHH:MMで入力してください' })

  if (!slot.departureRequired && !slot.ondutyRequired) {
    errors.push({ field: 'ondutyRequired', message: '出発連絡か上番連絡のどちらかは「要」にしてください' })
  }
  if (slot.departureRequired && !isValidHm(slot.departureDue)) {
    errors.push({ field: 'departureDue', message: '出発連絡の締切をHH:MMで入力してください' })
  }
  if (slot.ondutyRequired && !isValidHm(slot.ondutyDue)) {
    errors.push({ field: 'ondutyDue', message: '上番連絡の締切をHH:MMで入力してください' })
  }
  if (slot.departureRequired && slot.ondutyRequired && isValidHm(slot.departureDue) && isValidHm(slot.ondutyDue)
      && isValidHm(slot.workStart)
      && dueMinutes(slot.departureDue, slot.workStart) >= dueMinutes(slot.ondutyDue, slot.workStart)) {
    errors.push({ field: 'departureDue', message: '出発連絡の締切は上番連絡の締切より前にしてください' })
  }
  if (slot.wakeupRequired === true && !isValidHm(slot.wakeupDue)) {
    errors.push({ field: 'wakeupDue', message: '起床連絡の締切をHH:MMで入力してください' })
  }
  if (slot.offdutyRequired === true && !isValidHm(slot.offdutyDue)) {
    errors.push({ field: 'offdutyDue', message: '下番連絡の締切をHH:MMで入力してください' })
  }
  if (slot.wakeupRequired === true && isValidHm(slot.wakeupDue) && isValidHm(slot.workStart)) {
    const w = dueMinutes(slot.wakeupDue, slot.workStart)
    const later = [slot.departureRequired ? slot.departureDue : null, slot.ondutyRequired ? slot.ondutyDue : null]
      .filter(isValidHm).map((d) => dueMinutes(d, slot.workStart))
    if (later.some((m) => w >= m)) errors.push({ field: 'wakeupDue', message: '起床連絡の締切は出発・上番連絡の締切より前にしてください' })
  }
  if (!Number.isInteger(slot.graceMin) || slot.graceMin < 0 || slot.graceMin > 120) {
    errors.push({ field: 'graceMin', message: '猶予は0〜120分の整数で入力してください' })
  }
  if (slot.weekdays.length === 0 || slot.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    errors.push({ field: 'weekdays', message: '適用曜日を1つ以上選んでください' })
  }
  return errors
}

/** 勤務日の曜日（0=日〜6=土）。1970-01-01 は木曜。 */
function weekdayOf(date: string): number {
  return (((toEpochDay(date) + 4) % 7) + 7) % 7
}

/** その日に勤務枠が稼働するか（稼働中かつ適用曜日）。 */
export function isSlotScheduledOn(slot: JyobanSlot, workDate: string): boolean {
  return slot.isActive && slot.weekdays.includes(weekdayOf(workDate))
}

/**
 * 締切 'HH:MM' を「勤務日0時からの分」に換算する。
 * 締切が勤務開始より12時間を超えて後ろにある場合は前日の締切とみなす（例: 0:30開始・締切23:45 → -15分）。
 */
export function dueMinutes(due: string, workStart: string): number {
  const d = hmToMin(due)
  const s = hmToMin(workStart)
  return d - s > 12 * 60 ? d - 24 * 60 : d
}

/**
 * 下番連絡の期限を「勤務日0時からの分」に換算する。勤務開始以前の時刻は翌日とみなす（夜勤明け）。
 */
export function offdutyDueMinutes(due: string, workStart: string): number {
  const d = hmToMin(due)
  return d <= hmToMin(workStart) ? d + 24 * 60 : d
}

/** 報告種別ごとの期限（勤務日0時からの分）。不要・未設定なら null。 */
export function typeDueMinutes(slot: JyobanSlot, type: JyobanTimedType): number | null {
  switch (type) {
    case 'wakeup': return slot.wakeupRequired === true && isValidHm(slot.wakeupDue) ? dueMinutes(slot.wakeupDue, slot.workStart) : null
    case 'departure': return slot.departureRequired && isValidHm(slot.departureDue) ? dueMinutes(slot.departureDue, slot.workStart) : null
    case 'onduty': return slot.ondutyRequired && isValidHm(slot.ondutyDue) ? dueMinutes(slot.ondutyDue, slot.workStart) : null
    case 'offduty': return slot.offdutyRequired === true && isValidHm(slot.offdutyDue) ? offdutyDueMinutes(slot.offdutyDue, slot.workStart) : null
  }
}

/** ローカル日時 'YYYY-MM-DDTHH:MM' を「勤務日0時からの分」に換算する（前日なら負、翌日なら1440超）。 */
export function localMinutesFrom(workDate: string, localDateTime: string): number {
  const dayDiff = toEpochDay(localDateTime.slice(0, 10)) - toEpochDay(workDate)
  return dayDiff * 24 * 60 + hmToMin(localDateTime.slice(11, 16))
}

function firstReport(list: JyobanReport[], workDate: string): { report: JyobanReport; at: number } | undefined {
  let best: { report: JyobanReport; at: number } | undefined
  for (const r of list) {
    const at = localMinutesFrom(workDate, r.receivedAt)
    if (best === undefined || at < best.at) best = { report: r, at }
  }
  return best
}

function check(
  dueAt: number | null, slot: JyobanSlot,
  nowMinutes: number, found: { report: JyobanReport; at: number } | undefined,
): ReportCheck {
  if (dueAt === null) {
    return found === undefined ? { state: 'not_required' } : { state: 'done', atMinutes: found.at, lateMin: 0 }
  }
  if (found !== undefined) return { state: 'done', atMinutes: found.at, lateMin: Math.max(0, found.at - dueAt) }
  return nowMinutes > dueAt + slot.graceMin ? { state: 'missing' } : { state: 'pending' }
}

export interface ComputeSlotStatusInput {
  slot: JyobanSlot
  workDate: string
  /** 現在時刻（勤務日0時からの分） */
  nowMinutes: number
  reports: JyobanReport[]
  /** 本社が「確認済み」にしたか */
  acknowledged?: boolean
  /** 勤務表上の配置者のスタッフNo（交代検知用） */
  scheduledStaffNo?: string
}

/** 勤務枠×勤務日のステータスを判定する。 */
export function computeSlotStatus(input: ComputeSlotStatusInput): SlotStatusResult {
  const { slot, workDate, nowMinutes } = input
  const mine = input.reports.filter((r) => r.slotId === slot.id && r.workDate === workDate && r.voided !== true)
  const dep = firstReport(mine.filter((r) => r.type === 'departure'), workDate)
  const on = firstReport(mine.filter((r) => r.type === 'onduty'), workDate)
  const others = mine.filter((r) => r.type === 'other')
  let other: JyobanReport | undefined
  for (const r of others) {
    if (other === undefined || localMinutesFrom(workDate, r.receivedAt) >= localMinutesFrom(workDate, other.receivedAt)) other = r
  }

  const wak = firstReport(mine.filter((r) => r.type === 'wakeup'), workDate)
  const off = firstReport(mine.filter((r) => r.type === 'offduty'), workDate)
  const wakeup0 = check(typeDueMinutes(slot, 'wakeup'), slot, nowMinutes, wak)
  const departure = check(typeDueMinutes(slot, 'departure'), slot, nowMinutes, dep)
  const onduty = check(typeDueMinutes(slot, 'onduty'), slot, nowMinutes, on)
  const offduty = check(typeDueMinutes(slot, 'offduty'), slot, nowMinutes, off)
  // 上番済みなら、出発連絡の未着は「省略」とし未連絡扱いにしない（隊員を責めない運用）
  const ondutyDone = onduty.state === 'done'
  const dep2: ReportCheck = ondutyDone && (departure.state === 'missing' || departure.state === 'pending')
    ? { state: 'skipped' } : departure

  // 出発・上番・下番のどれかが届いていれば、起床連絡の未着は「省略」とする
  const laterDone = dep !== undefined || on !== undefined || off !== undefined
  const wakeup: ReportCheck = laterDone && (wakeup0.state === 'missing' || wakeup0.state === 'pending')
    ? { state: 'skipped' } : wakeup0

  const reporter = (on ?? dep)?.report
  const substitute = input.scheduledStaffNo !== undefined && reporter !== undefined
    && reporter.staffNo !== input.scheduledStaffNo

  const base = { wakeup, departure: dep2, onduty, offduty, other, substitute, reporterStaffNo: reporter?.staffNo }

  if (!isSlotScheduledOn(slot, workDate)) return { status: 'not_scheduled', ...base }

  const anyMissing = [wakeup, dep2, onduty, offduty].some((c) => c.state === 'missing')
  const needsAttention = anyMissing || other !== undefined
  if (needsAttention && input.acknowledged === true) return { status: 'acknowledged', ...base }
  if (anyMissing) return { status: 'missing', ...base }
  if (other !== undefined) return { status: 'other_reported', ...base }

  const finished = slot.ondutyRequired ? ondutyDone : dep2.state === 'done'
  if (finished) return { status: 'on_duty', ...base }
  if (dep2.state === 'done') return { status: 'departed', ...base }
  return { status: 'pending', ...base }
}

/** 本社一覧の並び替え（対応が必要な順・同順位は元の順を保つ）。 */
export function sortSlotRows<T extends { status: SlotStatus }>(rows: T[]): T[] {
  const rank = (s: SlotStatus): number => {
    const i = (JYOBAN_STATUS_ORDER as SlotStatus[]).indexOf(s)
    return i < 0 ? JYOBAN_STATUS_ORDER.length : i
  }
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.status) - rank(b.r.status) || a.i - b.i).map((x) => x.r)
}

/** ステータス別の件数（稼働日でない枠は数えない）。 */
export function summarizeSlotStatuses(rows: { status: SlotStatus }[]): Record<Exclude<SlotStatus, 'not_scheduled'>, number> {
  const out = { missing: 0, other_reported: 0, departed: 0, pending: 0, on_duty: 0, acknowledged: 0 }
  for (const r of rows) if (r.status !== 'not_scheduled') out[r.status] += 1
  return out
}

const TOKEN = /^[A-Za-z0-9_-]{6,64}$/

/** 現場QRに載せる報告URL（勤務員PWA /app/r/<トークン>）。トークンは英数と _- のみ。 */
export function buildReportUrl(origin: string, token: string): string {
  if (!TOKEN.test(token)) throw new Error('報告トークンの形式が不正です')
  return `${origin.replace(/\/+$/, '')}/app/r/${token}`
}
