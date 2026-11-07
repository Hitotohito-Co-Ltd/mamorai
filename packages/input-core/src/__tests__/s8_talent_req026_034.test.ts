// Sprint 8: 応募可否の判定・更新手続き・台帳/案件/応募のDB土台
// REQ-026〜034、NFR-05 の RED テスト
// テスト規約: AAA / describe '[REQ-0xx]' / 日本語 it 名 / 固定日時（Date.now/new Date() 禁止） / 純粋・決定論
// 注意: 実装コード (eligibility.ts / renewal.ts) は読まずに作成（ミラーテスト防止）

import { describe, it, expect } from 'vitest'
import {
  checkEligibility,
  validateJobForPublish,
  listRenewals,
  listApplicableJobs,
  ageOn,
  fiscalYearOf,
  shiftsOverlap,
} from '../index.js'
import type {
  PersonProfile,
  JobPost,
  BusyShift,
  EligibilityResult,
} from '../index.js'

// ─────────────────────────────────────────────────────────────
// 固定日付
// ─────────────────────────────────────────────────────────────
/** REQ-028 年度境界テスト用: FY2025 末日 */
const FY2025_LAST = '2026-03-31'
/** REQ-028 年度境界テスト用: FY2026 初日 */
const FY2026_FIRST = '2026-04-01'
/** REQ-033 基準日: FY2026 年度末 25 日前（現任教育の 30 日前テスト用） */
const RENEWAL_DATE_FY2026 = '2027-03-05'
/** REQ-033 年度末（FY2026 現任教育の期限） */
const FY2026_END = '2027-03-31'

// ─────────────────────────────────────────────────────────────
// フィクスチャファクトリ
// ─────────────────────────────────────────────────────────────

/** 有効な PersonProfile（警備応募に必要な最小条件を全て満たす） */
function mkPerson(override: Partial<PersonProfile> = {}): PersonProfile {
  return {
    personId: 'p-001',
    birthDate: '1990-01-01',           // 2026-04-15 時点で 36 歳
    consentJointUse: true,
    employments: [
      { companyId: 'c-001', startOn: '2020-01-01' },  // 退社日なし＝在籍中
    ],
    guardTraining: {
      basicDoneOn: '2020-06-01',       // 新任修了済み
      annualFiscalYears: [2025, 2026], // 昨年度・今年度の現任教育修了
    },
    ...override,
  }
}

/** 有効な JobPost（上書き可能） */
function mkJob(override: Partial<JobPost> = {}): JobPost {
  return {
    jobId: 'j-001',
    employerCompanyId: 'c-001',
    form: 'security',
    isSecurityWork: true,
    nightWork: false,
    employmentDays: 90,
    shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    mode: 'apply_review',
    ...override,
  }
}

