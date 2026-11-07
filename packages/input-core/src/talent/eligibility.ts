// [TLN] 応募可否の判定。「契約の形 × 本人の状態」を1か所で決める（画面とserverで同じ式を使う）
import type {
  BusyShift,
  EligibilityReason,
  EligibilityResult,
  JobPost,
  JobShift,
  PersonProfile,
} from './model.js'

const MS_PER_DAY = 86_400_000
const DAILY_DISPATCH_MAX_DAYS = 30
const RESIDENCE_WARN_DAYS = 60

/** UTC の日付のエポックミリ秒。Date.UTC は 0〜99 年を 1900 年代に読み替えるため setUTCFullYear を使う */
function utcMs(y: number, m: number, dd: number): number {
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, dd)
  return t.getTime()
}
function utcDay(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return utcMs(y!, m!, dd!)
}
function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h! * 60 + m!
}

/** 満年齢 */
export function ageOn(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = on.split('-').map(Number)
  let age = y! - by!
  if (m! < bm! || (m === bm && d! < bd!)) age -= 1
  return age
}

/** 年度（4月始まり） */
export function fiscalYearOf(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return m! >= 4 ? y! : y! - 1
}

/** 日をまたぐ勤務（終了が開始以前）は翌日終了として扱う */
function span(s: JobShift): [number, number] {
  const base = utcDay(s.date) / 60_000
  const st = base + minutes(s.start)
  let en = base + minutes(s.end)
  if (en <= st) en += 24 * 60
  return [st, en]
}

export function shiftsOverlap(a: JobShift, b: JobShift): boolean {
  const [as, ae] = span(a)
  const [bs, be] = span(b)
  return as < be && bs < ae
}

function dailyHours(shifts: JobShift[], date: string): number {
  return shifts.filter((s) => s.date === date).reduce((sum, s) => {
    const [st, en] = span(s)
    return sum + (en - st) / 60
  }, 0)
}

const DISPATCH_EXCEPTION_KINDS: readonly string[] = ['age60', 'day_student', 'side_job', 'household_income']

/** シフトが夜間（22:00〜翌05:00）にかかるか。開始が 05:00 より前、終了が 22:00 より後、または日をまたぐ（終了が開始以前） */
function shiftIsNight(s: JobShift): boolean {
  const st = minutes(s.start)
  const en = minutes(s.end)
  return st < 5 * 60 || en > 22 * 60 || en <= st
}

/** 空白とゼロ幅文字（U+200B〜U+200D、U+2060、U+FEFF）。DB 側の判定（0416）と同じ基準 */
const INVISIBLE_OR_SPACE = /[\s\u3000\u200B-\u200D\u2060\uFEFF]/g

/** 線引き確認の記録: 確認者が空白・ゼロ幅文字を除いて空でなく、確認日が暦に存在する日付 */
function boundaryRecorded(job: JobPost): boolean {
  const b = job.boundaryCheck
  return (
    !!b &&
    typeof b.confirmedBy === 'string' &&
    b.confirmedBy.replace(INVISIBLE_OR_SPACE, '') !== '' &&
    isRealDate(b.confirmedOn)
  )
}

/** 'HH:MM'（00:00〜23:59）か */
function isRealTime(t: string): boolean {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}

/** 案件の日付・時刻・期間の入力が不正か（シフト日と時刻、派遣の雇用日数） */
function jobInputInvalid(job: JobPost): boolean {
  if (job.shifts.some((s) => !isRealDate(s.date) || !isRealTime(s.start) || !isRealTime(s.end))) return true
  if (job.form === 'dispatch' && !(Number.isInteger(job.employmentDays) && job.employmentDays >= 0)) return true
  return false
}

/** 'YYYY-MM-DD' の形式で、暦に存在する日付か */
export function isRealDate(d: string): boolean {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const [y, m, dd] = d.split('-').map(Number)
  const t = new Date(utcMs(y!, m!, dd!))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === dd
}

/** 日雇派遣の例外: 確認日が有効でシフト日以前、age60 はシフト日に満60歳以上 */
function dispatchExceptionValid(p: PersonProfile, shiftDate: string): boolean {
  const ex = p.dailyDispatchException
  if (!ex) return false
  if (!DISPATCH_EXCEPTION_KINDS.includes(ex.kind)) return false
  if (!isRealDate(ex.verifiedOn) || ex.verifiedOn > shiftDate) return false
  if (ex.kind === 'age60' && ageOn(p.birthDate, shiftDate) < 60) return false
  return true
}

/** 警備の枠に応募するための教育状態（新任修了＋その年度の現任、または新任をその年度に修了） */
function securityTraining(p: PersonProfile, onDate: string): EligibilityReason | null {
  const t = p.guardTraining
  if (!t.basicDoneOn || t.basicDoneOn > onDate) return 'security_basic_training_missing'
  const fy = fiscalYearOf(onDate)
  const basicThisYear = fiscalYearOf(t.basicDoneOn) === fy
  if (!basicThisYear && !t.annualFiscalYears.includes(fy)) return 'security_annual_training_missing'
  return null
}

/**
 * 応募可否。全シフト日について判定し、1日でも満たさない日があれば不可。
 * reasons は管理者向け。スタッフの「しごと」一覧では不可の案件を出さない。
 */
