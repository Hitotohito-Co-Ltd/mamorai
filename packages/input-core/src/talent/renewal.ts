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
 * 現任教育: 今年度が未達で、新任をその年度に修了していない警備員のみ（年度末が期限）。
 */
export function listRenewals(people: PersonProfile[], referenceDate: string, soonDays = 30): RenewalItem[] {
  const fy = fiscalYearOf(referenceDate)
  const out: RenewalItem[] = []
  for (const p of people) {
    for (const e of p.employments) {
      if (e.contractEndOn && !e.endOn) out.push(item(p.personId, 'contract', e.contractEndOn, referenceDate, soonDays))
    }
    const t = p.guardTraining
    if (t.basicDoneOn) {
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
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.daysLeft - b.daysLeft || a.personId.localeCompare(b.personId))
}
