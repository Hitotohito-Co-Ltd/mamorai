// [TLN] 更新手続きの期限一覧（雇用契約の満了・現任教育・在留期限）。紙の更新管理表の置き換え
import type { PersonProfile } from './model.js'
import { fiscalYearOf } from './eligibility.js'

export type RenewalKind = 'contract' | 'annual_training' | 'residence'
export type RenewalUrgency = 'expired' | 'soon' | 'ok'

export interface RenewalItem {
  personId: string
  kind: RenewalKind
  /** 期限日（現任教育は年度末 3/31） */
  dueOn: string
  daysLeft: number
  urgency: RenewalUrgency
}

const MS_PER_DAY = 86_400_000
function utcDay(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y!, m! - 1, dd!)
}

function item(personId: string, kind: RenewalKind, dueOn: string, ref: string, soonDays: number): RenewalItem {
  const daysLeft = Math.round((utcDay(dueOn) - utcDay(ref)) / MS_PER_DAY)
  const urgency: RenewalUrgency = daysLeft < 0 ? 'expired' : daysLeft <= soonDays ? 'soon' : 'ok'
  return { personId, kind, dueOn, daysLeft, urgency }
}

/**
 * 更新が必要な項目を、期限が近い順に返す。
 * 現任教育: 在籍中の雇用があり、今年度が未達で、新任をその年度に修了していない警備員のみ（年度末が期限）。
 */
export function listRenewals(people: PersonProfile[], referenceDate: string, soonDays = 30): RenewalItem[] {
  const fy = fiscalYearOf(referenceDate)
  const out: RenewalItem[] = []
  for (const p of people) {
    // 在籍中 = 入社日が基準日以前、かつ退社日がない、または退社日が基準日以後
    const isActive = (e: PersonProfile['employments'][number]) =>
      e.startOn <= referenceDate && (!e.endOn || e.endOn >= referenceDate)
    for (const e of p.employments) {
      if (e.contractEndOn && isActive(e)) out.push(item(p.personId, 'contract', e.contractEndOn, referenceDate, soonDays))
    }
    // 在籍中の雇用が1件もない人は現任教育の対象外
    const active = p.employments.some(isActive)
    const t = p.guardTraining
    // 新任教育の修了日が基準日より後（基準日時点で未修了）の人は対象外
    if (active && t.basicDoneOn && t.basicDoneOn <= referenceDate) {
      const basicThisYear = fiscalYearOf(t.basicDoneOn) === fy
      if (!basicThisYear && !t.annualFiscalYears.includes(fy)) {
        out.push(item(p.personId, 'annual_training', `${fy + 1}-03-31`, referenceDate, soonDays))
      }
    }
    if (p.residence?.expiresOn) out.push(item(p.personId, 'residence', p.residence.expiresOn, referenceDate, soonDays))
  }
  const rank = { expired: 0, soon: 1, ok: 2 } as const
  return out
    .filter((i) => i.urgency !== 'ok')
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.daysLeft - b.daysLeft || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0))
}
