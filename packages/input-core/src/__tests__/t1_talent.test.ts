// [TLN] 応募可否・更新手続き。AAA / 「対象_条件_期待」
import { describe, it, expect } from 'vitest'
import {
  ageOn, fiscalYearOf, shiftsOverlap, checkEligibility, listApplicableJobs, validateJobForPublish, listRenewals,
  type PersonProfile, type JobPost,
} from '../index.js'

const HITO = 'c-hitotohito'
const CAREER = 'c-careerise'

const person = (o: Partial<PersonProfile> = {}): PersonProfile => ({
  personId: 'p1', birthDate: '1990-05-10', consentJointUse: true,
  employments: [{ companyId: HITO, startOn: '2025-04-01' }],
  guardTraining: { basicDoneOn: '2025-04-20', annualFiscalYears: [2025, 2026] },
  ...o,
})
const job = (o: Partial<JobPost> = {}): JobPost => ({
  jobId: 'j1', employerCompanyId: HITO, form: 'security', isSecurityWork: true, nightWork: false,
  employmentDays: 1, shifts: [{ date: '2026-11-14', start: '09:00', end: '17:00' }], mode: 'apply_review', ...o,
})

describe('[TLN] 日付ヘルパ', () => {
  it('ageOn_誕生日前後_満年齢', () => {
    expect(ageOn('2008-11-15', '2026-11-14')).toBe(17)
    expect(ageOn('2008-11-14', '2026-11-14')).toBe(18)
  })
  it('fiscalYearOf_3月と4月_年度が替わる', () => {
    expect(fiscalYearOf('2027-03-31')).toBe(2026)
    expect(fiscalYearOf('2026-04-01')).toBe(2026)
  })
  it('shiftsOverlap_夜勤の日またぎ_翌朝と重なる', () => {
    const night = { date: '2026-11-14', start: '22:00', end: '06:00' }
    expect(shiftsOverlap(night, { date: '2026-11-15', start: '05:00', end: '09:00' })).toBe(true)
    expect(shiftsOverlap(night, { date: '2026-11-15', start: '06:00', end: '09:00' })).toBe(false)
  })
})

describe('[TLN] 警備', () => {
  it('警備_教育済みの自社警備員_応募できる', () => {
    expect(checkEligibility(person(), job())).toEqual({ eligible: true, reasons: [], warnings: [] })
  })
  it('警備_新任教育なし_応募できない', () => {
    const r = checkEligibility(person({ guardTraining: { annualFiscalYears: [] } }), job())
    expect(r.reasons).toContain('security_basic_training_missing')
  })
  it('警備_今年度の現任未了_応募できない', () => {
    const r = checkEligibility(person({ guardTraining: { basicDoneOn: '2024-05-01', annualFiscalYears: [2025] } }), job())
    expect(r.reasons).toEqual(['security_annual_training_missing'])
  })
  it('警備_今年度に新任修了_現任なしでも応募できる', () => {
    const p = person({ guardTraining: { basicDoneOn: '2026-06-01', annualFiscalYears: [] } })
    expect(checkEligibility(p, job()).eligible).toBe(true)
  })
  it('警備_派遣は組めない_公開前チェックで止まる', () => {
    expect(validateJobForPublish(job({ form: 'dispatch' }))).toEqual(['security_dispatch_forbidden'])
    expect(checkEligibility(person(), job({ form: 'dispatch', employmentDays: 90 })).reasons).toContain('security_dispatch_forbidden')
  })
  it('警備_18歳未満_応募できない', () => {
    expect(checkEligibility(person({ birthDate: '2009-01-01' }), job()).reasons).toContain('under_age')
  })
})

describe('[TLN] 派遣・スポット', () => {
  const careerP = (o: Partial<PersonProfile> = {}) => person({ employments: [{ companyId: CAREER, startOn: '2026-01-01' }], ...o })
  const dispatch = (days: number) => job({ employerCompanyId: CAREER, form: 'dispatch', isSecurityWork: false, employmentDays: days })

  it('日雇派遣_例外なし_応募できない', () => {
    expect(checkEligibility(careerP(), dispatch(1)).reasons).toEqual(['daily_dispatch_not_allowed'])
  })
  it('日雇派遣_例外該当_応募できる', () => {
    const p = careerP({ dailyDispatchException: { kind: 'day_student', verifiedOn: '2026-10-01' } })
    expect(checkEligibility(p, dispatch(1)).eligible).toBe(true)
  })
  it('派遣_31日以上_例外不要', () => {
    expect(checkEligibility(careerP(), dispatch(31)).eligible).toBe(true)
  })
  it('スポット_登録スタッフ_即応募できる', () => {
    const j = job({ employerCompanyId: CAREER, form: 'spot', isSecurityWork: false, mode: 'instant' })
    expect(checkEligibility(careerP(), j).eligible).toBe(true)
  })
  it('スポット_未登録_応募できない', () => {
    const j = job({ employerCompanyId: CAREER, form: 'spot', isSecurityWork: false })
    expect(checkEligibility(person(), j).reasons).toEqual(['not_registered'])
  })
  it('スポット_退社後_応募できない', () => {
    const p = person({ employments: [{ companyId: CAREER, startOn: '2025-01-01', endOn: '2026-03-31' }] })
    const j = job({ employerCompanyId: CAREER, form: 'spot', isSecurityWork: false })
    expect(checkEligibility(p, j).reasons).toContain('not_registered')
  })
  it('夜間_18歳未満_応募できない', () => {
    const j = job({ employerCompanyId: CAREER, form: 'spot', isSecurityWork: false, nightWork: true })
    expect(checkEligibility(careerP({ birthDate: '2010-01-01' }), j).reasons).toContain('under_age')
  })
})

