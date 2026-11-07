// Sprint 8: 応募可否の判定・更新手続き・台帳/案件/応募のDB土台
// REQ-026〜034、NFR-05 の RED テスト
// テスト規約: AAA / describe '[REQ-0xx]' / 日本語 it 名 / 固定日時（Date.now/new Date() 禁止） / 純粋・決定論
// 注意: 実装コード (eligibility.ts / renewal.ts) は読まずに作成（ミラーテスト防止）

import { describe, it, expect } from 'vitest'
import {
  checkEligibility,
  validateJobForPublish,
  listRenewals,
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
    const person = mkPerson({
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

  it('performance_1000人分_結果が配列として返る（性能計測と分離）', () => {
    // Arrange
    const persons = mk1000Persons()
    // Act
    const result = listRenewals(persons, RENEWAL_DATE_FY2026)
    // Assert: 配列であること（結果の正確性は他のテストで確認）
    expect(Array.isArray(result)).toBe(true)
    // i%4===0 (250人, 現任) と i%4===1 (250人, 契約) がヒット → 合計 500 件以上
    expect(result.length).toBeGreaterThanOrEqual(500)
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