// ─────────────────────────────────────────────────────────────
// REQ-026: 応募可否の判定
// ─────────────────────────────────────────────────────────────
describe('[REQ-026] 応募可否の判定', () => {
  it('eligible_全条件を満たすとき_eligible=true_reasons空_warnings空', () => {
    // Arrange
    const person = mkPerson()
    const job = mkJob()
    // Act
    const result: EligibilityResult = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('eligible_複数シフト全日在籍中_eligible=true', () => {
    // Arrange
    const person = mkPerson({
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
    })
    const job = mkJob({
      shifts: [
        { date: '2026-05-01', start: '09:00', end: '17:00' },
        { date: '2026-05-10', start: '09:00', end: '17:00' },
        { date: '2026-05-20', start: '09:00', end: '17:00' },
      ],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
  })

  it('enrollment_最終シフト日より前に退社する人は不可', () => {
    // Arrange: 退社日が 2026-04-30、最終シフト日は 2026-05-10 → 在籍外
    const person = mkPerson({
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', endOn: '2026-04-30' },
      ],
    })
    const job = mkJob({
      shifts: [
        { date: '2026-04-28', start: '09:00', end: '17:00' },
        { date: '2026-05-10', start: '09:00', end: '17:00' }, // 在籍外
      ],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: この3点は仕様確定した「落ちるべきテスト」の1つ
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('not_registered')
  })

  it('enrollment_入社前のシフト日は不可', () => {
    // Arrange: 入社日が 2026-05-05、シフト日が 2026-05-01
    const person = mkPerson({
      employments: [{ companyId: 'c-001', startOn: '2026-05-05' }],
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('not_registered')
  })

  it('enrollment_退社日当日のシフトは可（退社日以前を在籍中とする）', () => {
    // Arrange
    const person = mkPerson({
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', endOn: '2026-05-01' },
      ],
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
  })

  it('multiReason_年齢制限と在留無効が同時にある場合_両方の理由コードを返す', () => {
    // Arrange: 17歳 + 就労不可在留
    const person = mkPerson({
      birthDate: '2008-05-15',   // 2026-05-01 時点で 17 歳（前日）
      residence: { workAllowed: false, expiresOn: '2027-01-01' },
    })
    const job = mkJob({
      isSecurityWork: true,
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('under_age')
    expect(result.reasons).toContain('residence_invalid')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('determinism_同一入力で2回呼び出すと同一の結果を返す（決定論）', () => {
    // Arrange
    const person = mkPerson()
    const job = mkJob()
    // Act
    const r1 = checkEligibility(person, job, [])
    const r2 = checkEligibility(person, job, [])
    // Assert
    expect(r1).toEqual(r2)
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-027: 警備業務は派遣にできない
// ─────────────────────────────────────────────────────────────
describe('[REQ-027] 警備業務は派遣にできない', () => {
  it('securityDispatch_警備×派遣の案件は公開前チェックで拒否される', () => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: true })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual(['security_dispatch_forbidden'])
  })

  it('securityDispatch_警備×直接雇用は登録可', () => {
    // Arrange
    const job = mkJob({ form: 'security', isSecurityWork: true })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual([])
  })

  it('securityDispatch_非警備×派遣は登録可', () => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: false })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual([])
  })

  it('securityDispatch_eligibility_警備×派遣の案件への応募も拒否される', () => {
    // Arrange
    const person = mkPerson()
    const job = mkJob({ form: 'dispatch', isSecurityWork: true })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_dispatch_forbidden')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-028: 警備の枠への応募資格（教育）
// ─────────────────────────────────────────────────────────────
describe('[REQ-028] 警備の枠への応募資格（教育）', () => {
  it('basicTraining_新任教育未修了の人は警備案件に応募不可', () => {
    // Arrange
    const person = mkPerson({
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },
    })
    const job = mkJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_basic_training_missing')
  })

  it('basicTraining_修了日が未来の場合は不可', () => {
    // Arrange: 今日より後に修了予定
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2026-06-01',  // シフト日(2026-05-01)より未来
        annualFiscalYears: [2026],
      },
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_basic_training_missing')
  })

  it('annualTraining_当年度の現任教育未了なら不可', () => {
    // Arrange: FY2026 の現任教育を受けていない
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2020-06-01',
        annualFiscalYears: [2024, 2025],  // 2026 がない
      },
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],  // FY2026
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_annual_training_missing')
  })

  it('annualTraining_今年度に新任教育を修了した人は現任教育不要', () => {
    // Arrange: FY2026 内（2026-06-01）に新任修了 → 現任教育の対象外
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2026-06-01',  // FY2026 内
        annualFiscalYears: [],       // 現任なし
      },
    })
    const job = mkJob({
      shifts: [{ date: '2026-07-01', start: '09:00', end: '17:00' }],  // FY2026
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).not.toContain('security_annual_training_missing')
    expect(result.reasons).not.toContain('security_basic_training_missing')
  })

  it('annualTraining_年度境界_3月31日はFY2025_FY2025の現任があれば可', () => {
    // Arrange: シフト日が 2026-03-31 → FY2025 の年度内
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2020-06-01',
        annualFiscalYears: [2025],  // FY2025 のみ
      },
    })
    const job = mkJob({
      shifts: [{ date: FY2025_LAST, start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).not.toContain('security_annual_training_missing')
  })

  it('annualTraining_年度境界_4月1日はFY2026_FY2025のみでは不可', () => {
    // Arrange: シフト日が 2026-04-01 → FY2026 開始日
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2020-06-01',
        annualFiscalYears: [2025],  // FY2026 がない
      },
    })
    const job = mkJob({
      shifts: [{ date: FY2026_FIRST, start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_annual_training_missing')
  })

  it('annualTraining_年度をまたぐ複数日シフト_FY2025のみでは4月1日分で不可', () => {
    // Arrange: 3/31 (FY2025) と 4/1 (FY2026) のシフト、FY2025 のみ修了
    const person = mkPerson({
      guardTraining: {
        basicDoneOn: '2020-06-01',
        annualFiscalYears: [2025],
      },
    })
    const job = mkJob({
      shifts: [
        { date: FY2025_LAST,  start: '09:00', end: '17:00' },
        { date: FY2026_FIRST, start: '09:00', end: '17:00' },
      ],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('security_annual_training_missing')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-029: 日雇派遣（30日以内）の例外
// ─────────────────────────────────────────────────────────────
describe('[REQ-029] 日雇派遣（30日以内）の例外', () => {
  it('dailyDispatch_30日の派遣で例外なし_不可', () => {
    // Arrange: 雇用期間ちょうど 30 日、例外区分なし
    const person = mkPerson({
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },  // 警備教育は不要な案件
    })
    const job = mkJob({
      form: 'dispatch',
      isSecurityWork: false,
      employmentDays: 30,
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('daily_dispatch_not_allowed')
  })

  it('dailyDispatch_30日の派遣で例外あり（60歳以上）_可', () => {
    // Arrange
    // v2.10: age60 は本人がシフト日に満60歳以上であることが条件。1960-01-01 生まれ＝2026-05-01 に66歳
    const person = mkPerson({
      birthDate: '1960-01-01',
      dailyDispatchException: { kind: 'age60', verifiedOn: '2026-01-01' },
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },
    })
    const job = mkJob({
      form: 'dispatch',
      isSecurityWork: false,
      employmentDays: 30,
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).not.toContain('daily_dispatch_not_allowed')
  })

  it('dailyDispatch_31日以上の派遣は例外不要', () => {
    // Arrange: 31日 → 通常の派遣として扱う、例外不要
    const person = mkPerson({
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },
    })
    const job = mkJob({
      form: 'dispatch',
      isSecurityWork: false,
      employmentDays: 31,
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.reasons).not.toContain('daily_dispatch_not_allowed')
  })

  it('dailyDispatch_30日ちょうどは例外が必要（31日は不要の境界）', () => {
    // Arrange: 30日は要例外、31日は不要の境界確認
    const personNoException = mkPerson({
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },
    })
    const job30 = mkJob({ form: 'dispatch', isSecurityWork: false, employmentDays: 30 })
    const job31 = mkJob({ form: 'dispatch', isSecurityWork: false, employmentDays: 31 })
    // Act
    const r30 = checkEligibility(personNoException, job30, [])
    const r31 = checkEligibility(personNoException, job31, [])
    // Assert: 30日は不可、31日は日雇派遣規制なし
    expect(r30.reasons).toContain('daily_dispatch_not_allowed')
    expect(r31.reasons).not.toContain('daily_dispatch_not_allowed')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-030: 年齢制限
// ─────────────────────────────────────────────────────────────
describe('[REQ-030] 年齢制限', () => {
  it('age_18歳誕生日前日は17歳_警備案件は不可', () => {
    // Arrange: 誕生日 2008-05-15、シフト日 2026-05-14（前日）
    const person = mkPerson({ birthDate: '2008-05-15' })
    const job = mkJob({
      isSecurityWork: true,
      shifts: [{ date: '2026-05-14', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('under_age')
  })

  it('age_18歳誕生日当日から18歳として扱い_警備案件は可', () => {
    // Arrange: 誕生日 2008-05-15、シフト日 2026-05-15（当日）
    const person = mkPerson({ birthDate: '2008-05-15' })
    const job = mkJob({
      isSecurityWork: true,
      shifts: [{ date: '2026-05-15', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: 誕生日当日から 18 歳として扱う
    expect(result.eligible).toBe(true)
    expect(result.reasons).not.toContain('under_age')
  })

  it('age_夜間勤務を含む案件でも18歳未満は不可', () => {
    // Arrange: 17歳、夜間あり
    const person = mkPerson({ birthDate: '2008-05-15' })
    const job = mkJob({
      isSecurityWork: false,
      nightWork: true,
      shifts: [{ date: '2026-05-14', start: '22:00', end: '06:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('under_age')
  })

  it('age_警備でも夜間でもない案件は年齢で拒否しない（本要件の対象外）', () => {
    // Arrange: 17歳、非警備・非夜間
    const person = mkPerson({ birthDate: '2008-05-15' })
    const job = mkJob({
      isSecurityWork: false,
      nightWork: false,
      form: 'spot',
      guardTraining: undefined,
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    } as Partial<JobPost>)
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.reasons).not.toContain('under_age')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-031: 時間の重なりと労働時間の通算
// ─────────────────────────────────────────────────────────────
describe('[REQ-031] 時間の重なりと労働時間の通算', () => {
  it('overlap_夜勤日またぎ_22:00〜06:00と翌日05:00〜09:00は重なる', () => {
    // Arrange: 既存勤務が 1/10 22:00〜06:00（翌 06:00 まで）、応募が 1/11 05:00〜09:00
    const person = mkPerson()
    const job = mkJob({
      isSecurityWork: false,
      nightWork: false,
      shifts: [{ date: '2026-01-11', start: '05:00', end: '09:00' }],
    })
    const busy: BusyShift[] = [
      { companyId: 'c-999', date: '2026-01-10', start: '22:00', end: '06:00' },
    ]
    // Act
    const result = checkEligibility(person, job, busy)
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('time_overlap')
  })

  it('overlap_夜勤日またぎ_翌日06:00開始は重ならない（境界）', () => {
    // Arrange: 既存勤務が 1/10 22:00〜06:00、応募が 1/11 06:00〜09:00（開始がちょうど終了）
    const person = mkPerson()
    const job = mkJob({
      isSecurityWork: false,
      nightWork: false,
      shifts: [{ date: '2026-01-11', start: '06:00', end: '09:00' }],
    })
    const busy: BusyShift[] = [
      { companyId: 'c-999', date: '2026-01-10', start: '22:00', end: '06:00' },
    ]
    // Act
    const result = checkEligibility(person, job, busy)
    // Assert
    expect(result.reasons).not.toContain('time_overlap')
  })

  it('dailyHours_合計8時間ちょうどは警告なし', () => {
    // Arrange: 既存 4 時間（09:00〜13:00）＋ 応募 4 時間（14:00〜18:00）＝ 8 時間
    const person = mkPerson()
    const job = mkJob({
      isSecurityWork: false,
      nightWork: false,
      shifts: [{ date: '2026-05-01', start: '14:00', end: '18:00' }],
    })
    const busy: BusyShift[] = [
      { companyId: 'c-999', date: '2026-05-01', start: '09:00', end: '13:00' },
    ]
    // Act
    const result = checkEligibility(person, job, busy)
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).not.toContain('daily_hours_over_8')
  })

  it('dailyHours_8時間1分超で警告付き可（eligible=true）', () => {
    // Arrange: 既存 4 時間（09:00〜13:00）＋ 応募 4 時間 1 分（14:00〜18:01）＝ 8h1m
    const person = mkPerson()
    const job = mkJob({
      isSecurityWork: false,
      nightWork: false,
      shifts: [{ date: '2026-05-01', start: '14:00', end: '18:01' }],
    })
    const busy: BusyShift[] = [
      { companyId: 'c-999', date: '2026-05-01', start: '09:00', end: '13:00' },
    ]
    // Act
    const result = checkEligibility(person, job, busy)
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toContain('daily_hours_over_8')
  })

  it('dailyHours_他社の勤務も通算に含める', () => {
    // Arrange: A社 5h + B社 4h = 9h → 警告
    const person = mkPerson()
    const job = mkJob({
      employerCompanyId: 'c-001',
      isSecurityWork: false,
      nightWork: false,
      shifts: [{ date: '2026-05-01', start: '14:00', end: '19:00' }], // 5h
    })
    const busy: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '13:00' }, // 4h
    ]
    // Act
    const result = checkEligibility(person, job, busy)
    // Assert: 合計 9h → 警告
    expect(result.eligible).toBe(true)
    expect(result.warnings).toContain('daily_hours_over_8')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-032: 在留カードの就労可否と期限
// ─────────────────────────────────────────────────────────────
describe('[REQ-032] 在留カードの就労可否と期限', () => {
  it('residence_就労不可の在留資格なら不可', () => {
    // Arrange
    const person = mkPerson({
      residence: { workAllowed: false, expiresOn: '2027-12-31' },
    })
    const job = mkJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('residence_invalid')
  })

  it('residence_在留期限翌日以降のシフトは不可', () => {
    // Arrange: 期限 2026-04-30、シフト日 2026-05-01（翌日）
    const person = mkPerson({
      residence: { workAllowed: true, expiresOn: '2026-04-30' },
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('residence_invalid')
  })

  it('residence_在留期限当日のシフトは可', () => {
    // Arrange: 期限 2026-05-01、シフト日 2026-05-01（当日）
    const person = mkPerson({
      residence: { workAllowed: true, expiresOn: '2026-05-01' },
    })
    const job = mkJob({
      shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: 期限当日は可
    expect(result.reasons).not.toContain('residence_invalid')
  })

  // 基準はシフト日（今日ではない）。シフト日 2026-05-01 から在留期限日までの日数 d を数える。
  // 2026-05-01 + 60 日 = 2026-06-30、+ 61 日 = 2026-07-01
  const residenceShiftJob = () =>
    mkJob({ shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }] })

  it('residence_シフト日から在留期限まで60日ちょうどは警告付きで可', () => {
    // Arrange: 日数 60（シフト日 2026-05-01 → 期限 2026-06-30）
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-06-30' } })
    const job = residenceShiftJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual(['residence_expiring'])
  })

  it('residence_シフト日から在留期限まで61日は警告なしで可', () => {
    // Arrange: 日数 61（シフト日 2026-05-01 → 期限 2026-07-01）
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-07-01' } })
    const job = residenceShiftJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('residence_シフト日が期限当日（日数0）は警告付きで可', () => {
    // Arrange: 日数 0（シフト日 2026-05-01 → 期限 2026-05-01）
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-05-01' } })
    const job = residenceShiftJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual(['residence_expiring'])
  })

  it('residence_シフト日が期限の翌日（日数-1）は拒否され警告は出ない', () => {
    // Arrange: 日数 -1（シフト日 2026-05-01 → 期限 2026-04-30）
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-04-30' } })
    const job = residenceShiftJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['residence_invalid'])
    expect(result.warnings).toEqual([])
  })

  it('residence_在留情報がない人（日本国籍など）には本要件を適用しない', () => {
    // Arrange: residence プロパティなし
    const person = mkPerson({ residence: undefined })
    const job = mkJob()
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: 在留チェックは行わない
    expect(result.reasons).not.toContain('residence_invalid')
    expect(result.warnings).not.toContain('residence_expiring')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-033: 更新手続きの期限一覧（3状態・境界・ソート順）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 更新手続きの期限一覧', () => {
  it('list_空の場合_空配列を返す', () => {
    // Arrange: 全員が期限切れでも 30 日以内でもない
    const person = mkPerson({
      personId: 'p-far',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2028-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([])
  })

  it('list_単数_1件の更新手続きを返す', () => {
    // Arrange: 基準日 2027-03-05（FY2026）。FY2026 の現任教育が未了 → 期限 2027-03-31（26 日後）
    const person = mkPerson({
      personId: 'p-single',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-single', kind: 'annual_training', dueOn: FY2026_END, daysLeft: 26, urgency: 'soon' },
    ])
  })

  it('allRetired_全雇用が退社済みの人は現任教育の更新対象外（仕様確定）', () => {
    // Arrange: 全雇用が退社済み。FY2026 の現任は未了
    const person = mkPerson({
      personId: 'p-retired',
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', endOn: '2026-01-01' },
        { companyId: 'c-002', startOn: '2021-01-01', endOn: '2025-06-01' },
      ],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result.filter(r => r.personId === 'p-retired')).toEqual([])
  })

  it('allRetired_対_在籍中の雇用が1件でもあれば現任教育は更新対象', () => {
    // Arrange: 上と同じ人。ただし 1 件は在籍中（退社日なし）
    const person = mkPerson({
      personId: 'p-one-active',
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', endOn: '2026-01-01' },
        { companyId: 'c-002', startOn: '2021-01-01' },
      ],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-one-active', kind: 'annual_training', dueOn: FY2026_END, daysLeft: 26, urgency: 'soon' },
    ])
  })

  it('noBasic_新任教育未修了の人は現任教育の更新対象外', () => {
    // Arrange: 新任未修了
    const person = mkPerson({
      personId: 'p-nobasic',
      guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result.filter(r => r.personId === 'p-nobasic')).toEqual([])
  })

  it('noBasic_対_新任修了済みで現任未了なら現任教育は更新対象', () => {
    // Arrange: 上と同じ。新任を過去年度（FY2025）に修了済み・現任なし
    const person = mkPerson({
      personId: 'p-hasbasic',
      guardTraining: { basicDoneOn: '2025-05-01', annualFiscalYears: [] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-hasbasic', kind: 'annual_training', dueOn: FY2026_END, daysLeft: 26, urgency: 'soon' },
    ])
  })

  it('newlyBasic_今年度に新任修了した人は現任教育の更新対象外', () => {
    // Arrange: FY2026 内（2026-05-01）に新任修了、現任なし
    const person = mkPerson({
      personId: 'p-newbasic',
      guardTraining: { basicDoneOn: '2026-05-01', annualFiscalYears: [] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result.filter(r => r.personId === 'p-newbasic')).toEqual([])
  })

  it('newlyBasic_対_年度末前日(2026-03-31)に新任修了した人はFY2026では現任教育が更新対象', () => {
    // Arrange: FY2025 の最終日に新任修了（FY2026 から見れば前年度）
    const person = mkPerson({
      personId: 'p-lastyear',
      guardTraining: { basicDoneOn: '2026-03-31', annualFiscalYears: [] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-lastyear', kind: 'annual_training', dueOn: FY2026_END, daysLeft: 26, urgency: 'soon' },
    ])
  })

  it('contractEnd_退社済みの雇用の契約満了は対象外', () => {
    // Arrange: 退社済み（endOn あり）の雇用に contractEndOn が 15 日後
    const person = mkPerson({
      personId: 'p-ex',
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', endOn: '2027-02-01', contractEndOn: '2027-03-20' },
      ],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result.filter(r => r.personId === 'p-ex')).toEqual([])
  })

  it('contractEnd_対_在籍中の雇用の契約満了は30日以内なら含む', () => {
    // Arrange: 上と同じ。endOn なし（在籍中）、満了は 15 日後
    const person = mkPerson({
      personId: 'p-active-contract',
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-20' },
      ],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-active-contract', kind: 'contract', dueOn: '2027-03-20', daysLeft: 15, urgency: 'soon' },
    ])
  })

  it('sort_期限切れが先頭_次いで期限が近い順', () => {
    // Arrange: 基準日 2027-01-01。契約満了が 12 日前 / 5 日後 / 15 日後。入力順はわざと崩す
    const today = '2027-01-01'
    const mk = (id: string, contractEndOn: string) =>
      mkPerson({
        personId: id,
        employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn }],
        guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
      })
    const past = mk('p-expired', '2026-12-20')
    const nearFar = mk('p-near15', '2027-01-16')
    const nearClose = mk('p-near5', '2027-01-06')
    // Act
    const result = listRenewals([nearFar, nearClose, past], today)
    // Assert: 期限切れ → 5 日後 → 15 日後
    expect(result.map(r => r.personId)).toEqual(['p-expired', 'p-near5', 'p-near15'])
    expect(result.map(r => r.urgency)).toEqual(['expired', 'soon', 'soon'])
    expect(result.map(r => r.kind)).toEqual(['contract', 'contract', 'contract'])
    expect(result.map(r => r.dueOn)).toEqual(['2026-12-20', '2027-01-06', '2027-01-16'])
    expect(result[0].daysLeft).toBeLessThan(0)
    expect(result[1].daysLeft).toBe(5)
    expect(result[2].daysLeft).toBe(15)
  })

  it('filter_期限まで31日の契約満了は一覧に含まない', () => {
    // Arrange: 基準日 2027-01-01、満了 2027-02-01（31 日後）
    const person = mkPerson({
      personId: 'p-far31',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-02-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = listRenewals([person], '2027-01-01')
    // Assert
    expect(result.filter(r => r.personId === 'p-far31')).toEqual([])
  })

  it('filter_対_期限まで30日ちょうどの契約満了は一覧に含む', () => {
    // Arrange: 基準日 2027-01-01、満了 2027-01-31（30 日後）
    const person = mkPerson({
      personId: 'p-edge30',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-01-31' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = listRenewals([person], '2027-01-01')
    // Assert
    expect(result).toEqual([
      { personId: 'p-edge30', kind: 'contract', dueOn: '2027-01-31', daysLeft: 30, urgency: 'soon' },
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-035: 同意なし（no_consent）の応募不可
// ─────────────────────────────────────────────────────────────
describe('[REQ-035] 同意なしの人はどの案件にも応募不可（理由コード no_consent）', () => {
  it('noConsent_同意なしの人は他社の案件に応募できない（仕様確定3点の1つ）', () => {
    // Arrange: consentJointUse = false、雇用主とは別会社の案件
    const person = mkPerson({
      consentJointUse: false,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
    })
    const job = mkJob({
      employerCompanyId: 'c-other',  // 別会社
      isSecurityWork: false,
      form: 'spot',
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: 同意なし → no_consent ← 仕様確定。落ちるべきテスト
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('no_consent')
  })

  it('noConsent_同意なしは自社の案件でも no_consent で不可（v2.6: どの案件にも応募不可）', () => {
    // Arrange: consentJointUse = false、自社（在籍会社）の案件
    const person = mkPerson({
      consentJointUse: false,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
    })
    const job = mkJob({
      employerCompanyId: 'c-001',
      isSecurityWork: false,
      form: 'spot',
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert: 他の理由は無く、no_consent だけで拒否される
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['no_consent'])
  })

  it('noConsent_対_同意ありなら同じ自社の案件は応募可', () => {
    // Arrange: 上と同じ入力で consentJointUse だけ true
    const person = mkPerson({
      consentJointUse: true,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
    })
    const job = mkJob({
      employerCompanyId: 'c-001',
      isSecurityWork: false,
      form: 'spot',
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-034: 運営枠と警備枠の線引き確認
// ─────────────────────────────────────────────────────────────
describe('[REQ-034] 運営枠と警備枠の線引き確認', () => {
  it('boundaryCheck_確認が必要で記録がない案件は公開拒否', () => {
    // Arrange
    const job = mkJob({
      needsBoundaryCheck: true,
      boundaryCheck: undefined,
    })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual(['boundary_not_confirmed'])
  })

  it('boundaryCheck_確認が必要で記録がある案件は公開可', () => {
    // Arrange
    const job = mkJob({
      needsBoundaryCheck: true,
      boundaryCheck: { confirmedBy: '現場責任者:田中', confirmedOn: '2026-04-10' },
    })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual([])
  })

  it('boundaryCheck_確認不要な案件は記録なしでも公開可', () => {
    // Arrange
    const job = mkJob({ needsBoundaryCheck: false, boundaryCheck: undefined })
    // Act
    const result = validateJobForPublish(job)
    // Assert
    expect(result).toEqual([])
  })

  it('boundaryCheck_警備×派遣かつ線引き記録なしは両方の理由コードで拒否される', () => {
    // Arrange
    const job = mkJob({
      form: 'dispatch',
      isSecurityWork: true,
      needsBoundaryCheck: true,
      boundaryCheck: undefined,
    })
    // Act
    const result = validateJobForPublish(job)
    // Assert: 理由は順不同でちょうど 2 件
    expect([...result].sort()).toEqual(['boundary_not_confirmed', 'security_dispatch_forbidden'])
  })

  it('boundaryCheck_eligibility_記録なしの案件への応募も拒否される', () => {
    // Arrange
    const person = mkPerson()
    const job = mkJob({
      needsBoundaryCheck: true,
      boundaryCheck: undefined,
    })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('boundary_not_confirmed')
  })
})

// ─────────────────────────────────────────────────────────────
// NFR-05: 1,000 人分の listRenewals が 1 秒以内
// ─────────────────────────────────────────────────────────────
describe('[NFR-05] 更新手続き一覧の性能', () => {
  /** 1,000 人分の PersonProfile を生成する（性能テストと結果検証を分離） */
  function mk1000Persons(): PersonProfile[] {
    const today = RENEWAL_DATE_FY2026  // 2027-03-05
    return Array.from({ length: 1000 }, (_, i) => {
      const pid = `p-perf-${i.toString().padStart(4, '0')}`
      // i % 4 で 4 種類のパターンを混在させる
      if (i % 4 === 0) {
        // 現任教育期限が 20 日以内（ヒット）
        return mkPerson({
          personId: pid,
          employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
          guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] }, // 2026 なし
        })
      } else if (i % 4 === 1) {
        // 契約満了が 10 日後（ヒット）
        return mkPerson({
          personId: pid,
          employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-15' }],
          guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
        })
      } else if (i % 4 === 2) {
        // 全雇用退社済み（現任教育の対象外）
        return mkPerson({
          personId: pid,
          employments: [{ companyId: 'c-001', startOn: '2020-01-01', endOn: '2026-12-01' }],
          guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
        })
      } else {
        // 期限が十分先（31 日以上）→ ヒットしない
        return mkPerson({
          personId: pid,
          employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2028-01-01' }],
          guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
        })
      }
    })
  }

  it('performance_1000人分_結果が期待件数ちょうど（契約満了250＋現任教育250＝500件）で並び順も正しい', () => {
    // Arrange
    const persons = mk1000Persons()
    const id = (i: number) => `p-perf-${i.toString().padStart(4, '0')}`
    const idx = Array.from({ length: 1000 }, (_, i) => i)
    // 期待: 契約満了(2027-03-15, 残10日)が先、現任教育(2027-03-31, 残26日)が後。それぞれ personId 昇順
    const expected = [
      ...idx.filter(i => i % 4 === 1).map(i => [id(i), 'contract', 10]),
      ...idx.filter(i => i % 4 === 0).map(i => [id(i), 'annual_training', 26]),
    ]
    // Act
    const result = listRenewals(persons, RENEWAL_DATE_FY2026)
    // Assert
    expect(result.length).toBe(500)
    expect(result.map(r => [r.personId, r.kind, r.daysLeft])).toEqual(expected)
    expect(result.every(r => r.urgency === 'soon')).toBe(true)
  })

  it('performance_1000人分の_listRenewals_が_1秒以内に完了する', () => {
    // Arrange
    const persons = mk1000Persons()
    // Act: performance.now() はブラウザ/Node のモノトニック時計（Date に依存しない）
    const start = performance.now()
    listRenewals(persons, RENEWAL_DATE_FY2026)
    const elapsed = performance.now() - start
    // Assert
    expect(elapsed).toBeLessThan(1000)
  })
})

// ═════════════════════════════════════════════════════════════
// 再生成 第2回（仕様 v2.10 / Adversary FIND-004/005/006/007/009）
// ═════════════════════════════════════════════════════════════

/** v2.10 の戻り値（details を含む）。model.ts が未更新でもテストは仕様の形で読む */
type ResultWithDetails = EligibilityResult & {
  details: { residenceDaysLeft?: number; maxDailyHours?: number }
}
const detailed = (r: EligibilityResult) => r as ResultWithDetails

const NO_TRAINING = { basicDoneOn: undefined, annualFiscalYears: [] as number[] }

// ─────────────────────────────────────────────────────────────
// REQ-026 / REQ-037: シフトが 1 件もない案件（no_shifts）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026] 空のシフト（no_shifts）', () => {
  it('noShifts_在籍済みの人でもシフトが空なら no_shifts で不可', () => {
    // Arrange: 条件を全て満たす人 × シフト 0 件の案件
    const person = mkPerson()
    const job = mkJob({ shifts: [] })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('no_shifts')
  })

  it('noShifts_在籍していない人でもシフトが空なら no_shifts で不可', () => {
    // Arrange: 雇用が 1 件もない人 × シフト 0 件（全シフト日の確認が空振りして通ってしまわないこと）
    const person = mkPerson({ employments: [] })
    const job = mkJob({ shifts: [] })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('no_shifts')
  })

  it('noShifts_対_シフトが 1 件あれば no_shifts は出ず応募できる', () => {
    // Arrange
    const person = mkPerson()
    const job = mkJob({ shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }] })
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.reasons).toEqual([])
    expect(result.eligible).toBe(true)
  })

  it('noShifts_公開前チェックはシフトが空なら no_shifts だけを返す', () => {
    // Arrange: 他に問題のない案件
    const job = mkJob({ shifts: [] })
    // Act
    const reasons = validateJobForPublish(job)
    // Assert
    expect(reasons).toEqual(['no_shifts'])
  })

  it('noShifts_対_公開前チェックはシフトが 1 件あれば空配列', () => {
    // Arrange
    const job = mkJob({ shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }] })
    // Act / Assert
    expect(validateJobForPublish(job)).toEqual([])
  })

  it('noShifts_公開前チェック_他の拒否理由と並ぶ（警備×派遣×空シフト）', () => {
    // Arrange
    const job = mkJob({ form: 'dispatch', shifts: [] })
    // Act
    const reasons = validateJobForPublish(job)
    // Assert: 集合として比較（並び順は規定しない）
    expect([...reasons].sort()).toEqual(['no_shifts', 'security_dispatch_forbidden'])
  })

  it('noShifts_応募できる案件の一覧からシフトが空の案件は除かれる', () => {
    // Arrange
    const person = mkPerson()
    const ok = mkJob({ jobId: 'j-ok' })
    const empty = mkJob({ jobId: 'j-empty', shifts: [] })
    // Act
    const result = listApplicableJobs(person, [empty, ok], [])
    // Assert
    expect(result.map(j => j.jobId)).toEqual(['j-ok'])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-033: 在籍中の定義（入社日 ≤ 基準日 かつ（退社日なし or 退社日 ≥ 基準日））
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 在籍中の判定（基準日）', () => {
  const REF = '2026-11-07'
  const emp = (o: Partial<PersonProfile['employments'][number]>) => ({
    companyId: 'c-001', startOn: '2020-01-01', ...o,
  })
  /** 現任教育は FY2026 まで満たし済み。契約満了だけが結果を左右する */
  const contractPerson = (id: string, employments: PersonProfile['employments']) =>
    mkPerson({ personId: id, employments, guardTraining: { basicDoneOn: '2020-06-01', annualFiscalYears: [2025, 2026] } })

  it('inService_退社予定日が基準日より後なら契約満了が出る', () => {
    // Arrange: 退社予定 2026-12-31（基準日より後）、契約満了 2026-11-20
    const p = contractPerson('p-a', [emp({ endOn: '2026-12-31', contractEndOn: '2026-11-20' })])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-a', kind: 'contract', dueOn: '2026-11-20', daysLeft: 13, urgency: 'soon' },
    ])
  })

  it('inService_退社日が基準日当日なら在籍中で契約満了が出る', () => {
    // Arrange: 退社日 = 基準日（退社日 ≥ 基準日 は在籍中）
    const p = contractPerson('p-a', [emp({ endOn: REF, contractEndOn: '2026-11-20' })])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result.map(i => [i.personId, i.kind, i.dueOn])).toEqual([['p-a', 'contract', '2026-11-20']])
  })

  it('inService_退社日が基準日より前なら契約満了は出ない', () => {
    // Arrange: 退社日 2026-11-06（基準日の前日）
    const p = contractPerson('p-a', [emp({ endOn: '2026-11-06', contractEndOn: '2026-11-20' })])
    // Act / Assert
    expect(listRenewals([p], REF)).toEqual([])
  })

  it('inService_入社日が基準日より未来の雇用は契約満了が出ない', () => {
    // Arrange: 入社日 2026-11-08（基準日の翌日）
    const p = contractPerson('p-a', [emp({ startOn: '2026-11-08', contractEndOn: '2026-11-20' })])
    // Act / Assert
    expect(listRenewals([p], REF)).toEqual([])
  })

  it('inService_対_入社日が基準日当日なら在籍中で契約満了が出る', () => {
    // Arrange
    const p = contractPerson('p-a', [emp({ startOn: REF, contractEndOn: '2026-11-20' })])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result.map(i => [i.personId, i.kind, i.daysLeft])).toEqual([['p-a', 'contract', 13]])
  })

  it('inService_複数雇用_在籍中の雇用の契約満了だけが出る', () => {
    // Arrange: 退社済みの雇用（満了 11-10）と在籍中の雇用（満了 11-20）
    const p = contractPerson('p-a', [
      emp({ companyId: 'c-old', endOn: '2026-09-30', contractEndOn: '2026-11-10' }),
      emp({ companyId: 'c-001', contractEndOn: '2026-11-20' }),
    ])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result.map(i => [i.kind, i.dueOn])).toEqual([['contract', '2026-11-20']])
  })

  // 現任教育: 基準日 2027-03-05（FY2026、期限 2027-03-31 まで 26 日）。FY2026 の現任は未了
  const ANNUAL_REF = '2027-03-05'
  const annualPerson = (id: string, employments: PersonProfile['employments']) =>
    mkPerson({ personId: id, employments, guardTraining: { basicDoneOn: '2020-06-01', annualFiscalYears: [2025] } })
  const annualItem = (id: string) =>
    ({ personId: id, kind: 'annual_training', dueOn: '2027-03-31', daysLeft: 26, urgency: 'soon' })

  it('inService_現任教育_退社日が基準日当日の雇用は在籍中なので対象', () => {
    // Arrange
    const p = annualPerson('p-a', [emp({ endOn: ANNUAL_REF })])
    // Act / Assert
    expect(listRenewals([p], ANNUAL_REF)).toEqual([annualItem('p-a')])
  })

  it('inService_現任教育_退社日が基準日の前日なら在籍中の雇用がなく対象外', () => {
    // Arrange
    const p = annualPerson('p-a', [emp({ endOn: '2027-03-04' })])
    // Act / Assert
    expect(listRenewals([p], ANNUAL_REF)).toEqual([])
  })

  it('inService_現任教育_入社日が基準日より未来の雇用しかない人は対象外', () => {
    // Arrange: 入社日 2027-03-06（基準日の翌日）
    const p = annualPerson('p-a', [emp({ startOn: '2027-03-06' })])
    // Act / Assert
    expect(listRenewals([p], ANNUAL_REF)).toEqual([])
  })

  it('inService_現任教育_対_入社日が基準日当日なら在籍中で対象', () => {
    // Arrange
    const p = annualPerson('p-a', [emp({ startOn: ANNUAL_REF })])
    // Act / Assert
    expect(listRenewals([p], ANNUAL_REF)).toEqual([annualItem('p-a')])
  })

  it('inService_現任教育_対_退社済みと未来入社に加えて在籍中が 1 件あれば対象（1 人 1 件）', () => {
    // Arrange
    const p = annualPerson('p-a', [
      emp({ companyId: 'c-old', endOn: '2026-12-01' }),
      emp({ companyId: 'c-new', startOn: '2027-04-01' }),
      emp({ companyId: 'c-001' }),
    ])
    // Act / Assert
    expect(listRenewals([p], ANNUAL_REF)).toEqual([annualItem('p-a')])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-032: details.residenceDaysLeft（全シフト日の最小日数）
// ─────────────────────────────────────────────────────────────
describe('[REQ-032] details.residenceDaysLeft', () => {
  // 期限 2026-07-20。シフト 2026-06-30 は 20 日前、2026-05-31 は 50 日前、2026-05-01 は 80 日前
  const person = () => mkPerson({ residence: { workAllowed: true, expiresOn: '2026-07-20' } })
  const shift = (date: string) => ({ date, start: '09:00', end: '17:00' })

  it('residenceDaysLeft_20日後と50日後のシフトでは最小の 20', () => {
    // Arrange: 50 日後のシフトを先に置く（先頭の値を拾う実装を落とす）
    const job = mkJob({ shifts: [shift('2026-05-31'), shift('2026-06-30')] })
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual(['residence_expiring'])
    expect(result.details.residenceDaysLeft).toBe(20)
  })

  it('residenceDaysLeft_並びを逆にしても最小の 20（末尾の値を拾う実装を落とす）', () => {
    // Arrange
    const job = mkJob({ shifts: [shift('2026-06-30'), shift('2026-05-31')] })
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.details.residenceDaysLeft).toBe(20)
  })

  it('residenceDaysLeft_60日超のシフト日が混じっても警告対象の最小日数 20 を返す', () => {
    // Arrange: 80 日後と 20 日後
    const job = mkJob({ shifts: [shift('2026-05-01'), shift('2026-06-30')] })
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.warnings).toEqual(['residence_expiring'])
    expect(result.details.residenceDaysLeft).toBe(20)
  })

  it('residenceDaysLeft_単一シフトで期限当日なら 0', () => {
    // Arrange
    const job = mkJob({ shifts: [shift('2026-07-20')] })
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.details.residenceDaysLeft).toBe(0)
  })

  it('residenceDaysLeft_警告がないとき（61日）はキーが無い', () => {
    // Arrange: 2026-05-20 → 2026-07-20 は 61 日
    const job = mkJob({ shifts: [shift('2026-05-20')] })
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.warnings).toEqual([])
    expect(result.details.residenceDaysLeft).toBeUndefined()
    expect(Object.keys(result.details)).not.toContain('residenceDaysLeft')
  })

  it('residenceDaysLeft_在留情報がない人はキーが無い', () => {
    // Arrange
    const result = detailed(checkEligibility(mkPerson({ residence: undefined }), mkJob(), []))
    // Act / Assert
    expect(Object.keys(result.details)).not.toContain('residenceDaysLeft')
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-031: details.maxDailyHours（他社分を含む 1 日の最大労働時間）
// ─────────────────────────────────────────────────────────────
describe('[REQ-031] details.maxDailyHours', () => {
  const nonSecurity = (shifts: JobPost['shifts']) => mkJob({ isSecurityWork: false, nightWork: false, shifts })

  it('maxDailyHours_他社3時間と自社6時間なら 9', () => {
    // Arrange: 他社 09:00-12:00(3h) + 自社 14:00-20:00(6h)
    const job = nonSecurity([{ date: '2026-05-01', start: '14:00', end: '20:00' }])
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '12:00' }]
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, busy))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual(['daily_hours_over_8'])
    expect(result.details.maxDailyHours).toBe(9)
  })

  it('maxDailyHours_複数日では最大の日の値（9 と 7 なら 9、7 と 10 なら 10）', () => {
    // Arrange: 1 日目 3h+6h=9h、2 日目 1h+6h=7h
    const jobA = nonSecurity([
      { date: '2026-05-01', start: '14:00', end: '20:00' },
      { date: '2026-05-02', start: '14:00', end: '20:00' },
    ])
    const busyA: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '12:00' },
      { companyId: 'c-other', date: '2026-05-02', start: '09:00', end: '10:00' },
    ]
    // 1 日目 1h+6h=7h、2 日目 4h+6h=10h
    const busyB: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '10:00' },
      { companyId: 'c-other', date: '2026-05-02', start: '08:00', end: '12:00' },
    ]
    // Act
    const a = detailed(checkEligibility(mkPerson(), jobA, busyA))
    const b = detailed(checkEligibility(mkPerson(), jobA, busyB))
    // Assert
    expect(a.details.maxDailyHours).toBe(9)
    expect(b.details.maxDailyHours).toBe(10)
  })

  it('maxDailyHours_別の日の勤務は通算しない（自社6時間の日に別日の他社4時間があっても警告なし）', () => {
    // Arrange: 他社は前日の 4 時間
    const job = nonSecurity([{ date: '2026-05-02', start: '14:00', end: '20:00' }])
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '13:00' }]
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, busy))
    // Assert
    expect(result.warnings).toEqual([])
    expect(result.details.maxDailyHours).toBeUndefined()
  })

  it('maxDailyHours_ちょうど8時間なら警告なしでキーが無い', () => {
    // Arrange: 他社 4h + 自社 4h
    const job = nonSecurity([{ date: '2026-05-01', start: '14:00', end: '18:00' }])
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '13:00' }]
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, busy))
    // Assert
    expect(result.warnings).toEqual([])
    expect(Object.keys(result.details)).not.toContain('maxDailyHours')
  })

  it('maxDailyHours_既存勤務がなく警告もないときキーが無い', () => {
    // Arrange / Act
    const result = detailed(checkEligibility(mkPerson(), mkJob(), []))
    // Assert: 8 時間ちょうどの勤務 1 件
    expect(result.warnings).toEqual([])
    expect(Object.keys(result.details)).not.toContain('maxDailyHours')
  })

  it('maxDailyHours_在留の警告だけのときは maxDailyHours が無く、時間警告だけのときは residenceDaysLeft が無い', () => {
    // Arrange
    const resPerson = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-05-31' } })
    const hoursJob = nonSecurity([{ date: '2026-05-01', start: '14:00', end: '20:00' }])
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '12:00' }]
    // Act
    const onlyResidence = detailed(checkEligibility(resPerson, mkJob(), []))
    const onlyHours = detailed(checkEligibility(mkPerson(), hoursJob, busy))
    // Assert
    expect(onlyResidence.warnings).toEqual(['residence_expiring'])
    expect(onlyResidence.details).toEqual({ residenceDaysLeft: 30 })
    expect(onlyHours.warnings).toEqual(['daily_hours_over_8'])
    expect(onlyHours.details).toEqual({ maxDailyHours: 9 })
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-029: 日雇派遣の例外の検証（dispatch_exception_invalid）
// ─────────────────────────────────────────────────────────────
describe('[REQ-029] 日雇派遣の例外の検証', () => {
  const SHIFT_DAY = '2026-05-01'
  const dispatchJob = (days = 30) =>
    mkJob({
      form: 'dispatch', isSecurityWork: false, employmentDays: days,
      shifts: [{ date: SHIFT_DAY, start: '09:00', end: '17:00' }],
    })
  const withException = (
    kind: 'age60' | 'day_student' | 'side_job' | 'household_income',
    verifiedOn: string,
    birthDate = '1990-01-01',
  ) => mkPerson({ birthDate, guardTraining: NO_TRAINING, dailyDispatchException: { kind, verifiedOn } })

  it.each([
    ['空文字', ''],
    ['スラッシュ区切り', '2026/01/01'],
    ['区切りなし', '20260101'],
    ['日付でない文字列', 'not-a-date'],
    ['ゼロ埋めなし', '2026-1-1'],
  ])('exceptionInvalid_verifiedOn が%sなら dispatch_exception_invalid で不可', (_label, verifiedOn) => {
    // Arrange
    const person = withException('day_student', verifiedOn)
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('dispatch_exception_invalid')
  })

  it('exceptionInvalid_verifiedOn がシフト日より後なら不可', () => {
    // Arrange: 確認日 2026-05-02 > シフト日 2026-05-01
    const person = withException('day_student', '2026-05-02')
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('dispatch_exception_invalid')
  })

  it('exceptionInvalid_対_verifiedOn がシフト日当日なら例外が認められ可', () => {
    // Arrange
    const person = withException('day_student', SHIFT_DAY)
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('exceptionInvalid_対_verifiedOn がシフト日より前の day_student は可', () => {
    // Arrange
    const person = withException('day_student', '2026-04-30')
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('exceptionInvalid_age60 で本人がシフト日に59歳なら不可（60歳の誕生日の前日）', () => {
    // Arrange: 1966-05-02 生まれ → 2026-05-01 は 59 歳（翌日に 60 歳）
    const person = withException('age60', '2026-01-01', '1966-05-02')
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('dispatch_exception_invalid')
  })

  it('exceptionInvalid_対_age60 で60歳の誕生日当日なら可', () => {
    // Arrange: 1966-05-01 生まれ → 2026-05-01 に満 60 歳
    const person = withException('age60', '2026-01-01', '1966-05-01')
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('exceptionInvalid_対_day_student は59歳でも年齢条件を受けず可（年齢条件は age60 だけ）', () => {
    // Arrange: 1966-05-02 生まれ（59 歳）
    const person = withException('day_student', '2026-01-01', '1966-05-02')
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('exceptionInvalid_例外を持たない人は dispatch_exception_invalid ではなく daily_dispatch_not_allowed', () => {
    // Arrange
    const person = mkPerson({ guardTraining: NO_TRAINING })
    // Act
    const result = checkEligibility(person, dispatchJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['daily_dispatch_not_allowed'])
  })

  it('exceptionInvalid_31日以上の派遣は例外なしでも可（例外不要のまま）', () => {
    // Arrange
    const person = mkPerson({ guardTraining: NO_TRAINING })
    // Act
    const result = checkEligibility(person, dispatchJob(31), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-033: 在留期限の更新手続き・期限切れの daysLeft・並び順
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 在留期限の更新手続きと並び順', () => {
  const REF = '2026-11-07'
  const resPerson = (id: string, expiresOn: string | undefined, workAllowed = true) =>
    mkPerson({ personId: id, residence: { workAllowed, expiresOn } })
  const item = (personId: string, kind: string, dueOn: string, daysLeft: number, urgency: string) =>
    ({ personId, kind, dueOn, daysLeft, urgency })

  it('residence_期限が基準日の前日なら expired で daysLeft は -1', () => {
    // Arrange / Act
    const result = listRenewals([resPerson('p-a', '2026-11-06')], REF)
    // Assert
    expect(result).toEqual([item('p-a', 'residence', '2026-11-06', -1, 'expired')])
  })

  it('residence_期限が37日前なら daysLeft は -37（期限切れの日数は負の値）', () => {
    // Arrange / Act: 2026-10-01 → 2026-11-07 は 37 日
    const result = listRenewals([resPerson('p-a', '2026-10-01')], REF)
    // Assert
    expect(result).toEqual([item('p-a', 'residence', '2026-10-01', -37, 'expired')])
  })

  it('residence_期限が基準日当日なら soon で daysLeft は 0', () => {
    // Arrange / Act
    const result = listRenewals([resPerson('p-a', REF)], REF)
    // Assert
    expect(result).toEqual([item('p-a', 'residence', REF, 0, 'soon')])
  })

  it('residence_期限まで30日ちょうどは含まれ soon', () => {
    // Arrange / Act
    const result = listRenewals([resPerson('p-a', '2026-12-07')], REF)
    // Assert
    expect(result).toEqual([item('p-a', 'residence', '2026-12-07', 30, 'soon')])
  })

  it('residence_期限まで31日は含まれない', () => {
    // Arrange / Act
    const result = listRenewals([resPerson('p-a', '2026-12-08')], REF)
    // Assert
    expect(result).toEqual([])
  })

  it('residence_在留情報がない人・期限日がない人は対象外', () => {
    // Arrange
    const none = mkPerson({ personId: 'p-none', residence: undefined })
    const noDate = resPerson('p-nodate', undefined)
    // Act / Assert
    expect(listRenewals([none, noDate], REF)).toEqual([])
  })

  it('contractExpired_契約満了が基準日の前日なら expired で daysLeft は -1', () => {
    // Arrange
    const p = mkPerson({
      personId: 'p-a',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2026-11-06' }],
    })
    // Act / Assert
    expect(listRenewals([p], REF)).toEqual([item('p-a', 'contract', '2026-11-06', -1, 'expired')])
  })

  it('sort_同日・同 daysLeft は personId の昇順（入力が逆順でも）', () => {
    // Arrange: 契約満了が全員 2026-11-20。入力は p-c, p-a, p-b の順
    const mk = (id: string) => mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2026-11-20' }],
    })
    // Act
    const result = listRenewals([mk('p-c'), mk('p-a'), mk('p-b')], REF)
    // Assert
    expect(result.map(i => i.personId)).toEqual(['p-a', 'p-b', 'p-c'])
    expect(result.every(i => i.daysLeft === 13 && i.urgency === 'soon')).toBe(true)
  })

  it('sort_期限切れの同日も personId 昇順', () => {
    // Arrange: 在留期限が全員 2026-11-01（6 日前）
    const result = listRenewals(
      [resPerson('p-b', '2026-11-01'), resPerson('p-a', '2026-11-01')],
      REF,
    )
    // Assert
    expect(result.map(i => [i.personId, i.daysLeft, i.urgency])).toEqual([
      ['p-a', -6, 'expired'], ['p-b', -6, 'expired'],
    ])
  })

  it('sort_期限切れ→近い順→同日は personId 昇順（種別が混在しても全体で並べる）', () => {
    // Arrange: 入力順はわざと崩す
    const contract = (id: string, contractEndOn: string) => mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn }],
    })
    const people = [
      contract('p-d', '2026-12-07'),         // +30 contract
      resPerson('p-a', REF),                 // 0 residence
      contract('p-c', REF),                  // 0 contract
      resPerson('p-b', '2026-11-06'),        // -1 residence
      contract('p-z', '2026-10-31'),         // -7 contract
    ]
    // Act
    const result = listRenewals(people, REF)
    // Assert
    expect(result).toEqual([
      item('p-z', 'contract', '2026-10-31', -7, 'expired'),
      item('p-b', 'residence', '2026-11-06', -1, 'expired'),
      item('p-a', 'residence', REF, 0, 'soon'),
      item('p-c', 'contract', REF, 0, 'soon'),
      item('p-d', 'contract', '2026-12-07', 30, 'soon'),
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// 契約: listApplicableJobs（入力順を維持・応募できない案件を除く）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026] listApplicableJobs', () => {
  const okJob = (id: string) => mkJob({ jobId: id })
  /** 自社(c-001)の人に対し、別会社のスポット案件は not_registered で不可 */
  const ngJob = (id: string) => mkJob({ jobId: id, employerCompanyId: 'c-other', form: 'spot', isSecurityWork: false })

  it('listApplicable_空の案件リストなら空配列', () => {
    expect(listApplicableJobs(mkPerson(), [], [])).toEqual([])
  })

  it('listApplicable_全て応募できるなら全件を入力順のまま返す（ソートしない）', () => {
    // Arrange
    const jobs = [okJob('j-3'), okJob('j-1'), okJob('j-2')]
    // Act
    const result = listApplicableJobs(mkPerson(), jobs, [])
    // Assert
    expect(result.map(j => j.jobId)).toEqual(['j-3', 'j-1', 'j-2'])
    expect(result).toEqual(jobs)
  })

  it('listApplicable_全て応募できないなら空配列', () => {
    expect(listApplicableJobs(mkPerson(), [ngJob('j-1'), ngJob('j-2')], [])).toEqual([])
  })

  it('listApplicable_応募できない案件だけを除き残りの順序を保つ', () => {
    // Arrange
    const jobs = [okJob('j-4'), ngJob('j-3'), okJob('j-2'), ngJob('j-1'), okJob('j-0')]
    // Act
    const result = listApplicableJobs(mkPerson(), jobs, [])
    // Assert
    expect(result.map(j => j.jobId)).toEqual(['j-4', 'j-2', 'j-0'])
  })

  it('listApplicable_既存勤務(busy)と時間が重なる案件は除かれる', () => {
    // Arrange: j-busy は 12:00-18:00 の既存勤務と重なる、j-free は重ならない
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-05-01', start: '12:00', end: '18:00' }]
    const free = mkJob({ jobId: 'j-free', shifts: [{ date: '2026-05-02', start: '09:00', end: '17:00' }] })
    const overlap = mkJob({ jobId: 'j-busy', shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }] })
    // Act
    const result = listApplicableJobs(mkPerson(), [overlap, free], busy)
    // Assert
    expect(result.map(j => j.jobId)).toEqual(['j-free'])
  })

  it('listApplicable_同意なしの人はどの案件も応募できず空配列', () => {
    expect(listApplicableJobs(mkPerson({ consentJointUse: false }), [okJob('j-1'), okJob('j-2')], [])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 旧 t1_talent.test.ts 固有ケースの移行
// ─────────────────────────────────────────────────────────────
describe('[REQ-030] ageOn（満年齢）', () => {
  it('ageOn_誕生日の前日は17歳・当日から18歳', () => {
    expect(ageOn('2008-11-15', '2026-11-14')).toBe(17)
    expect(ageOn('2008-11-14', '2026-11-14')).toBe(18)
  })

  it('ageOn_誕生日の翌日以降も満年齢を保つ', () => {
    expect(ageOn('2008-11-14', '2026-11-15')).toBe(18)
    expect(ageOn('2008-11-14', '2027-11-13')).toBe(18)
    expect(ageOn('2008-11-14', '2027-11-14')).toBe(19)
  })
})

describe('[REQ-028] fiscalYearOf（4月始まりの年度）', () => {
  it('fiscalYearOf_3月31日は前年度・4月1日は当年度', () => {
    expect(fiscalYearOf('2027-03-31')).toBe(2026)
    expect(fiscalYearOf('2026-04-01')).toBe(2026)
  })

  it('fiscalYearOf_年内の1月と12月', () => {
    expect(fiscalYearOf('2026-01-01')).toBe(2025)
    expect(fiscalYearOf('2026-12-31')).toBe(2026)
  })
})

describe('[REQ-031] shiftsOverlap（時間の重なり）', () => {
  const night = { date: '2026-11-14', start: '22:00', end: '06:00' }

  it('shiftsOverlap_夜勤の日またぎは翌朝 05:00 開始と重なる', () => {
    expect(shiftsOverlap(night, { date: '2026-11-15', start: '05:00', end: '09:00' })).toBe(true)
  })

  it('shiftsOverlap_夜勤の終了 06:00 ちょうど開始は重ならない', () => {
    expect(shiftsOverlap(night, { date: '2026-11-15', start: '06:00', end: '09:00' })).toBe(false)
  })

  it('shiftsOverlap_引数の順序を入れ替えても結果は同じ', () => {
    const morning = { date: '2026-11-15', start: '05:00', end: '09:00' }
    expect(shiftsOverlap(morning, night)).toBe(true)
  })

  it('shiftsOverlap_同日の部分的な重なりは true・隣接(終了=開始)は false', () => {
    const a = { date: '2026-11-14', start: '09:00', end: '12:00' }
    expect(shiftsOverlap(a, { date: '2026-11-14', start: '11:00', end: '15:00' })).toBe(true)
    expect(shiftsOverlap(a, { date: '2026-11-14', start: '12:00', end: '15:00' })).toBe(false)
  })

  it('shiftsOverlap_別の日の日中勤務同士は重ならない', () => {
    const a = { date: '2026-11-14', start: '09:00', end: '17:00' }
    expect(shiftsOverlap(a, { date: '2026-11-15', start: '09:00', end: '17:00' })).toBe(false)
  })
})

describe('[REQ-026] スポット（直接雇用）の登録', () => {
  const spotJob = (o: Partial<JobPost> = {}) =>
    mkJob({ employerCompanyId: 'c-spot', form: 'spot', isSecurityWork: false, mode: 'instant', ...o })

  it('spot_その会社に登録済みのスタッフは即応募できる', () => {
    // Arrange
    const person = mkPerson({ employments: [{ companyId: 'c-spot', startOn: '2026-01-01' }] })
    // Act
    const result = checkEligibility(person, spotJob(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('spot_その会社に未登録の人は not_registered だけで不可', () => {
    // Arrange: 雇用は c-001 のみ
    const result = checkEligibility(mkPerson(), spotJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['not_registered'])
  })

  it('spot_その会社を退社済みの人は不可', () => {
    // Arrange: 退社日 2026-03-31 < シフト日 2026-05-01
    const person = mkPerson({
      employments: [{ companyId: 'c-spot', startOn: '2025-01-01', endOn: '2026-03-31' }],
    })
    // Act
    const result = checkEligibility(person, spotJob(), [])
    // Assert
    expect(result.reasons).toContain('not_registered')
  })
})

describe('[REQ-032] 在留期限の更新手続き（旧 t1 移行）', () => {
  it('residence_期限が24日後なら daysLeft 24 の soon として一覧に出る', () => {
    // Arrange: 基準日 2026-11-07 → 期限 2026-12-01
    const p = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-12-01' } })
    // Act
    const result = listRenewals([p], '2026-11-07')
    // Assert
    expect(result).toEqual([
      { personId: 'p-001', kind: 'residence', dueOn: '2026-12-01', daysLeft: 24, urgency: 'soon' },
    ])
  })
})


// ─────────────────────────────────────────────────────────────
// 純粋性: talent/ 配下が非決定 API・外部依存を持たないことを確認
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

describe('[REQ-026] 純粋性: talent/ は非決定 API・外部依存を持たない', () => {
  const talentDir = resolve(dirname(fileURLToPath(import.meta.url)), '../talent')
  const sourceFiles = readdirSync(talentDir)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))

  const forbidden = [
    { label: 'Date.now()',   re: /Date\.now\s*\(/ },
    { label: 'new Date()',   re: /new\s+Date\s*\(\s*\)/ },
    { label: 'Math.random()', re: /Math\.random\s*\(/ },
    { label: 'fetch()',      re: /\bfetch\s*\(/ },
    { label: '@supabase',   re: /from\s+['"]@supabase[^'"]*['"]/ },
    { label: 'react',       re: /from\s+['"]react['"]/ },
    { label: 'window',      re: /\bwindow\b/ },
    { label: 'process.env', re: /process\.env/ },
  ]

  it('talentPurity_ソースが1件以上ある', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  it('talentPurity_非決定API・外部依存を参照しない', () => {
    for (const name of sourceFiles) {
      const code = readFileSync(resolve(talentDir, name), 'utf8')
      for (const rule of forbidden) {
        expect(
          { file: name, hit: rule.re.test(code), label: rule.label },
        ).toEqual(
          { file: name, hit: false, label: rule.label },
        )
      }
    }
  })
})

// ═════════════════════════════════════════════════════════════
// 追加 第3回（仕様 v2.11: 曖昧さ4件の確定。仕様の後追い）
// ═════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// REQ-031: 終了時刻が開始時刻と同じシフト = 24 時間勤務（翌日に終わる）
// ─────────────────────────────────────────────────────────────
describe('[REQ-031] 開始と終了が同時刻のシフトは24時間勤務', () => {
  const plain = (shifts: JobPost['shifts']) =>
    mkJob({ isSecurityWork: false, nightWork: false, shifts })
  // 既存勤務: 2026-05-01 22:00 から 2026-05-02 22:00 まで（24 時間）
  const busy24: BusyShift[] = [
    { companyId: 'c-other', date: '2026-05-01', start: '22:00', end: '22:00' },
  ]

  it('sameTime_既存の24時間勤務は翌日の日中の応募と重なり不可', () => {
    // Arrange
    const job = plain([{ date: '2026-05-02', start: '10:00', end: '14:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, busy24)
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['time_overlap'])
  })

  it('sameTime_既存の24時間勤務の終了ちょうど(翌日22:00)に始まる応募は重ならない', () => {
    // Arrange
    const job = plain([{ date: '2026-05-02', start: '22:00', end: '23:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, busy24)
    // Assert
    expect(result.reasons).not.toContain('time_overlap')
    expect(result.eligible).toBe(true)
  })

  it('sameTime_既存の24時間勤務の終了1分前(翌日21:59)に始まる応募は重なる', () => {
    // Arrange
    const job = plain([{ date: '2026-05-02', start: '21:59', end: '23:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, busy24)
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['time_overlap'])
  })

  it('sameTime_既存の24時間勤務の開始前(同日22:00終了)の応募は重ならない', () => {
    // Arrange
    const job = plain([{ date: '2026-05-01', start: '14:00', end: '22:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, busy24)
    // Assert
    expect(result.reasons).not.toContain('time_overlap')
  })

  it('sameTime_応募側が24時間勤務なら翌日に入る既存勤務と重なり不可', () => {
    // Arrange: 応募 05-01 22:00〜05-02 22:00。既存は 05-02 21:00〜23:00
    const job = plain([{ date: '2026-05-01', start: '22:00', end: '22:00' }])
    const busy: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-02', start: '21:00', end: '23:00' },
    ]
    // Act
    const result = checkEligibility(mkPerson(), job, busy)
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['time_overlap'])
  })

  it('sameTime_応募側が24時間勤務で既存が翌日22:00開始なら重ならない', () => {
    // Arrange
    const job = plain([{ date: '2026-05-01', start: '22:00', end: '22:00' }])
    const busy: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-02', start: '22:00', end: '23:00' },
    ]
    // Act
    const result = checkEligibility(mkPerson(), job, busy)
    // Assert
    expect(result.reasons).not.toContain('time_overlap')
  })

  it('sameTime_24時間勤務は0時間扱いにならず通算8時間超の警告が出る(eligible=true)', () => {
    // Arrange: 既存なし。応募が 22:00〜22:00（24 時間）
    const job = plain([{ date: '2026-05-01', start: '22:00', end: '22:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual(['daily_hours_over_8'])
  })

  it('sameTime_対_通常の勤務(8時間)では同じ開始時刻でも警告は出ない', () => {
    // Arrange
    const job = plain([{ date: '2026-05-01', start: '09:00', end: '17:00' }])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.warnings).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-033: 同じ personId・同日・同 daysLeft の並びは contract → annual_training → residence
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 同順位の種別の並び', () => {
  // FY2026 年度末 2027-03-31 に、契約満了・現任教育(FY2026 未了)・在留期限が重なる
  const triple = (id: string) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: FY2026_END }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
      residence: { workAllowed: true, expiresOn: FY2026_END },
    })
  const item = (personId: string, kind: string) =>
    ({ personId, kind, dueOn: FY2026_END, daysLeft: 26, urgency: 'soon' })

  it('kindOrder_同じ人の3種が同日なら contract → annual_training → residence', () => {
    // Arrange / Act
    const result = listRenewals([triple('p-a')], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      item('p-a', 'contract'),
      item('p-a', 'annual_training'),
      item('p-a', 'residence'),
    ])
  })

  it('kindOrder_personId が違えば personId が先で、その中で種別順', () => {
    // Arrange: 入力は p-b, p-a の順
    // Act
    const result = listRenewals([triple('p-b'), triple('p-a')], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      item('p-a', 'contract'),
      item('p-a', 'annual_training'),
      item('p-a', 'residence'),
      item('p-b', 'contract'),
      item('p-b', 'annual_training'),
      item('p-b', 'residence'),
    ])
  })

  it('kindOrder_期限切れの同日でも contract → residence の順(在留を先に宣言しても)', () => {
    // Arrange: 契約満了も在留期限も 2027-03-01(基準日の4日前)
    const person = mkPerson({
      personId: 'p-x',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-01' }],
      residence: { workAllowed: true, expiresOn: '2027-03-01' },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result).toEqual([
      { personId: 'p-x', kind: 'contract', dueOn: '2027-03-01', daysLeft: -4, urgency: 'expired' },
      { personId: 'p-x', kind: 'residence', dueOn: '2027-03-01', daysLeft: -4, urgency: 'expired' },
    ])
  })

  it('kindOrder_daysLeft が違えば種別より daysLeft が優先される', () => {
    // Arrange: 契約満了 03-20(15日後) / 在留 03-10(5日後) / 現任教育 03-31(26日後)
    const person = mkPerson({
      personId: 'p-y',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-20' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
      residence: { workAllowed: true, expiresOn: '2027-03-10' },
    })
    // Act
    const result = listRenewals([person], RENEWAL_DATE_FY2026)
    // Assert
    expect(result.map(i => [i.kind, i.daysLeft])).toEqual([
      ['residence', 5], ['contract', 15], ['annual_training', 26],
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-029: age60 の例外は、すべてのシフト日で満60歳以上が必要
// ─────────────────────────────────────────────────────────────
describe('[REQ-029] age60 は全シフト日で満60歳以上', () => {
  const twoDayJob = (dates: [string, string]) =>
    mkJob({
      form: 'dispatch', isSecurityWork: false, nightWork: false, employmentDays: 30,
      shifts: dates.map(date => ({ date, start: '09:00', end: '17:00' })),
    })
  const age60Person = (birthDate: string, verifiedOn = '2026-01-01') =>
    mkPerson({ birthDate, guardTraining: NO_TRAINING, dailyDispatchException: { kind: 'age60', verifiedOn } })

  it('age60AllDays_誕生日をまたぐ2日(59歳の日と60歳の日)は不可', () => {
    // Arrange: 1966-05-01 生まれ → 04-30 は 59 歳、05-01 は 60 歳
    const person = age60Person('1966-05-01')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-04-30', '2026-05-01']), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['dispatch_exception_invalid'])
  })

  it('age60AllDays_シフトの並びを逆にしても不可(最初の日だけで判定しない)', () => {
    // Arrange: 60歳の日が先、59歳の日が後
    const person = age60Person('1966-05-01')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-05-01', '2026-04-30']), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['dispatch_exception_invalid'])
  })

  it('age60AllDays_対_両日とも満60歳以上なら可', () => {
    // Arrange: 1966-04-30 生まれ → 04-30 に 60 歳、05-01 も 60 歳
    const person = age60Person('1966-04-30')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-04-30', '2026-05-01']), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('age60AllDays_対_誕生日前日のみの1日シフトも不可(単日でも同じ条件)', () => {
    // Arrange
    const person = age60Person('1966-05-01')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-04-30', '2026-04-30']), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['dispatch_exception_invalid'])
  })

  it('age60AllDays_確認日もすべてのシフト日以前が必要(2日目より後の確認日は不可)', () => {
    // Arrange: 66歳。確認日 05-01 は 1 日目(04-30)より後
    const person = age60Person('1960-01-01', '2026-05-01')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-04-30', '2026-05-01']), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['dispatch_exception_invalid'])
  })

  it('age60AllDays_対_確認日が最初のシフト日以前なら可', () => {
    // Arrange
    const person = age60Person('1960-01-01', '2026-04-30')
    // Act
    const result = checkEligibility(person, twoDayJob(['2026-04-30', '2026-05-01']), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// REQ-029: 暦に存在しない verifiedOn は dispatch_exception_invalid
// ─────────────────────────────────────────────────────────────
describe('[REQ-029] verifiedOn の暦検証', () => {
  const job = mkJob({
    form: 'dispatch', isSecurityWork: false, nightWork: false, employmentDays: 30,
    shifts: [{ date: '2026-05-01', start: '09:00', end: '17:00' }],
  })
  const student = (verifiedOn: string) =>
    mkPerson({ guardTraining: NO_TRAINING, dailyDispatchException: { kind: 'day_student', verifiedOn } })

  it.each([
    ['13月45日', '2026-13-45'],
    ['2月30日', '2026-02-30'],
    ['4月31日(30日までの月)', '2026-04-31'],
    ['平年の2月29日', '2026-02-29'],
    ['0月', '2026-00-10'],
    ['0日', '2026-04-00'],
  ])('calendarInvalid_verifiedOn が暦にない日付(%s)なら dispatch_exception_invalid で不可', (_label, verifiedOn) => {
    // Arrange
    const person = student(verifiedOn)
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['dispatch_exception_invalid'])
  })

  it.each([
    ['月末の2月28日', '2026-02-28'],
    ['うるう年の2月29日', '2024-02-29'],
    ['30日の月の末日', '2026-04-30'],
    ['年始', '2026-01-01'],
  ])('calendarValid_対_verifiedOn が実在する日付(%s)なら可', (_label, verifiedOn) => {
    // Arrange
    const person = student(verifiedOn)
    // Act
    const result = checkEligibility(person, job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════
// 第4回（仕様 v2.13。Adversary 第2回 FIND-104/105/106/107/108/111）
// 型（model.ts）が v2.13 に未追随でも型エラーにならないよう、不正入力は unknown 経由でキャストする
// ═════════════════════════════════════════════════════════════
type AnyReason = string
const reasonsOf = (r: EligibilityResult): AnyReason[] => r.reasons as AnyReason[]
const pubReasons = (job: JobPost): AnyReason[] => validateJobForPublish(job) as AnyReason[]
const asJob = (o: Record<string, unknown>): JobPost => ({ ...mkJob(), ...o }) as unknown as JobPost
const asPerson = (o: Record<string, unknown>): PersonProfile => ({ ...mkPerson(), ...o }) as unknown as PersonProfile
const nonSec = (shifts: JobPost['shifts'], o: Partial<JobPost> = {}) =>
  mkJob({ isSecurityWork: false, nightWork: false, shifts, ...o })
const day = (date: string, start = '09:00', end = '17:00') => ({ date, start, end })

// ─────────────────────────────────────────────────────────────
// A. invalid_input（REQ-026 / REQ-037）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026][REQ-037] 不正な入力は invalid_input で拒否', () => {
  it.each([
    ['日付でない文字列', 'abc'],
    ['暦にない2月30日', '2026-02-30'],
    ['ゼロ埋めなし', '2026-4-1'],
  ])('invalidInput_シフト日が%sなら checkEligibility は invalid_input で不可', (_l, date) => {
    // Arrange
    const job = nonSec([day(date)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it.each([
    ['日付でない文字列', 'abc'],
    ['暦にない2月30日', '2026-02-30'],
    ['ゼロ埋めなし', '2026-4-1'],
  ])('invalidInput_シフト日が%sなら validateJobForPublish も invalid_input', (_l, date) => {
    // Arrange
    const job = nonSec([day(date)])
    // Act
    const result = pubReasons(job)
    // Assert
    expect(result).toEqual(['invalid_input'])
  })

  it('invalidInput_対_正しいシフト日なら公開前チェックは空で invalid_input は出ない', () => {
    // Arrange / Act
    const result = pubReasons(nonSec([day('2026-04-30'), day('2024-02-29')]))
    // Assert
    expect(result).toEqual([])
  })

  it('invalidInput_対_正しいシフト日なら checkEligibility に invalid_input は出ない', () => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), nonSec([day('2026-04-30')]), [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
  })

  it('invalidInput_複数シフトのうち1日でも不正なら invalid_input', () => {
    // Arrange
    const job = nonSec([day('2026-05-01'), day('2026-02-30')])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it('invalidInput_birthDate が不正なら警備案件で18歳未満の判定をすり抜けず不可', () => {
    // Arrange
    const person = asPerson({ birthDate: 'garbage' })
    // Act
    const result = checkEligibility(person, mkJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it('invalidInput_birthDate が暦にない日付(2026-02-30)でも警備案件は不可', () => {
    // Arrange
    const person = asPerson({ birthDate: '2008-02-30' })
    // Act
    const result = checkEligibility(person, mkJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it('invalidInput_対_有効な birthDate の成人は invalid_input が出ない', () => {
    // Arrange / Act
    const result = checkEligibility(mkPerson({ birthDate: '1990-01-01' }), mkJob(), [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
  })

  it('invalidInput_residence.expiresOn が不正なら invalid_input で不可', () => {
    // Arrange
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: 'garbage' } })
    // Act
    const result = checkEligibility(person, mkJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it('invalidInput_対_residence.expiresOn が有効で十分先なら invalid_input も警告も出ない', () => {
    // Arrange
    const person = mkPerson({ residence: { workAllowed: true, expiresOn: '2030-01-01' } })
    // Act
    const result = checkEligibility(person, mkJob(), [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual([])
  })

  describe('派遣案件の employmentDays', () => {
    const dispatch = (employmentDays: unknown) =>
      asJob({
        form: 'dispatch', isSecurityWork: false, nightWork: false,
        employmentDays, shifts: [day('2026-05-01')],
      })
    const student = () =>
      mkPerson({
        guardTraining: NO_TRAINING,
        dailyDispatchException: { kind: 'day_student', verifiedOn: '2026-01-01' },
      })

    it.each([
      ['undefined', undefined],
      ['NaN', Number.NaN],
      ['負数 -1', -1],
      ['小数 1.5', 1.5],
    ])('invalidInput_employmentDays が%sなら invalid_input で不可', (_l, v) => {
      // Arrange
      const job = dispatch(v)
      // Act
      const result = checkEligibility(student(), job, [])
      // Assert
      expect(result.eligible).toBe(false)
      expect(reasonsOf(result)).toContain('invalid_input')
    })

    it.each([
      ['undefined', undefined],
      ['NaN', Number.NaN],
      ['負数 -1', -1],
      ['小数 1.5', 1.5],
    ])('invalidInput_employmentDays が%sなら公開前チェックも invalid_input', (_l, v) => {
      // Arrange / Act
      const result = pubReasons(dispatch(v))
      // Assert
      expect(result).toContain('invalid_input')
    })

    it.each([
      ['0日', 0],
      ['30日', 30],
      ['31日', 31],
    ])('invalidInput_対_employmentDays が%sなら invalid_input は出ない', (_l, v) => {
      // Arrange / Act
      const result = checkEligibility(student(), dispatch(v), [])
      // Assert
      expect(reasonsOf(result)).not.toContain('invalid_input')
      expect(result.eligible).toBe(true)
    })

    it('invalidInput_対_公開前チェックは有効な employmentDays(0/30/31)で空', () => {
      // Arrange / Act / Assert
      expect(pubReasons(dispatch(0))).toEqual([])
      expect(pubReasons(dispatch(30))).toEqual([])
      expect(pubReasons(dispatch(31))).toEqual([])
    })
  })
})

// ─────────────────────────────────────────────────────────────
// B. 例外区分 kind の検証（REQ-029）
// ─────────────────────────────────────────────────────────────
describe('[REQ-029] 例外区分 kind の検証', () => {
  const job = () => nonSec([day('2026-05-01')], { form: 'dispatch', employmentDays: 30 })
  const withKind = (kind: unknown) =>
    asPerson({
      birthDate: '1960-01-01', // age60 でも満60歳以上
      guardTraining: NO_TRAINING,
      dailyDispatchException: { kind, verifiedOn: '2026-01-01' },
    })

  it('kindInvalid_列挙外の区分(bogus)は dispatch_exception_invalid で不可', () => {
    // Arrange / Act
    const result = checkEligibility(withKind('bogus'), job(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('dispatch_exception_invalid')
  })

  it.each([['age60'], ['day_student'], ['side_job'], ['household_income']])(
    'kindValid_対_有効な区分 %s は kind の検証だけでは落ちず可',
    (kind) => {
      // Arrange / Act
      const result = checkEligibility(withKind(kind), job(), [])
      // Assert
      expect(result.eligible).toBe(true)
      expect(result.reasons).toEqual([])
    },
  )
})

// ─────────────────────────────────────────────────────────────
// C. 拒否時は警告を返さない（REQ-032）
// ─────────────────────────────────────────────────────────────
describe('[REQ-032] 在留の拒否と警告は同時に返さない', () => {
  const person = () => mkPerson({ residence: { workAllowed: true, expiresOn: '2026-07-20' } })

  it('noWarnOnReject_期限当日(警告になる日)と期限超過の日が混在すると拒否のみで警告も数値も無い', () => {
    // Arrange: 07-20 は残り0日(警告)、07-21 は期限超過
    const job = nonSec([day('2026-07-20'), day('2026-07-21')])
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('residence_invalid')
    expect(result.warnings).not.toContain('residence_expiring')
    expect(result.details.residenceDaysLeft).toBeUndefined()
    expect('residenceDaysLeft' in result.details).toBe(false)
  })

  it('noWarnOnReject_並びを逆にしても同じ', () => {
    // Arrange
    const job = nonSec([day('2026-07-21'), day('2026-07-20')])
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(reasonsOf(result)).toContain('residence_invalid')
    expect(result.warnings).not.toContain('residence_expiring')
    expect('residenceDaysLeft' in result.details).toBe(false)
  })

  it('noWarnOnReject_就労不可の人は警告日があっても警告を返さない', () => {
    // Arrange
    const p = mkPerson({ residence: { workAllowed: false, expiresOn: '2026-07-20' } })
    // Act
    const result = detailed(checkEligibility(p, nonSec([day('2026-07-10')]), []))
    // Assert
    expect(reasonsOf(result)).toContain('residence_invalid')
    expect(result.warnings).not.toContain('residence_expiring')
    expect('residenceDaysLeft' in result.details).toBe(false)
  })

  it('noWarnOnReject_対_期限超過の日が無ければ警告と最小日数が出る', () => {
    // Arrange: 07-20(0日) と 07-10(10日)。どちらも期限内
    const job = nonSec([day('2026-07-20'), day('2026-07-10')])
    // Act
    const result = detailed(checkEligibility(person(), job, []))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual(['residence_expiring'])
    expect(result.details.residenceDaysLeft).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// D. 線引き記録の中身（REQ-034）
// ─────────────────────────────────────────────────────────────
describe('[REQ-034] 線引き記録は確認者が非空白・確認日が暦の日付のときだけ有効', () => {
  const withRecord = (confirmedBy: string, confirmedOn: string) =>
    mkJob({ needsBoundaryCheck: true, boundaryCheck: { confirmedBy, confirmedOn } })

  it.each([
    ['確認者が空文字', '', '2026-04-10'],
    ['確認者が半角空白のみ', '   ', '2026-04-10'],
    ['確認者が全角空白・タブ・改行のみ', '　\t\n', '2026-04-10'],
    ['確認日が日付でない', '現場責任者:田中', 'garbage'],
    ['確認日が暦にない', '現場責任者:田中', '2026-02-30'],
    ['確認日が空文字', '現場責任者:田中', ''],
  ])('boundaryRecord_%sなら公開拒否', (_l, by, on) => {
    // Arrange / Act
    const result = pubReasons(withRecord(by, on))
    // Assert
    expect(result).toEqual(['boundary_not_confirmed'])
  })

  it.each([
    ['確認者が空文字', '', '2026-04-10'],
    ['確認者が空白のみ', '   ', '2026-04-10'],
    ['確認日が日付でない', '現場責任者:田中', 'garbage'],
    ['確認日が暦にない', '現場責任者:田中', '2026-02-30'],
  ])('boundaryRecord_%sなら応募も boundary_not_confirmed で不可', (_l, by, on) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), withRecord(by, on), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('boundary_not_confirmed')
  })

  it('boundaryRecord_対_有効な記録なら公開可・応募可', () => {
    // Arrange
    const job = withRecord('現場責任者:田中', '2026-04-10')
    // Act / Assert
    expect(pubReasons(job)).toEqual([])
    const result = checkEligibility(mkPerson(), job, [])
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// E. 新任教育の修了日が未来の人（REQ-033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 基準日より後に新任を修了する人は現任教育の対象外', () => {
  const REF = '2027-03-10'
  const person = (id: string, basicDoneOn: string, annual: number[]) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn, annualFiscalYears: annual },
    })

  it('futureBasic_basicDoneOn が基準日より後なら annual_training は出ない', () => {
    // Arrange
    const p = person('p-future', '2027-05-01', [])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result).toEqual([])
  })

  it('futureBasic_対_基準日より前に新任修了し今年度未達の人は annual_training が出る', () => {
    // Arrange: 新任 2026-01-01 (FY2025)。FY2026 の現任は未了
    const p = person('p-past', '2026-01-01', [2025])
    // Act
    const result = listRenewals([p], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-past', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: 21, urgency: 'soon' },
    ])
  })

  it('futureBasic_未来修了の人と過去修了の人が混在しても過去修了の人だけが出る', () => {
    // Arrange
    const list = [person('p-future', '2027-05-01', []), person('p-past', '2026-01-01', [2025])]
    // Act
    const result = listRenewals(list, REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['p-past'])
  })
})

// ─────────────────────────────────────────────────────────────
// F. 並びはコードポイント順（REQ-033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 同日・同 daysLeft の並びはロケール非依存のコードポイント順', () => {
  const REF = '2027-03-10'
  const p = (id: string) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })

  it('codePointOrder_b,B,a,A,z は A,B,a,b,z の順', () => {
    // Arrange
    const list = ['b', 'B', 'a', 'A', 'z'].map(p)
    // Act
    const result = listRenewals(list, REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['A', 'B', 'a', 'b', 'z'])
    expect(result.every((i) => i.kind === 'annual_training' && i.daysLeft === 21)).toBe(true)
  })

  it('codePointOrder_入力順を逆にしても同じ並び', () => {
    // Arrange
    const list = ['z', 'A', 'a', 'B', 'b'].map(p)
    // Act
    const result = listRenewals(list, REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['A', 'B', 'a', 'b', 'z'])
  })

  it('codePointOrder_非ASCII(é)は z の後ろ', () => {
    // Arrange
    const list = ['é', 'z', 'a', 'Z'].map(p)
    // Act
    const result = listRenewals(list, REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['Z', 'a', 'z', 'é'])
  })
})

// ─────────────────────────────────────────────────────────────
// G. 日またぎ勤務の通算（REQ-031）
// ─────────────────────────────────────────────────────────────
describe('[REQ-031] 日またぎ勤務は全時間を始業日に計上', () => {
  const overnight = (date: string): BusyShift => ({ companyId: 'c-other', date, start: '22:00', end: '06:00' })

  it('startDay_他社 11/10 22:00〜06:00 と自社 11/11 06:00〜12:00 は 11/11 が 6 時間で警告なし', () => {
    // Arrange
    const job = nonSec([day('2026-11-11', '06:00', '12:00')])
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, [overnight('2026-11-10')]))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.warnings).toEqual([])
    expect('maxDailyHours' in result.details).toBe(false)
  })

  it('startDay_対_自社 11/10 10:00〜12:00 は 11/10 が他社8時間+2時間で警告(10)', () => {
    // Arrange
    const job = nonSec([day('2026-11-10', '10:00', '12:00')])
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, [overnight('2026-11-10')]))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual(['daily_hours_over_8'])
    expect(result.details.maxDailyHours).toBe(10)
  })

  it('startDay_前日始業の日またぎ(11/9 22:00〜06:00)は 11/10 の自社2時間に加算されない', () => {
    // Arrange
    const job = nonSec([day('2026-11-10', '10:00', '12:00')])
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, [overnight('2026-11-09')]))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('startDay_自社の日またぎ勤務(11/10 22:00〜06:00)は始業日 11/10 の8時間として数え、他社2時間で警告', () => {
    // Arrange: 自社 8 時間(11/10 始業) + 他社 11/10 10:00〜12:00 の 2 時間
    const job = nonSec([day('2026-11-10', '22:00', '06:00')])
    const busy: BusyShift[] = [{ companyId: 'c-other', date: '2026-11-10', start: '10:00', end: '12:00' }]
    // Act
    const result = detailed(checkEligibility(mkPerson(), job, busy))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.warnings).toEqual(['daily_hours_over_8'])
    expect(result.details.maxDailyHours).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────
// H. ミューテーション生存への対応（Adversary 実測）
// ─────────────────────────────────────────────────────────────
describe('[REQ-028] 新任教育の修了日はシフト当日以前なら修了済み', () => {
  const shiftDay = '2026-05-01'
  const job = () => mkJob({ shifts: [day(shiftDay)] })
  const person = (basicDoneOn: string) =>
    mkPerson({ guardTraining: { basicDoneOn, annualFiscalYears: [] } })

  it('basicBoundary_修了日がシフト当日なら修了済みで可(今年度に新任修了なので現任も不要)', () => {
    // Arrange / Act
    const result = checkEligibility(person(shiftDay), job(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('basicBoundary_修了日がシフト翌日なら不可', () => {
    // Arrange
    const p = mkPerson({ guardTraining: { basicDoneOn: '2026-05-02', annualFiscalYears: [2026] } })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('security_basic_training_missing')
  })
})

describe('[REQ-026] 雇用の判定', () => {
  const job = (o: Partial<JobPost> = {}) => nonSec([day('2026-05-01')], o)

  it('employments_他社の雇用と雇用主の雇用がある人は雇用主の案件に可(他社雇用が先)', () => {
    // Arrange
    const p = mkPerson({
      employments: [
        { companyId: 'c-other', startOn: '2020-01-01' },
        { companyId: 'c-001', startOn: '2020-01-01' },
      ],
    })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('employments_雇用主の雇用が先で他社の雇用が後でも可', () => {
    // Arrange
    const p = mkPerson({
      employments: [
        { companyId: 'c-001', startOn: '2020-01-01' },
        { companyId: 'c-other', startOn: '2020-01-01' },
      ],
    })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(true)
  })

  it('employments_対_雇用主の雇用が無く他社の雇用だけなら not_registered', () => {
    // Arrange
    const p = mkPerson({ employments: [{ companyId: 'c-other', startOn: '2020-01-01' }] })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('not_registered')
  })

  it('startOnBoundary_入社日がシフト当日なら可', () => {
    // Arrange
    const p = mkPerson({ employments: [{ companyId: 'c-001', startOn: '2026-05-01' }] })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(true)
  })

  it('startOnBoundary_入社日がシフト前日なら可', () => {
    // Arrange
    const p = mkPerson({ employments: [{ companyId: 'c-001', startOn: '2026-04-30' }] })
    // Act / Assert
    expect(checkEligibility(p, job(), []).eligible).toBe(true)
  })

  it('startOnBoundary_入社日がシフト翌日なら not_registered で不可', () => {
    // Arrange
    const p = mkPerson({ employments: [{ companyId: 'c-001', startOn: '2026-05-02' }] })
    // Act
    const result = checkEligibility(p, job(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('not_registered')
  })

  it('nonSecurity_警備でない案件は教育が未了でも可', () => {
    // Arrange
    const p = mkPerson({ guardTraining: NO_TRAINING })
    // Act
    const result = checkEligibility(p, job({ form: 'spot' }), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

describe('[REQ-031][REQ-032] 警告の計測値は複数日で最大/最小', () => {
  it('maxOfDays_1日目9時間・2日目11時間なら 11(並びを逆にしても 11)', () => {
    // Arrange: 自社は毎日 14:00〜20:00(6h)。他社 3h / 5h
    const day1 = day('2026-05-01', '14:00', '20:00')
    const day2 = day('2026-05-02', '14:00', '20:00')
    const busy: BusyShift[] = [
      { companyId: 'c-other', date: '2026-05-01', start: '09:00', end: '12:00' },
      { companyId: 'c-other', date: '2026-05-02', start: '07:00', end: '12:00' },
    ]
    // Act
    const forward = detailed(checkEligibility(mkPerson(), nonSec([day1, day2]), busy))
    const reverse = detailed(checkEligibility(mkPerson(), nonSec([day2, day1]), busy))
    // Assert
    expect(forward.warnings).toEqual(['daily_hours_over_8'])
    expect(forward.details.maxDailyHours).toBe(11)
    expect(reverse.details.maxDailyHours).toBe(11)
  })

  it('minOfDays_残り40日・10日・25日のシフトでは residenceDaysLeft は 10', () => {
    // Arrange: 期限 2026-07-20
    const p = mkPerson({ residence: { workAllowed: true, expiresOn: '2026-07-20' } })
    const shifts = [day('2026-06-10'), day('2026-07-10'), day('2026-06-25')]
    // Act
    const a = detailed(checkEligibility(p, nonSec(shifts), []))
    const b = detailed(checkEligibility(p, nonSec([...shifts].reverse()), []))
    // Assert
    expect(a.warnings).toEqual(['residence_expiring'])
    expect(a.details.residenceDaysLeft).toBe(10)
    expect(b.details.residenceDaysLeft).toBe(10)
  })
})

// ═════════════════════════════════════════════════════════════
// 第5回（仕様 v2.15。Adversary 第3回 FIND-302/303/304/305/309）
// RenewalItem の型は未更新（urgency に 'invalid'、daysLeft に null が無い）ため、テスト内でキャストする
// ═════════════════════════════════════════════════════════════
type RenewalLoose = {
  personId: string
  kind: string
  dueOn: string
  daysLeft: number | null
  urgency: string
}
const renewals = (people: PersonProfile[], ref: string, soonDays?: number): RenewalLoose[] =>
  (soonDays === undefined
    ? listRenewals(people, ref)
    : listRenewals(people, ref, soonDays)) as unknown as RenewalLoose[]
const brief = (items: RenewalLoose[]) =>
  items.map((i) => ({ personId: i.personId, kind: i.kind, urgency: i.urgency, daysLeft: i.daysLeft }))

// ─────────────────────────────────────────────────────────────
// A. invalid_input の拡張（REQ-026 / REQ-037）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026][REQ-037] 時刻の不正は invalid_input（シフト）', () => {
  const BAD_TIMES = [
    ['25:99', '25:99'],
    ['英字 xx', 'xx'],
    ['ゼロ埋めなし 9:00', '9:00'],
    ['24:00', '24:00'],
    ['空文字', ''],
  ] as const

  it.each(BAD_TIMES)('shiftTime_開始時刻が%sなら checkEligibility は invalid_input だけで拒否', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', t, '17:00')])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it.each(BAD_TIMES)('shiftTime_終了時刻が%sなら checkEligibility は invalid_input だけで拒否', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', '09:00', t)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it.each(BAD_TIMES)('shiftTime_開始時刻が%sなら validateJobForPublish は invalid_input', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', t, '17:00')])
    // Act / Assert
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it.each(BAD_TIMES)('shiftTime_終了時刻が%sなら validateJobForPublish は invalid_input', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', '09:00', t)])
    // Act / Assert
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it.each([
    ['00:00 開始', '00:00', '01:00'],
    ['23:59 終了', '22:59', '23:59'],
    ['09:00 開始', '09:00', '17:00'],
  ])('shiftTime_対_有効な時刻(%s)は invalid_input が出ず応募可・公開可', (_l, s, e) => {
    // Arrange
    const job = nonSec([day('2026-05-01', s, e)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
    expect(pubReasons(job)).toEqual([])
  })
})

describe('[REQ-026][REQ-037] 他の勤務(busy)の不正は invalid_input', () => {
  const busyOf = (o: Record<string, unknown>): BusyShift[] =>
    [{ companyId: 'c-other', date: '2026-04-20', start: '09:00', end: '12:00', ...o }] as unknown as BusyShift[]

  it.each([
    ['garbage', 'garbage'],
    ['暦にない 2026-02-30', '2026-02-30'],
  ])('busyDate_日付が%sなら invalid_input だけで拒否', (_l, date) => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(mkPerson(), job, busyOf({ date }))
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it.each([
    ['zz', 'zz'],
    ['25:00', '25:00'],
  ])('busyTime_開始時刻が%sなら invalid_input だけで拒否', (_l, start) => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(mkPerson(), job, busyOf({ start }))
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it.each([
    ['zz', 'zz'],
    ['25:00', '25:00'],
  ])('busyTime_終了時刻が%sなら invalid_input だけで拒否', (_l, end) => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(mkPerson(), job, busyOf({ end }))
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('busy_対_有効な日付・時刻の他勤務(重ならない)は invalid_input が出ず応募可', () => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(mkPerson(), job, busyOf({}))
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

describe('[REQ-026][REQ-037] 雇用(employments)の日付の不正は invalid_input', () => {
  const withEmp = (e: Record<string, unknown>) =>
    asPerson({ employments: [{ companyId: 'c-001', startOn: '2020-01-01', ...e }] })

  it('employment_startOn が garbage なら invalid_input だけで拒否', () => {
    // Arrange
    const person = withEmp({ startOn: 'garbage' })
    // Act
    const result = checkEligibility(person, nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('employment_endOn が garbage なら invalid_input だけで拒否', () => {
    // Arrange
    const person = withEmp({ endOn: 'garbage' })
    // Act
    const result = checkEligibility(person, nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('employment_endOn が空文字なら不正(退社していない場合は項目を持たない)で invalid_input', () => {
    // Arrange
    const person = withEmp({ endOn: '' })
    // Act
    const result = checkEligibility(person, nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('employment_対_endOn が項目なし(undefined)は在籍中として応募可', () => {
    // Arrange
    const person = withEmp({ endOn: undefined })
    // Act
    const result = checkEligibility(person, nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('employment_対_有効な endOn(シフト日以後)は invalid_input が出ず応募可', () => {
    // Arrange
    const person = withEmp({ endOn: '2026-12-31' })
    // Act
    const result = checkEligibility(person, nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// B. listRenewals の invalid 項目（REQ-033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 期限日が不正な項目は消さず urgency=invalid, daysLeft=null で返す', () => {
  const REF = '2027-03-10' // FY2026。現任教育を満たした人には annual_training の項目は出ない
  const base = (id: string, o: Partial<PersonProfile> = {}) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
      ...o,
    })

  it('invalid_contractEndOn が 2026/05/01 なら contract の invalid 項目として返る', () => {
    // Arrange
    const person = base('p-bad-contract', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2026/05/01' }],
    })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-bad-contract', kind: 'contract', urgency: 'invalid', daysLeft: null },
    ])
  })

  it('invalid_residence.expiresOn が garbage なら residence の invalid 項目として返る', () => {
    // Arrange
    const person = base('p-bad-res', { residence: { workAllowed: true, expiresOn: 'garbage' } })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-bad-res', kind: 'residence', urgency: 'invalid', daysLeft: null },
    ])
  })

  it('invalid_employments.startOn が不正なら contract の invalid 項目として消えずに返る', () => {
    // Arrange: 契約満了日は有効だが、在籍の判定ができない
    const person = base('p-bad-start', {
      employments: [{ companyId: 'c-001', startOn: 'garbage', contractEndOn: '2027-03-20' }],
    })
    // Act
    const result = renewals([person], REF).filter((i) => i.kind === 'contract')
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-bad-start', kind: 'contract', urgency: 'invalid', daysLeft: null },
    ])
  })

  it('invalid_employments.endOn が不正なら contract の invalid 項目として消えずに返る', () => {
    // Arrange
    const person = base('p-bad-end', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', endOn: 'garbage', contractEndOn: '2027-03-20' }],
    })
    // Act
    const result = renewals([person], REF).filter((i) => i.kind === 'contract')
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-bad-end', kind: 'contract', urgency: 'invalid', daysLeft: null },
    ])
  })

  it('invalid_雇用の日付が不正で現任教育が未了の人は annual_training の invalid 項目で返る', () => {
    // Arrange: 在籍中か判定できないため、現任教育の要否を黙って落とさない
    const person = base('p-bad-annual', {
      employments: [{ companyId: 'c-001', startOn: 'garbage' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-bad-annual', kind: 'annual_training', urgency: 'invalid', daysLeft: null },
    ])
  })

  it('invalid_先頭に並ぶ_期限切れより前に出る(personId の昇順でも逆でも)', () => {
    // Arrange: 期限切れの人は personId が先、invalid の人は後ろ
    const expired = base('p-a-expired', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-01' }],
    })
    const invalid = base('p-z-invalid', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2026/05/01' }],
    })
    const soon = base('p-m-soon', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-15' }],
    })
    // Act
    const forward = renewals([expired, soon, invalid], REF)
    const reverse = renewals([invalid, soon, expired], REF)
    // Assert
    const expected = [
      { personId: 'p-z-invalid', kind: 'contract', urgency: 'invalid', daysLeft: null },
      { personId: 'p-a-expired', kind: 'contract', urgency: 'expired', daysLeft: -9 },
      { personId: 'p-m-soon', kind: 'contract', urgency: 'soon', daysLeft: 5 },
    ]
    expect(brief(forward)).toEqual(expected)
    expect(brief(reverse)).toEqual(expected)
  })

  it('invalid_対_有効な期限日の項目は従来どおり(soon と expired の daysLeft・dueOn)', () => {
    // Arrange
    const soon = base('p-ok-soon', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-20' }],
    })
    const expired = base('p-ok-expired', {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: '2027-03-09' }],
    })
    // Act
    const result = renewals([soon, expired], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-ok-expired', kind: 'contract', dueOn: '2027-03-09', daysLeft: -1, urgency: 'expired' },
      { personId: 'p-ok-soon', kind: 'contract', dueOn: '2027-03-20', daysLeft: 10, urgency: 'soon' },
    ])
  })

  it.each([
    ['garbage', 'garbage'],
    ['暦にない 2026-13-45', '2026-13-45'],
  ])('invalid_基準日が%sなら RangeError を投げる', (_l, ref) => {
    // Arrange
    const person = base('p-any')
    // Act / Assert
    expect(() => listRenewals([person], ref)).toThrow(RangeError)
  })

  it('invalid_対_基準日が有効なら RangeError を投げない', () => {
    // Arrange / Act / Assert
    expect(() => listRenewals([base('p-any')], REF)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────
// C. コードポイント順・比較関数の整合（REQ-033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] personId はコードポイント順(BMP 外を含む)', () => {
  const REF = '2027-03-10'
  const p = (id: string) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
  const EXPECTED = ['z', 'é', 'Ａ', '😀'] // U+007A, U+00E9, U+FF21, U+1F600

  it.each([
    ['昇順', ['z', 'é', 'Ａ', '😀']],
    ['逆順', ['😀', 'Ａ', 'é', 'z']],
    ['入れ替え', ['Ａ', 'z', '😀', 'é']],
  ])('codePoint_入力が%sでも z,é,Ａ,😀 の順(UTF-16 順なら 😀 が Ａ より前になる)', (_l, ids) => {
    // Arrange
    const list = ids.map(p)
    // Act
    const result = renewals(list, REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(EXPECTED)
    expect(result.every((i) => i.kind === 'annual_training' && i.daysLeft === 21)).toBe(true)
  })
})

describe('[REQ-033] 同一 personId・同日・同 daysLeft の並びは入力順に依らず kind 順', () => {
  const REF = '2027-03-10'
  const DUE = '2027-03-31' // 現任教育の期限と同日
  const only = (o: Partial<PersonProfile>) =>
    mkPerson({
      personId: 'p-same',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
      ...o,
    })
  const contractOnly = only({ employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: DUE }] })
  const residenceOnly = only({ residence: { workAllowed: true, expiresOn: DUE } })
  const annualOnly = only({ guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] } })

  it('sameId_1人が3種別すべて同日期限なら contract, annual_training, residence の順', () => {
    // Arrange
    const person = only({
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn: DUE }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
      residence: { workAllowed: true, expiresOn: DUE },
    })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result.map((i) => i.kind)).toEqual(['contract', 'annual_training', 'residence'])
    expect(result.every((i) => i.daysLeft === 21 && i.dueOn === DUE)).toBe(true)
  })

  it.each([
    ['contract,annual,residence', [0, 1, 2]],
    ['residence,annual,contract', [2, 1, 0]],
    ['annual,residence,contract', [1, 2, 0]],
    ['annual,contract,residence', [1, 0, 2]],
  ])('sameId_同一 personId の3エントリを%sの順で渡しても結果が同じ', (_l, order) => {
    // Arrange
    const entries = [contractOnly, annualOnly, residenceOnly]
    const input = order.map((i) => entries[i])
    // Act
    const result = renewals(input, REF)
    // Assert
    expect(result.map((i) => `${i.personId}:${i.kind}:${i.daysLeft}`)).toEqual([
      'p-same:contract:21',
      'p-same:annual_training:21',
      'p-same:residence:21',
    ])
  })

  it('sameId_同一 personId・同一 kind の2エントリを含んでも件数を失わず入力順に依らず同じ結果', () => {
    // Arrange
    const a = contractOnly
    const b = only({ employments: [{ companyId: 'c-002', startOn: '2021-01-01', contractEndOn: DUE }] })
    // Act
    const forward = renewals([a, b, residenceOnly], REF)
    const reverse = renewals([residenceOnly, b, a], REF)
    // Assert
    expect(forward).toHaveLength(3)
    expect(forward.map((i) => i.kind)).toEqual(['contract', 'contract', 'residence'])
    expect(reverse).toEqual(forward)
  })
})

// ─────────────────────────────────────────────────────────────
// D. ミューテーション生存への対応（Adversary 実測）
// ─────────────────────────────────────────────────────────────
describe('[REQ-028] 教育の不足は直接雇用の警備案件だけで判定(派遣では出さない)', () => {
  const untrained = () => mkPerson({ guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] } })

  it('securityDispatch_警備×派遣では security_dispatch_forbidden のみで教育不足の理由は含まれない', () => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: true })
    // Act
    const reasons = reasonsOf(checkEligibility(untrained(), job, []))
    // Assert
    expect(reasons).toContain('security_dispatch_forbidden')
    expect(reasons).not.toContain('security_basic_training_missing')
    expect(reasons).not.toContain('security_annual_training_missing')
  })

  it('securityDispatch_対_警備×直接雇用では同じ人に教育不足の理由が出る', () => {
    // Arrange
    const job = mkJob({ form: 'security', isSecurityWork: true })
    // Act
    const reasons = reasonsOf(checkEligibility(untrained(), job, []))
    // Assert
    expect(reasons).toContain('security_basic_training_missing')
    expect(reasons).not.toContain('security_dispatch_forbidden')
  })
})

describe('[REQ-034] confirmedBy が文字列でない記録は記録なし(例外を出さない)', () => {
  const jobWith = (confirmedBy: unknown) =>
    mkJob({
      isSecurityWork: false,
      needsBoundaryCheck: true,
      boundaryCheck: { confirmedBy, confirmedOn: '2026-04-01' } as unknown as JobPost['boundaryCheck'],
    })

  it('confirmedBy_数値(123)でも TypeError を出さず boundary_not_confirmed で拒否', () => {
    // Arrange
    const job = jobWith(123)
    // Act
    let result: EligibilityResult | undefined
    expect(() => {
      result = checkEligibility(mkPerson(), job, [])
    }).not.toThrow()
    // Assert
    expect(result?.eligible).toBe(false)
    expect(reasonsOf(result as EligibilityResult)).toContain('boundary_not_confirmed')
  })

  it('confirmedBy_数値(123)でも validateJobForPublish は TypeError を出さず boundary_not_confirmed', () => {
    // Arrange
    const job = jobWith(123)
    // Act
    let result: AnyReason[] = []
    expect(() => {
      result = pubReasons(job)
    }).not.toThrow()
    // Assert
    expect(result).toEqual(['boundary_not_confirmed'])
  })

  it('confirmedBy_対_有効な文字列なら記録ありで拒否されない', () => {
    // Arrange
    const job = jobWith('現場責任者 田中')
    // Act / Assert
    expect(pubReasons(job)).toEqual([])
    expect(checkEligibility(mkPerson(), job, []).eligible).toBe(true)
  })
})

describe('[REQ-033] 在留期限の項目は就労可否で条件付けない', () => {
  const REF = '2027-03-10'
  const person = (workAllowed: boolean) =>
    mkPerson({
      personId: 'p-res',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
      residence: { workAllowed, expiresOn: '2027-03-20' },
    })

  it('residenceList_就労不可(workAllowed=false)でも期限の近い在留は soon で一覧に出る', () => {
    // Arrange / Act
    const result = renewals([person(false)], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-res', kind: 'residence', dueOn: '2027-03-20', daysLeft: 10, urgency: 'soon' },
    ])
  })

  it('residenceList_対_就労可でも同じ項目が出る(就労可否で結果が変わらない)', () => {
    // Arrange / Act
    const allowed = renewals([person(true)], REF)
    const denied = renewals([person(false)], REF)
    // Assert
    expect(allowed).toEqual(denied)
    expect(allowed).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════
// 第6回（仕様 v2.18。Adversary 第4回 FIND-401/402/403/405）
// ═════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// A. FIND-401: 契約満了日・在留期限が空文字/null でも項目を消さない（REQ-033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 契約満了日・在留期限が空文字/null でも invalid 項目として返す', () => {
  const REF = '2027-03-10'
  const base = (id: string, o: Partial<PersonProfile> = {}) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
      ...o,
    })
  const withContract = (id: string, contractEndOn: unknown) =>
    base(id, {
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn }] as unknown as PersonProfile['employments'],
    })

  it('contractEndOn_空文字は contract の invalid 項目(dueOn は空文字)で返る', () => {
    // Arrange
    const person = withContract('p-empty', '')
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-empty', kind: 'contract', dueOn: '', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('contractEndOn_null(any キャスト)は contract の invalid 項目(dueOn は null)で返る', () => {
    // Arrange
    const person = withContract('p-null', null)
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-null', kind: 'contract', dueOn: null, daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('contractEndOn_キー無し(undefined)は項目なし', () => {
    // Arrange
    const person = withContract('p-undef', undefined)
    // Act / Assert
    expect(renewals([person], REF)).toEqual([])
  })

  it('contractEndOn_空文字の invalid は期限切れ・間近より先頭に並ぶ', () => {
    // Arrange
    const expired = withContract('p-a', '2027-03-01')
    const soon = withContract('p-b', '2027-03-15')
    const empty = withContract('p-z', '')
    // Act
    const result = renewals([expired, soon, empty], REF)
    // Assert
    expect(brief(result)).toEqual([
      { personId: 'p-z', kind: 'contract', urgency: 'invalid', daysLeft: null },
      { personId: 'p-a', kind: 'contract', urgency: 'expired', daysLeft: -9 },
      { personId: 'p-b', kind: 'contract', urgency: 'soon', daysLeft: 5 },
    ])
  })

  it('contractEndOn_対_有効な日付なら従来どおり(soon・dueOn・daysLeft)', () => {
    // Arrange
    const person = withContract('p-ok', '2027-03-20')
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-ok', kind: 'contract', dueOn: '2027-03-20', daysLeft: 10, urgency: 'soon' },
    ])
  })

  it('residence_expiresOn が空文字でも residence の invalid 項目(dueOn は空文字)で返る', () => {
    // Arrange
    const person = base('p-res-empty', { residence: { workAllowed: true, expiresOn: '' } })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-res-empty', kind: 'residence', dueOn: '', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('residence_対_expiresOn のキーが無ければ項目なし', () => {
    // Arrange
    const person = base('p-res-none', { residence: { workAllowed: true } })
    // Act / Assert
    expect(renewals([person], REF)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// B. FIND-402: 新任教育の修了日が不正（REQ-026 / 028 / 033）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026][REQ-028][REQ-033] basicDoneOn が不正な人', () => {
  const REF = '2027-03-10' // FY2026。年度末 2027-03-31
  const bad = (basicDoneOn: unknown, years = [2025]) =>
    mkPerson({
      personId: 'p-bad-basic',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn, annualFiscalYears: years } as unknown as PersonProfile['guardTraining'],
    })

  it.each([
    ['暦にない 2026-04-99', '2026-04-99'],
    ['garbage', 'garbage'],
  ])('basicDoneOn_%s は警備案件で invalid_input', (_l, v) => {
    // Arrange
    const job = mkJob()
    // Act
    const result = checkEligibility(bad(v), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it.each([
    ['暦にない 2026-04-99', '2026-04-99'],
    ['garbage', 'garbage'],
  ])('basicDoneOn_%s は非警備案件でも invalid_input', (_l, v) => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(bad(v), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('basicDoneOn_対_undefined(未修了)は非警備案件で invalid_input にならず応募可', () => {
    // Arrange
    const job = nonSec([day('2026-05-01')])
    // Act
    const result = checkEligibility(bad(undefined, []), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
  })

  it('basicDoneOn_対_undefined(未修了)は警備案件で security_basic_training_missing(invalid_input ではない)', () => {
    // Arrange
    const job = mkJob()
    // Act
    const result = checkEligibility(bad(undefined, []), job, [])
    // Assert
    expect(reasonsOf(result)).toContain('security_basic_training_missing')
    expect(reasonsOf(result)).not.toContain('invalid_input')
  })

  it.each([
    ['暦にない 2026-04-99', '2026-04-99'],
    ['garbage', 'garbage'],
  ])('listRenewals_basicDoneOn が%sなら annual_training の invalid 項目(dueOn は年度末)', (_l, v) => {
    // Arrange / Act
    const result = renewals([bad(v)], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-bad-basic', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('listRenewals_対_basicDoneOn が undefined(未修了)なら invalid 項目は出ない', () => {
    // Arrange / Act
    const result = renewals([bad(undefined, [])], REF)
    // Assert
    expect(result.filter((i) => i.urgency === 'invalid')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// C. FIND-403: 変異対策（具体的な値で固定）
// ─────────────────────────────────────────────────────────────
describe('[REQ-026][REQ-037] 時刻の形式(HH:MM 00:00〜23:59)の境界', () => {
  it.each([
    ['30:00', '30:00'],
    ['10:60', '10:60'],
    ['09:00:00', '09:00:00'],
    ['x09:00', 'x09:00'],
    ['09:00x', '09:00x'],
    ['先頭空白 " 09:00"', ' 09:00'],
    ['24:00', '24:00'],
  ])('timeFormat_開始時刻が%sなら invalid_input だけで拒否', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', t, '17:00')])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it.each([
    ['30:00', '30:00'],
    ['10:60', '10:60'],
    ['09:00:00', '09:00:00'],
    ['x09:00', 'x09:00'],
    ['09:00x', '09:00x'],
    ['先頭空白 " 09:00"', ' 09:00'],
  ])('timeFormat_終了時刻が%sなら invalid_input だけで拒否', (_l, t) => {
    // Arrange
    const job = nonSec([day('2026-05-01', '08:00', t)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it('timeFormat_数値 900 の開始時刻は例外を投げず invalid_input', () => {
    // Arrange
    const job = nonSec([{ date: '2026-05-01', start: 900, end: '17:00' } as unknown as JobPost['shifts'][number]])
    // Act
    let result: EligibilityResult | undefined
    expect(() => {
      result = checkEligibility(mkPerson(), job, [])
    }).not.toThrow()
    // Assert
    expect(result?.eligible).toBe(false)
    expect(reasonsOf(result as EligibilityResult)).toEqual(['invalid_input'])
    expect(() => pubReasons(job)).not.toThrow()
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it('timeFormat_数値 900 の終了時刻は例外を投げず invalid_input', () => {
    // Arrange
    const job = nonSec([{ date: '2026-05-01', start: '08:00', end: 900 } as unknown as JobPost['shifts'][number]])
    // Act
    let result: EligibilityResult | undefined
    expect(() => {
      result = checkEligibility(mkPerson(), job, [])
    }).not.toThrow()
    // Assert
    expect(result?.eligible).toBe(false)
    expect(reasonsOf(result as EligibilityResult)).toEqual(['invalid_input'])
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })

  it.each([
    ['00:00 開始(下限)', '00:00', '08:00'],
    ['23:59 終了(上限)', '22:00', '23:59'],
    ['19:59', '19:59', '23:00'],
    ['20:00', '20:00', '23:00'],
  ])('timeFormat_対_有効な時刻 %s は invalid_input が出ない', (_l, s, e) => {
    // Arrange
    const job = nonSec([day('2026-05-01', s, e)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
    expect(pubReasons(job)).toEqual([])
  })
})

describe('[REQ-026][REQ-037] 日付の形式(YYYY-MM-DD 完全一致)', () => {
  it.each([
    ['末尾に時刻 2026-01-01T09:00', '2026-01-01T09:00'],
    ['末尾に文字 2026-01-01x', '2026-01-01x'],
    ['先頭に文字 x2026-01-01', 'x2026-01-01'],
    ['先頭空白 " 2026-01-01"', ' 2026-01-01'],
  ])('dateFormat_シフト日が%sなら invalid_input だけで拒否', (_l, d) => {
    // Arrange
    const job = nonSec([day(d)])
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
    expect(pubReasons(job)).toEqual(['invalid_input'])
  })
})

describe('[REQ-029] 日雇派遣の判定は派遣のときだけ', () => {
  const noTraining = () => mkPerson({ guardTraining: { basicDoneOn: undefined, annualFiscalYears: [] } })

  it.each([
    ['spot', 30],
    ['spot', 1],
    ['referral', 30],
  ] as const)('dailyDispatchOnlyDispatch_form=%s で employmentDays=%i でも daily_dispatch_not_allowed は出ない', (form, days) => {
    // Arrange
    const job = mkJob({ form, isSecurityWork: false, employmentDays: days })
    // Act
    const result = checkEligibility(noTraining(), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('daily_dispatch_not_allowed')
    expect(result.eligible).toBe(true)
  })

  it.each([30, 1])('dailyDispatchOnlyDispatch_form=security で employmentDays=%i でも daily_dispatch_not_allowed は出ない', (days) => {
    // Arrange
    const job = mkJob({ form: 'security', isSecurityWork: true, employmentDays: days })
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('daily_dispatch_not_allowed')
    expect(result.eligible).toBe(true)
  })

  it('dailyDispatchOnlyDispatch_対_派遣で 30 日なら出る', () => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: false, employmentDays: 30 })
    // Act
    const result = checkEligibility(noTraining(), job, [])
    // Assert
    expect(reasonsOf(result)).toContain('daily_dispatch_not_allowed')
  })
})

describe('[REQ-033] 雇用の退社日が空文字の人の invalid 項目', () => {
  const REF = '2027-03-10'

  it('endOn_空文字で契約満了日あり・現任教育未了なら contract と annual_training の invalid 項目(dueOn は具体値)', () => {
    // Arrange
    const person = mkPerson({
      personId: 'p-endempty',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', endOn: '', contractEndOn: '2027-03-20' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-endempty', kind: 'contract', dueOn: '2027-03-20', daysLeft: null, urgency: 'invalid' },
      { personId: 'p-endempty', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('endOn_空文字の契約満了日が不正でも dueOn は入力値のまま', () => {
    // Arrange
    const person = mkPerson({
      personId: 'p-endempty2',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', endOn: '', contractEndOn: '2026/05/01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025, 2026] },
    })
    // Act
    const result = renewals([person], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-endempty2', kind: 'contract', dueOn: '2026/05/01', daysLeft: null, urgency: 'invalid' },
    ])
  })
})

describe('[REQ-033] personId が他方の接頭辞のとき短い方が先(コードポイント順)', () => {
  const REF = '2027-03-10'
  const p = (id: string) =>
    mkPerson({
      personId: id,
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })

  it.each([
    ['ab と abc(短い方が先)', ['ab', 'abc']],
    ['abc と ab(逆順入力)', ['abc', 'ab']],
  ])('prefix_%s でも ab が先', (_l, ids) => {
    // Arrange / Act
    const result = renewals(ids.map(p), REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['ab', 'abc'])
    expect(result.every((i) => i.daysLeft === 21)).toBe(true)
  })

  it.each([
    ['空文字と a', ['', 'a']],
    ['a と空文字(逆順入力)', ['a', '']],
  ])('prefix_%s でも空文字が先', (_l, ids) => {
    // Arrange / Act
    const result = renewals(ids.map(p), REF)
    // Assert
    expect(result.map((i) => i.personId)).toEqual(['', 'a'])
  })
})

// ═════════════════════════════════════════════════════════════
// 第7回（仕様 v2.19。Adversary 第5回 FIND-505/507/508）
// 変異の生存への対応。期待値はすべて仕様から導いた具体値。対になるケースを必ず付ける
// ═════════════════════════════════════════════════════════════
const MID = 'c-002'
const busyAt = (date: string, start: string, end: string): BusyShift => ({ date, start, end, companyId: MID })

// ─────────────────────────────────────────────────────────────
// 1. 年齢(REQ-030)は各シフト日で判定
// ─────────────────────────────────────────────────────────────
describe('[REQ-030] 年齢は全シフト日で判定(順序に依らない)', () => {
  // 2008-05-15 生まれ: 2026-05-14 は 17 歳、2026-05-15 から 18 歳
  const person = () => mkPerson({ birthDate: '2008-05-15' })
  const secJob = (dates: string[]) => mkJob({ shifts: dates.map((d) => day(d)) })
  const nightJob = (dates: string[]) => nonSec(dates.map((d) => day(d)), { form: 'spot', nightWork: true })

  it.each([
    ['警備: 17歳の日→18歳の日', secJob(['2026-05-14', '2026-05-15'])],
    ['警備: 18歳の日→17歳の日(逆順)', secJob(['2026-05-15', '2026-05-14'])],
    ['警備: 18歳の日が2つ続いた後に17歳の日', secJob(['2026-05-15', '2026-05-16', '2026-05-14'])],
    ['警備: 17歳の日が真ん中', secJob(['2026-05-20', '2026-05-14', '2026-05-21'])],
    ['夜間: 17歳の日→18歳の日', nightJob(['2026-05-14', '2026-05-15'])],
    ['夜間: 18歳の日→17歳の日(逆順)', nightJob(['2026-05-15', '2026-05-14'])],
  ])('shiftAge_%s は under_age', (_l, job) => {
    // Arrange / Act
    const result = checkEligibility(person(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('under_age')
  })

  it.each([
    ['警備: すべて18歳の日', secJob(['2026-05-15', '2026-05-16'])],
    ['夜間: すべて18歳の日(逆順)', nightJob(['2026-05-16', '2026-05-15'])],
  ])('shiftAge_対_%s は under_age なし・応募可', (_l, job) => {
    // Arrange / Act
    const result = checkEligibility(person(), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('under_age')
    expect(result.eligible).toBe(true)
  })

  it('shiftAge_対_警備でも夜間でもない案件は 17歳の日があっても under_age にしない', () => {
    // Arrange
    const job = nonSec([day('2026-05-14'), day('2026-05-15')], { form: 'spot' })
    // Act
    const result = checkEligibility(person(), job, [])
    // Assert
    expect(reasonsOf(result)).not.toContain('under_age')
    expect(result.eligible).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 2. 時間の重なり(REQ-031)は全シフトで判定
// ─────────────────────────────────────────────────────────────
describe('[REQ-031] 時間の重なりは全シフトで判定', () => {
  const job = () =>
    mkJob({ shifts: [day('2026-05-01'), day('2026-05-10'), day('2026-05-20')] })

  it.each([
    ['最初のシフトだけ重なる', busyAt('2026-05-01', '10:00', '12:00')],
    ['2つ目(最初でない)のシフトだけ重なる', busyAt('2026-05-10', '10:00', '12:00')],
    ['最後のシフトだけ重なる', busyAt('2026-05-20', '16:59', '18:00')],
  ])('overlapAny_%s なら time_overlap', (_l, busy) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), job(), [busy])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('time_overlap')
  })

  it.each([
    ['どのシフトの日でもない日の勤務', busyAt('2026-05-05', '09:00', '17:00')],
    ['2つ目のシフト終了 17:00 に接する 17:00 開始', busyAt('2026-05-10', '17:00', '19:00')],
  ])('overlapAny_対_%s は time_overlap なし・応募可', (_l, busy) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), job(), [busy])
    // Assert
    expect(result.reasons).toEqual([])
    expect(result.eligible).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 3. 警備×派遣(REQ-027/028)は employmentDays に依らない
// ─────────────────────────────────────────────────────────────
describe('[REQ-027][REQ-028] 警備×派遣は employmentDays に依らず拒否', () => {
  it.each([10, 30, 31, 90])('securityDispatch_employmentDays=%i でも応募は security_dispatch_forbidden', (days) => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: true, employmentDays: days })
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('security_dispatch_forbidden')
  })

  it.each([10, 30, 31, 90])('securityDispatch_employmentDays=%i でも公開前チェックは [security_dispatch_forbidden]', (days) => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: true, employmentDays: days })
    // Act / Assert
    expect(pubReasons(job)).toEqual(['security_dispatch_forbidden'])
  })

  it.each([10, 31, 90])('securityDispatch_対_非警備×派遣(employmentDays=%i)は公開可', (days) => {
    // Arrange
    const job = mkJob({ form: 'dispatch', isSecurityWork: false, employmentDays: days })
    // Act / Assert
    expect(pubReasons(job)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 4. 線引き確認(REQ-034)は契約の形に依らない
// ─────────────────────────────────────────────────────────────
describe('[REQ-034] 線引き確認は契約の形に依らない', () => {
  const formJob = (form: JobPost['form'], o: Partial<JobPost> = {}) =>
    mkJob({ form, isSecurityWork: form === 'security', employmentDays: 90, ...o })

  it.each(['spot', 'dispatch', 'security', 'referral'] as const)(
    'boundaryForm_form=%s で needsBoundaryCheck かつ記録なしなら公開拒否 [boundary_not_confirmed]',
    (form) => {
      // Arrange / Act / Assert
      expect(pubReasons(formJob(form, { needsBoundaryCheck: true }))).toEqual(['boundary_not_confirmed'])
    },
  )

  it.each(['spot', 'dispatch', 'security', 'referral'] as const)(
    'boundaryForm_form=%s で needsBoundaryCheck かつ記録なしなら応募も boundary_not_confirmed',
    (form) => {
      // Arrange / Act
      const result = checkEligibility(mkPerson(), formJob(form, { needsBoundaryCheck: true }), [])
      // Assert
      expect(result.eligible).toBe(false)
      expect(reasonsOf(result)).toContain('boundary_not_confirmed')
    },
  )

  it.each(['spot', 'dispatch', 'security', 'referral'] as const)(
    'boundaryForm_対_form=%s で記録あり、または確認不要なら公開可',
    (form) => {
      // Arrange
      const recorded = formJob(form, {
        needsBoundaryCheck: true,
        boundaryCheck: { confirmedBy: '現場責任者:田中', confirmedOn: '2026-04-10' },
      })
      const notNeeded = formJob(form, { needsBoundaryCheck: false })
      // Act / Assert
      expect(pubReasons(recorded)).toEqual([])
      expect(pubReasons(notNeeded)).toEqual([])
    },
  )
})

// ─────────────────────────────────────────────────────────────
// 5. basicDoneOn が空文字(REQ-026/033)
// ─────────────────────────────────────────────────────────────
describe('[REQ-026][REQ-033] basicDoneOn が空文字は不正(undefined は不正でない)', () => {
  const REF = '2027-03-10'
  const withBasic = (basicDoneOn: unknown, years = [2025]) =>
    mkPerson({
      personId: 'p-basic-empty',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn, annualFiscalYears: years } as unknown as PersonProfile['guardTraining'],
    })

  it('basicDoneOnEmpty_非警備案件でも invalid_input のみ', () => {
    // Arrange / Act
    const result = checkEligibility(withBasic(''), nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toEqual(['invalid_input'])
  })

  it('basicDoneOnEmpty_警備案件でも invalid_input を含む', () => {
    // Arrange / Act
    const result = checkEligibility(withBasic(''), mkJob(), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
  })

  it('basicDoneOnEmpty_対_undefined は非警備案件で応募可(invalid_input なし)', () => {
    // Arrange / Act
    const result = checkEligibility(withBasic(undefined, []), nonSec([day('2026-05-01')]), [])
    // Assert
    expect(result.reasons).toEqual([])
    expect(result.eligible).toBe(true)
  })

  it('basicDoneOnEmpty_listRenewals は annual_training の invalid 項目(dueOn は年度末)', () => {
    // Arrange / Act
    const result = renewals([withBasic('')], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-basic-empty', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('basicDoneOnEmpty_対_listRenewals は undefined なら invalid 項目なし', () => {
    // Arrange / Act
    const result = renewals([withBasic(undefined, [])], REF)
    // Assert
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 6. basicDoneOn 不正でも今年度の現任教育が済んでいれば invalid を出さない(REQ-033)
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] basicDoneOn が不正でも今年度の現任教育済みなら annual_training の invalid 項目は出ない', () => {
  const REF = '2027-03-10' // FY2026
  const withBasic = (basicDoneOn: unknown, years: number[]) =>
    mkPerson({
      personId: 'p-bad-done',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn, annualFiscalYears: years } as unknown as PersonProfile['guardTraining'],
    })

  it.each([
    ['空文字', ''],
    ['garbage', 'garbage'],
    ['暦にない 2026-04-99', '2026-04-99'],
  ])('badBasicDone_%s でも annualFiscalYears に 2026 があれば項目なし', (_l, v) => {
    // Arrange / Act
    const result = renewals([withBasic(v, [2026])], REF)
    // Assert
    expect(result).toEqual([])
  })

  it.each([
    ['空文字', ''],
    ['garbage', 'garbage'],
  ])('badBasicDone_対_%s で今年度が未達(2025 のみ)なら invalid 項目', (_l, v) => {
    // Arrange / Act
    const result = renewals([withBasic(v, [2025])], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-bad-done', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// 7. listApplicableJobs は mode に依らない(REQ-026)
// ─────────────────────────────────────────────────────────────
describe('[REQ-026] listApplicableJobs は placement mode が instant でも可否に影響しない', () => {
  it('instantMode_応募できない instant の案件は含まれず、できる案件だけが入力順で返る', () => {
    // Arrange: 現任教育が今年度(FY2026)未達の人。警備案件は不可、非警備案件は可
    const person = mkPerson({
      guardTraining: { basicDoneOn: '2020-06-01', annualFiscalYears: [2025] },
    })
    const jobs = [
      mkJob({ jobId: 'j-instant-sec', mode: 'instant' }),
      nonSec([day('2026-05-01')], { jobId: 'j-instant-ok', form: 'spot', mode: 'instant' }),
      mkJob({ jobId: 'j-assign-sec', mode: 'assign' }),
      nonSec([day('2026-05-02')], { jobId: 'j-review-ok', form: 'spot', mode: 'apply_review' }),
    ]
    // Act
    const result = listApplicableJobs(person, jobs, [])
    // Assert
    expect(result.map((j) => j.jobId)).toEqual(['j-instant-ok', 'j-review-ok'])
  })
})

// ─────────────────────────────────────────────────────────────
// 8. employmentDays の検証は派遣のみ(REQ-026)
// ─────────────────────────────────────────────────────────────
describe('[REQ-026] employmentDays の検証は派遣のときだけ', () => {
  const badDays: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['-1', -1],
  ]
  const spot = (employmentDays: unknown) =>
    asJob({ ...nonSec([day('2026-05-01')], { form: 'spot' }), employmentDays })
  const security = (employmentDays: unknown) => asJob({ ...mkJob(), employmentDays })

  it.each(badDays)('employmentDaysScope_spot で employmentDays=%s でも応募可・invalid_input なし', (_l, v) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), spot(v), [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
    expect(pubReasons(spot(v))).toEqual([])
  })

  it.each(badDays)('employmentDaysScope_security で employmentDays=%s でも応募可・invalid_input なし', (_l, v) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), security(v), [])
    // Assert
    expect(reasonsOf(result)).not.toContain('invalid_input')
    expect(result.eligible).toBe(true)
    expect(pubReasons(security(v))).toEqual([])
  })

  it.each(badDays)('employmentDaysScope_対_非警備×派遣で employmentDays=%s は invalid_input', (_l, v) => {
    // Arrange
    const job = asJob({ ...nonSec([day('2026-05-01')], { form: 'dispatch' }), employmentDays: v })
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('invalid_input')
    expect(pubReasons(job)).toContain('invalid_input')
  })
})

// ─────────────────────────────────────────────────────────────
// 9. listRenewals の soonDays(REQ-033)
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] soonDays: 契約・在留・現任教育のそれぞれで境界を固定', () => {
  const REF = '2027-01-10' // FY2026。年度末まで 80 日
  const contractPerson = (contractEndOn: string) =>
    mkPerson({
      personId: 'p-soon',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01', contractEndOn }],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2026] },
    })
  const residencePerson = (expiresOn: string) =>
    mkPerson({
      personId: 'p-soon',
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2026] },
      residence: { workAllowed: true, expiresOn },
    })
  const annualPerson = () =>
    mkPerson({
      personId: 'p-soon',
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: [2025] },
    })
  const soon = (kind: string, dueOn: string, daysLeft: number): RenewalLoose =>
    ({ personId: 'p-soon', kind, dueOn, daysLeft, urgency: 'soon' })

  describe('soonDays=7', () => {
    it('契約満了_7日後は出る', () => {
      expect(renewals([contractPerson('2027-01-17')], REF, 7)).toEqual([soon('contract', '2027-01-17', 7)])
    })
    it('契約満了_8日後は出ない', () => {
      expect(renewals([contractPerson('2027-01-18')], REF, 7)).toEqual([])
    })
    it('在留_7日後は出る', () => {
      expect(renewals([residencePerson('2027-01-17')], REF, 7)).toEqual([soon('residence', '2027-01-17', 7)])
    })
    it('在留_8日後は出ない', () => {
      expect(renewals([residencePerson('2027-01-18')], REF, 7)).toEqual([])
    })
    it('現任教育_年度末まで 7 日(基準日 2027-03-24)は出る', () => {
      expect(renewals([annualPerson()], '2027-03-24', 7)).toEqual([soon('annual_training', '2027-03-31', 7)])
    })
    it('現任教育_年度末まで 8 日(基準日 2027-03-23)は出ない', () => {
      expect(renewals([annualPerson()], '2027-03-23', 7)).toEqual([])
    })
  })

  describe('soonDays 省略(既定 30)', () => {
    it('契約満了_30日後は出る', () => {
      expect(renewals([contractPerson('2027-02-09')], REF)).toEqual([soon('contract', '2027-02-09', 30)])
    })
    it('契約満了_31日後は出ない', () => {
      expect(renewals([contractPerson('2027-02-10')], REF)).toEqual([])
    })
    it('在留_30日後は出る', () => {
      expect(renewals([residencePerson('2027-02-09')], REF)).toEqual([soon('residence', '2027-02-09', 30)])
    })
    it('在留_31日後は出ない', () => {
      expect(renewals([residencePerson('2027-02-10')], REF)).toEqual([])
    })
    it('現任教育_年度末まで 30 日(基準日 2027-03-01)は出る', () => {
      expect(renewals([annualPerson()], '2027-03-01')).toEqual([soon('annual_training', '2027-03-31', 30)])
    })
    it('現任教育_年度末まで 31 日(基準日 2027-02-28)は出ない', () => {
      expect(renewals([annualPerson()], '2027-02-28')).toEqual([])
    })
  })
})

// ─────────────────────────────────────────────────────────────
// 10. 雇用の不正(REQ-033 v2.19)
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 不正な雇用を持つ人の契約・現任教育の扱い', () => {
  const REF = '2026-12-01' // FY2026。年度末 2027-03-31
  const BAD = { companyId: 'c-001', startOn: '2026-02-30' } // 暦にない入社日
  const OK_CONTRACT = { companyId: 'c-002', startOn: '2020-01-01', contractEndOn: '2026-11-01' }
  const OK_PLAIN = { companyId: 'c-002', startOn: '2020-01-01' }
  const person = (employments: unknown[], years: number[]) =>
    mkPerson({
      personId: 'p-emp',
      employments: employments as PersonProfile['employments'],
      guardTraining: { basicDoneOn: '2020-01-01', annualFiscalYears: years },
    })

  it('a_不正な雇用(契約満了日なし)と有効な雇用(契約満了 2026-11-01)なら contract は expired の通常項目(daysLeft -30)', () => {
    // Arrange / Act: 今年度の現任教育は済み
    const result = renewals([person([BAD, OK_CONTRACT], [2026])], REF)
    // Assert: invalid の contract 項目は出ない
    expect(result).toEqual([
      { personId: 'p-emp', kind: 'contract', dueOn: '2026-11-01', daysLeft: -30, urgency: 'expired' },
    ])
  })

  it('a_対_不正な雇用の順序を入れ替えても同じ結果', () => {
    // Arrange / Act
    const result = renewals([person([OK_CONTRACT, BAD], [2026])], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-emp', kind: 'contract', dueOn: '2026-11-01', daysLeft: -30, urgency: 'expired' },
    ])
  })

  it('b_全件が不正な雇用で今年度未達なら annual_training の invalid 項目', () => {
    // Arrange / Act
    const result = renewals([person([BAD], [2025])], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-emp', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('b_不正な雇用が1件だけ(他は有効)で今年度未達なら annual_training の invalid 項目', () => {
    // Arrange / Act
    const result = renewals([person([BAD, OK_PLAIN], [2025])], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-emp', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('b_対_不正な雇用があっても今年度の現任教育が済んでいれば項目なし', () => {
    // Arrange / Act
    const result = renewals([person([BAD, OK_PLAIN], [2026])], REF)
    // Assert
    expect(result).toEqual([])
  })

  it('c_不正な雇用に契約満了日があるときだけ、その雇用の contract が invalid(dueOn は契約満了日)', () => {
    // Arrange / Act
    const result = renewals([person([{ ...BAD, contractEndOn: '2026-11-20' }], [2026])], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-emp', kind: 'contract', dueOn: '2026-11-20', daysLeft: null, urgency: 'invalid' },
    ])
  })

  it('c_対_不正な雇用に契約満了日がなければ contract の項目は出ない', () => {
    // Arrange / Act
    const result = renewals([person([BAD], [2026])], REF)
    // Assert
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 11. 基準日と新任教育の修了日が同日(REQ-033)
// ─────────────────────────────────────────────────────────────
describe('[REQ-033] 新任教育の修了日が基準日と同日なら修了済み', () => {
  const REF = '2027-03-10' // FY2026。年度末まで 21 日
  const person = (basicDoneOn: string) =>
    mkPerson({
      personId: 'p-same-day',
      employments: [{ companyId: 'c-001', startOn: '2020-01-01' }],
      guardTraining: { basicDoneOn, annualFiscalYears: [] },
    })

  it('sameDay_基準日と同日に修了(今年度に修了)なら現任教育は不要で項目なし', () => {
    // Arrange / Act / Assert
    expect(renewals([person('2027-03-10')], REF)).toEqual([])
  })

  it('sameDay_年度初日 2026-04-01 を基準日にして同日修了でも項目なし', () => {
    // Arrange / Act / Assert
    expect(renewals([person('2026-04-01')], '2026-04-01')).toEqual([])
  })

  it('sameDay_対_前年度(2026-03-31)に修了していれば今年度の現任教育が未達として出る(21日後)', () => {
    // Arrange / Act
    const result = renewals([person('2026-03-31')], REF)
    // Assert
    expect(result).toEqual([
      { personId: 'p-same-day', kind: 'annual_training', dueOn: '2027-03-31', daysLeft: 21, urgency: 'soon' },
    ])
  })

  it('sameDay_対_基準日の翌日に修了(基準日時点で未修了)なら項目なし', () => {
    // Arrange / Act / Assert
    expect(renewals([person('2027-03-11')], REF)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// 12. 確認者のゼロ幅文字(REQ-034 v2.19)
// ─────────────────────────────────────────────────────────────
describe('[REQ-034] 確認者がゼロ幅文字・空白だけなら記録なし', () => {
  const withBy = (confirmedBy: string) =>
    mkJob({ needsBoundaryCheck: true, boundaryCheck: { confirmedBy, confirmedOn: '2026-04-10' } })

  it.each([
    ['U+200B', '​'],
    ['U+200C', '‌'],
    ['U+200D', '‍'],
    ['U+2060', '⁠'],
    ['U+FEFF', '﻿'],
    ['5種の連続', '​‌‍⁠﻿'],
    ['同一文字の連続', '​​​'],
    ['ゼロ幅文字と空白の混在', '​ ‌\t⁠　﻿\n'],
  ])('zeroWidth_%s だけの確認者は公開拒否 [boundary_not_confirmed]', (_l, by) => {
    // Arrange / Act / Assert
    expect(pubReasons(withBy(by))).toEqual(['boundary_not_confirmed'])
  })

  it.each([
    ['U+200B', '​'],
    ['U+FEFF', '﻿'],
    ['5種の連続', '​‌‍⁠﻿'],
    ['ゼロ幅文字と空白の混在', '​ ‌\t⁠　﻿\n'],
  ])('zeroWidth_%s だけの確認者は応募も boundary_not_confirmed', (_l, by) => {
    // Arrange / Act
    const result = checkEligibility(mkPerson(), withBy(by), [])
    // Assert
    expect(result.eligible).toBe(false)
    expect(reasonsOf(result)).toContain('boundary_not_confirmed')
  })

  it('zeroWidth_対_ゼロ幅文字を含んでも可視文字がある確認者(山\\u200B田)は記録あり', () => {
    // Arrange
    const job = withBy('山​田')
    // Act
    const result = checkEligibility(mkPerson(), job, [])
    // Assert
    expect(pubReasons(job)).toEqual([])
    expect(result.reasons).toEqual([])
    expect(result.eligible).toBe(true)
  })
})