export function checkEligibility(
  person: PersonProfile,
  job: JobPost,
  busy: BusyShift[] = [],
): EligibilityResult {
  const reasons = new Set<EligibilityReason>()
  const warnings = new Set<'daily_hours_over_8' | 'residence_expiring'>()

  // 不正な入力は黙って通さない（法令リスクの高い判定のため、拒否する）
  if (
    jobInputInvalid(job) ||
    busy.some((b) => !isRealDate(b.date) || !isRealTime(b.start) || !isRealTime(b.end)) ||
    person.employments.some((e) => !isRealDate(e.startOn) || (e.endOn !== undefined && !isRealDate(e.endOn))) ||
    !isRealDate(person.birthDate) ||
    !Array.isArray(person.guardTraining.annualFiscalYears) ||
    (person.guardTraining.basicDoneOn !== undefined && !isRealDate(person.guardTraining.basicDoneOn)) ||
    (person.residence?.expiresOn !== undefined && !isRealDate(person.residence.expiresOn))
  ) {
    return { eligible: false, reasons: ['invalid_input'], warnings: [], details: {} }
  }

  if (!person.consentJointUse) reasons.add('no_consent')

  // 警備業務は派遣にできない
  if (job.isSecurityWork && job.form === 'dispatch') reasons.add('security_dispatch_forbidden')

  // 雇用主に登録（在籍）していること
  // 在籍は全シフト日で確認する（最終シフト日より前に退社する人は不可）
  const dates = job.shifts.map((s) => s.date)
  const registered = dates.every((d) =>
    person.employments.some(
      (e) => e.companyId === job.employerCompanyId && e.startOn <= d && (!e.endOn || e.endOn >= d),
    ),
  )
  if (!registered) reasons.add('not_registered')

  // シフトが1件もない案件には応募できない
  if (job.shifts.length === 0) reasons.add('no_shifts')

  // 日雇派遣（30日以内）は例外に当たる人だけ。例外は確認日が有効で、区分の条件を満たすこと
  const dailyDispatch = job.form === 'dispatch' && job.employmentDays <= DAILY_DISPATCH_MAX_DAYS
  if (dailyDispatch && !person.dailyDispatchException) reasons.add('daily_dispatch_not_allowed')

  // 運営と警備の線引きの確認
  if (job.needsBoundaryCheck && !boundaryRecorded(job)) reasons.add('boundary_not_confirmed')

  let residenceDaysLeft: number | undefined
  for (const s of job.shifts) {
    if (dailyDispatch && person.dailyDispatchException && !dispatchExceptionValid(person, s.date)) {
      reasons.add('dispatch_exception_invalid')
    }
    const age = ageOn(person.birthDate, s.date)
    if (age < 18 && (job.isSecurityWork || job.nightWork || job.shifts.some(shiftIsNight))) reasons.add('under_age')
    if (job.isSecurityWork && job.form !== 'dispatch') {
      const r = securityTraining(person, s.date)
      if (r) reasons.add(r)
    }
    const res = person.residence
    if (res) {
      if (!res.workAllowed || (res.expiresOn && res.expiresOn < s.date)) reasons.add('residence_invalid')
      else if (res.expiresOn) {
        const left = (utcDay(res.expiresOn) - utcDay(s.date)) / MS_PER_DAY
        if (left <= RESIDENCE_WARN_DAYS) {
          warnings.add('residence_expiring')
          residenceDaysLeft = residenceDaysLeft === undefined ? left : Math.min(residenceDaysLeft, left)
        }
      }
    }
    if (busy.some((b) => shiftsOverlap(b, s))) reasons.add('time_overlap')
  }

  // 複数社の労働時間の通算（1日8時間超は警告）
  let maxDailyHours: number | undefined
  for (const d of new Set(dates)) {
    const total = dailyHours(busy, d) + dailyHours(job.shifts, d)
    if (total > 8) {
      warnings.add('daily_hours_over_8')
      maxDailyHours = maxDailyHours === undefined ? total : Math.max(maxDailyHours, total)
    }
  }

  // 在留で拒否するときは、期限の警告を同時に返さない
  if (reasons.has('residence_invalid')) {
    warnings.delete('residence_expiring')
    residenceDaysLeft = undefined
  }

  const details: EligibilityResult['details'] = {}
  if (residenceDaysLeft !== undefined) details.residenceDaysLeft = residenceDaysLeft
  if (maxDailyHours !== undefined) details.maxDailyHours = maxDailyHours

  const list = [...reasons]
  return { eligible: list.length === 0, reasons: list, warnings: [...warnings], details }
}

/** スタッフの「しごと」一覧用: 応募できる案件だけを残す（理由は出さない） */
export function listApplicableJobs(person: PersonProfile, jobs: JobPost[], busy: BusyShift[] = []): JobPost[] {
  return jobs.filter((j) => checkEligibility(person, j, busy).eligible)
}

/** 案件の公開前チェック（管理者向け）。公開してよければ空配列 */
export function validateJobForPublish(job: JobPost): EligibilityReason[] {
  const out: EligibilityReason[] = []
  if (job.isSecurityWork && job.form === 'dispatch') out.push('security_dispatch_forbidden')
  if (job.needsBoundaryCheck && !boundaryRecorded(job)) out.push('boundary_not_confirmed')
  if (job.shifts.length === 0) out.push('no_shifts')
  if (jobInputInvalid(job)) out.push('invalid_input')
  return out
}
