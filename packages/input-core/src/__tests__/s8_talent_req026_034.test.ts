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
