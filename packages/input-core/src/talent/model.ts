// [TLN] 人材基盤: スタッフ台帳・案件・応募の型（純粋・決定論／日付は 'YYYY-MM-DD'、時刻は 'HH:MM'）

/** 契約の形。形によって応募できる人・必要な書面・給与の扱いが変わる */
export type ContractForm = 'security' | 'dispatch' | 'spot' | 'referral'

/** 配置の決め方 */
export type PlacementMode = 'assign' | 'apply_review' | 'instant'

/** 会社ごとの雇用（既存 staff を「ある会社での雇用」として扱う） */
export interface Employment {
  companyId: string
  /** 入社日・退社日（退社日が無ければ在籍中） */
  startOn: string
  endOn?: string
  /** 雇用契約の満了日（年間契約・有期契約。更新手続きの期限に使う） */
  contractEndOn?: string
}

export interface GuardTraining {
  /** 新任教育の修了日。未修了は undefined */
  basicDoneOn?: string
  /** 現任教育を満たした年度（4月始まり。2026年度=2026） */
  annualFiscalYears: number[]
}

export interface Residence {
  /** 日本国籍など在留カード不要なら undefined */
  workAllowed: boolean
  expiresOn?: string
}

/** 日雇派遣の例外に当たる区分（申告＋証明が必要） */
export type DailyDispatchException = 'age60' | 'day_student' | 'side_job' | 'household_income'

export interface PersonProfile {
  personId: string
  birthDate: string
  /** グループ内での共同利用への同意 */
  consentJointUse: boolean
  employments: Employment[]
  guardTraining: GuardTraining
  residence?: Residence
  dailyDispatchException?: { kind: DailyDispatchException; verifiedOn: string }
}

export interface JobShift {
  date: string
  start: string
  end: string
}

export interface JobPost {
  jobId: string
  employerCompanyId: string
  form: ContractForm
  /** 警備業務か（職種マスタ job_roles.is_security） */
  isSecurityWork: boolean
  nightWork: boolean
  /** 雇用期間（日数）。日雇派遣の30日判定に使う */
  employmentDays: number
  shifts: JobShift[]
  mode: PlacementMode
  /** 運営の枠と警備の枠の線引きを確認した記録（現場責任者・支店） */
  boundaryCheck?: { confirmedBy: string; confirmedOn: string }
  /** 線引きの確認が必要な案件か（整理員など業務内容で判断する職種） */
  needsBoundaryCheck?: boolean
}

/** 本人がすでに入っている別の勤務（重複・通算の判定用） */
export interface BusyShift extends JobShift {
  companyId: string
}

export type EligibilityReason =
  | 'no_consent'
  | 'under_age'
  | 'residence_invalid'
  | 'not_registered'
  | 'security_dispatch_forbidden'
  | 'security_basic_training_missing'
  | 'security_annual_training_missing'
  | 'daily_dispatch_not_allowed'
  | 'time_overlap'
  | 'boundary_not_confirmed'
  | 'no_shifts'
  | 'dispatch_exception_invalid'
  | 'invalid_input'

export interface EligibilityResult {
  eligible: boolean
  /** 管理者向けの理由。スタッフの一覧には出さない */
  reasons: EligibilityReason[]
  /** 応募はできるが注意が必要なこと */
  warnings: Array<'daily_hours_over_8' | 'residence_expiring'>
  /** 警告の計測値。警告が出たときだけ付く */
  details: {
    /** 在留期限の警告が出たときの、全シフト日の最小日数 */
    residenceDaysLeft?: number
    /** 8時間超の警告が出たときの、他社分を含む1日の最大労働時間（時間） */
    maxDailyHours?: number
  }
}
