// [TLN] 更新手続きの期限一覧（雇用契約の満了・現任教育・在留期限）。紙の更新管理表の置き換え
import type { PersonProfile } from './model.js'
import { fiscalYearOf, isRealDate } from './eligibility.js'

export type RenewalKind = 'contract' | 'annual_training' | 'residence'
export type RenewalUrgency = 'expired' | 'soon' | 'ok' | 'invalid'

export interface RenewalItem {
  personId: string
  kind: RenewalKind
  /** 期限日（現任教育は年度末 3/31） */
  dueOn: string
  /** 期限日が不正な項目（invalid）は null */
  daysLeft: number | null
  urgency: RenewalUrgency
}

const MS_PER_DAY = 86_400_000
function utcDay(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y!, m! - 1, dd!)
}

const KIND_RANK: Record<RenewalKind, number> = { contract: 0, annual_training: 1, residence: 2 }

function item(personId: string, kind: RenewalKind, dueOn: string, ref: string, soonDays: number): RenewalItem {
  const daysLeft = Math.round((utcDay(dueOn) - utcDay(ref)) / MS_PER_DAY)
  const urgency: RenewalUrgency = daysLeft < 0 ? 'expired' : daysLeft <= soonDays ? 'soon' : 'ok'
  return { personId, kind, dueOn, daysLeft, urgency }
}

/** 期限日が不正で判定できない項目。一覧から消さず、人が確認できるように返す */
function invalidItem(personId: string, kind: RenewalKind, dueOn: string): RenewalItem {
  return { personId, kind, dueOn, daysLeft: null, urgency: 'invalid' }
}

/** コードポイント順の比較（UTF-16 の並びではなく、サロゲートペアの文字を 1 つのコードポイントとして比較する） */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1
}

/**
 * 更新が必要な項目を返す。期限切れまたは soonDays 以内のものだけ。期限日が不正な項目は invalid として先頭に返す。
 * 現任教育: 在籍中の雇用があり、今年度が未達で、新任をその年度に修了していない警備員のみ（年度末が期限）。
 * 基準日が不正なときは RangeError。
 */
export function listRenewals(people: PersonProfile[], referenceDate: string, soonDays = 30): RenewalItem[] {
  if (!isRealDate(referenceDate)) throw new RangeError(`基準日が不正です: ${referenceDate}`)
  const fy = fiscalYearOf(referenceDate)
  const out: RenewalItem[] = []
  for (const p of people) {
    const empInvalid = (e: PersonProfile['employments'][number]) =>
      !isRealDate(e.startOn) || (e.endOn !== undefined && !isRealDate(e.endOn))
    // 在籍中 = 入社日が基準日以前、かつ退社日がない、または退社日が基準日以後
    const isActive = (e: PersonProfile['employments'][number]) =>
      e.startOn <= referenceDate && (e.endOn === undefined || e.endOn >= referenceDate)
    for (const e of p.employments) {
      if (e.contractEndOn === undefined) continue
      if (!isRealDate(e.contractEndOn) || empInvalid(e)) out.push(invalidItem(p.personId, 'contract', e.contractEndOn))
      else if (isActive(e)) out.push(item(p.personId, 'contract', e.contractEndOn, referenceDate, soonDays))
    }
    const t = p.guardTraining
    // 現任教育の履歴が配列でない人は、判定できない項目として返す（一覧全体を失敗させない）
    const trainingInvalid = !Array.isArray(t.annualFiscalYears)
    if (trainingInvalid) out.push(invalidItem(p.personId, 'annual_training', `${fy + 1}-03-31`))
    const anyEmpInvalid = p.employments.some(empInvalid)
    const active = p.employments.some((e) => !empInvalid(e) && isActive(e))
    // 新任教育の修了日が基準日より後（基準日時点で未修了）の人は対象外
    if (trainingInvalid) {
      // 上で invalid 項目を返した
    } else if (t.basicDoneOn !== undefined && !isRealDate(t.basicDoneOn)) {
      // 新任教育の修了日が不正: 今年度の現任が済んでいなければ、判定できない項目として返す
      if (!t.annualFiscalYears.includes(fy)) out.push(invalidItem(p.personId, 'annual_training', `${fy + 1}-03-31`))
    } else if (t.basicDoneOn && t.basicDoneOn <= referenceDate) {
      const basicThisYear = fiscalYearOf(t.basicDoneOn) === fy
      const pending = !basicThisYear && !t.annualFiscalYears.includes(fy)
      if (pending && anyEmpInvalid) out.push(invalidItem(p.personId, 'annual_training', `${fy + 1}-03-31`))
      else if (pending && active) out.push(item(p.personId, 'annual_training', `${fy + 1}-03-31`, referenceDate, soonDays))
    }
    if (p.residence?.expiresOn !== undefined) {
      if (!isRealDate(p.residence.expiresOn)) out.push(invalidItem(p.personId, 'residence', p.residence.expiresOn))
      else out.push(item(p.personId, 'residence', p.residence.expiresOn, referenceDate, soonDays))
    }
  }
  const rank = { invalid: -1, expired: 0, soon: 1, ok: 2 } as const
  return out
    .filter((i) => i.urgency !== 'ok')
    .sort(
      (a, b) =>
        rank[a.urgency] - rank[b.urgency] ||
        (a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
        compareCodePoints(a.personId, b.personId) ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind],
    )
}