describe('[TLN] 共通ルール', () => {
  it('同意なし_応募できない', () => {
    expect(checkEligibility(person({ consentJointUse: false }), job()).reasons).toContain('no_consent')
  })
  it('在留_期限切れ_応募できない', () => {
    const r = checkEligibility(person({ residence: { workAllowed: true, expiresOn: '2026-11-01' } }), job())
    expect(r.reasons).toContain('residence_invalid')
  })
  it('在留_就労不可_応募できない', () => {
    expect(checkEligibility(person({ residence: { workAllowed: false } }), job()).reasons).toContain('residence_invalid')
  })
  it('在留_60日以内に切れる_応募できるが警告', () => {
    const r = checkEligibility(person({ residence: { workAllowed: true, expiresOn: '2026-12-31' } }), job())
    expect(r.eligible).toBe(true)
    expect(r.warnings).toContain('residence_expiring')
  })
  it('時間が重なる別勤務_応募できない', () => {
    const busy = [{ companyId: 'c-other', date: '2026-11-14', start: '12:00', end: '18:00' }]
    expect(checkEligibility(person(), job(), busy).reasons).toContain('time_overlap')
  })
  it('他社と合わせて1日8時間超_警告', () => {
    const busy = [{ companyId: 'c-other', date: '2026-11-14', start: '18:00', end: '21:00' }]
    expect(checkEligibility(person(), job(), busy).warnings).toContain('daily_hours_over_8')
  })
  it('線引き未確認の案件_公開も応募もできない', () => {
    const j = job({ isSecurityWork: false, form: 'spot', needsBoundaryCheck: true })
    expect(validateJobForPublish(j)).toEqual(['boundary_not_confirmed'])
    const ok = { ...j, boundaryCheck: { confirmedBy: 'u1', confirmedOn: '2026-11-01' } }
    expect(validateJobForPublish(ok)).toEqual([])
  })
  it('しごと一覧_応募できる案件だけ残る', () => {
    const jobs = [job({ jobId: 'a' }), job({ jobId: 'b', employerCompanyId: CAREER, form: 'spot', isSecurityWork: false })]
    expect(listApplicableJobs(person(), jobs).map((j) => j.jobId)).toEqual(['a'])
  })
})

describe('[TLN] 更新手続き', () => {
  const ref = '2026-11-07'
  it('契約満了_30日以内と期限切れ_近い順', () => {
    const ps = [
      person({ personId: 'a', employments: [{ companyId: HITO, startOn: '2025-04-01', contractEndOn: '2026-11-30' }] }),
      person({ personId: 'b', employments: [{ companyId: HITO, startOn: '2025-04-01', contractEndOn: '2026-11-01' }] }),
      person({ personId: 'c', employments: [{ companyId: HITO, startOn: '2025-04-01', contractEndOn: '2027-03-31' }] }),
    ]
    expect(listRenewals(ps, ref).map((i) => [i.personId, i.urgency])).toEqual([['b', 'expired'], ['a', 'soon']])
  })
  it('契約満了_退社済み_対象外', () => {
    const p = person({ employments: [{ companyId: HITO, startOn: '2025-04-01', endOn: '2026-10-01', contractEndOn: '2026-11-30' }] })
    expect(listRenewals([p], ref)).toEqual([])
  })
  it('現任教育_年度末が近い_未達の人だけ', () => {
    const near = '2027-03-10'
    const todo = person({ personId: 'x', guardTraining: { basicDoneOn: '2024-05-01', annualFiscalYears: [2025] } })
    const done = person({ personId: 'y' })
    const items = listRenewals([todo, done], near)
    expect(items.map((i) => [i.personId, i.kind, i.dueOn, i.urgency])).toEqual([['x', 'annual_training', '2027-03-31', 'soon']])
  })
  it('現任教育_新任未修了や今年度新任_対象外', () => {
    const a = person({ personId: 'a', guardTraining: { annualFiscalYears: [] } })
    const b = person({ personId: 'b', guardTraining: { basicDoneOn: '2026-06-01', annualFiscalYears: [] } })
    expect(listRenewals([a, b], '2027-03-10')).toEqual([])
  })
  it('在留期限_30日以内_一覧に出る', () => {
    const p = person({ residence: { workAllowed: true, expiresOn: '2026-12-01' } })
    expect(listRenewals([p], ref)[0]).toMatchObject({ kind: 'residence', daysLeft: 24, urgency: 'soon' })
  })
})
