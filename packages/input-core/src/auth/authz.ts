// [Auth] ロール別アクセス制御（純粋・UI/DB非依存）。
// ロール（2026-11 改訂）:
//   現場PC(site_operator) / 本社PC(hq_operator) / 支店・権限者(company_manager) / 管理者(company_admin)
//   / 教育センター(education_center) / 運営(platform_admin)
// 各コンソールはそれぞれ独立した機能セットを持つ（積み上げ式ではない）:
//   - 運営(platform_admin): 会社管理・契約状況・アプリ/運営管理。シフト/日報/労務等は持たない。
//   - 現場(site_operator): 日報/月報/シフト/配置表/労務/通知/教育＋有給申請/講習会参加申込 など運用ほぼ全て。
//   - 会社(company_admin/manager): 労務情報(ルール)追加・通知/情報提供・有給申請確認・教育情報・講習会の登録/カレンダー/案内。
// UIのタブ出し分けと APIゲートウェイ認可の単一の真実。

export type AuthRole =
  | 'site_operator'    // 現場PC（施設。会社コード＋施設コード＋現場PINの共有端末）
  | 'hq_operator'      // 本社PC（上下番の受付・未報告の対応。設定は変えない）
  | 'company_manager'  // 支店・権限者（担当現場の確認・承認）
  | 'company_admin'    // 管理者（会社の設定・アカウントと権限の管理）
  | 'education_center' // 教育センター（新任・現任教育の日程・申込の受付・受講記録）
  | 'platform_admin'   // 運営(TRYANGROW)

/** 画面に出すロール名。 */
export const ROLE_LABEL: Record<AuthRole, string> = {
  site_operator: '現場PC',
  hq_operator: '本社PC',
  company_manager: '支店・権限者',
  company_admin: '管理者',
  education_center: '教育センター',
  platform_admin: '運営（TRYANGROW）',
}

/** 会社のメールアカウントに割り当てられるロール（現場PCは施設コード＋PIN、運営は別入口）。 */
export const COMPANY_ACCOUNT_ROLES: readonly AuthRole[] = ['hq_operator', 'company_manager', 'company_admin', 'education_center']

/** 機能カテゴリ（タブ/APIの認可単位） */
export type Capability =
  | 'dashboard'
  | 'daily_report'       // 日報入力
  | 'output'             // 成果物出力(配置予定表/配置表/月次報告書)
  | 'monthly'            // 月報
  | 'report_list'        // 日報一覧
  | 'report_import'      // 過去日報の取込・データ化(リスク/事案蓄積)
  | 'risk'               // リスク
  | 'shift'              // シフト
  | 'assignment'         // 配置表(日次)
  | 'placement'          // 配置予定表/配置表(月間・日報実績)
  | 'ai_shift'           // AIシフト最適化
  | 'labor'              // 労務アラート(法令リスク)
  | 'notify'             // 通知 / 情報提供
  | 'education'          // 教育・資格
  | 'edu_docs'           // 教育指導6点セット（計画/実施簿/是正/個別/改善/台帳）
  | 'constraint'         // 労務情報・ルール(制約)の追加/調整
  | 'template'           // テンプレ設定
  | 'leave_request'      // 有給申請（現場代理・任意）
  | 'leave_site_approval'// 有給申請の一次承認（現場）
  | 'leave_approval'     // 有給申請の最終確認/承認（会社）
  | 'staff_register'     // 勤務員登録（現場）
  | 'training_apply'     // 講習会・研修の参加申込（勤務員PWA）
  | 'training_site_approval' // 講習会申込の一次承認（現場）
  | 'training_manage'    // 講習会の登録/カレンダー/案内・受理（会社）
  | 'jyoban_settings'    // 上番報告の設定（勤務枠・締切・QR発行）— 管理者・支店
  | 'jyoban_board'       // 上番報告 本日の現場一覧（報告の確認・未報告の対応）
  | 'role_management'    // アカウントと権限（会社のメンバーへのロール割当）— 管理者のみ
  | 'company_management' // 会社管理（運営）
  | 'contract_status'    // 契約状況（運営）
  | 'ops_dashboard'      // 運営ダッシュボード（運営）
  | 'security_check'     // セキュリティチェック（運営）
  | 'platform_notice'    // お知らせ配信 バージョン/セキュリティ/メンテ（運営）
  | 'platform_admin'     // 運営コンソール(アプリ/運営管理)

// ── コンソール別 機能セット ──
/** 現場(施設): 運用ほぼ全て＋有給申請・講習会参加申込 */
const SITE: Capability[] = [
  'dashboard', 'jyoban_board', 'staff_register', 'daily_report', 'monthly', 'report_list', 'report_import', 'output',
  'shift', 'assignment', 'placement', 'ai_shift', 'labor', 'risk', 'notify', 'education', 'edu_docs',
  'leave_site_approval', 'training_site_approval',
]
/** 本社PC: 上下番の受付と未報告の対応・お知らせ。設定やアカウントは触らない */
const HQ: Capability[] = ['jyoban_board', 'notify']
/** 支店・権限者: 担当現場の上番確認・承認・設定（日報入力やシフト作成は現場が実施） */
const MANAGER: Capability[] = [
  'jyoban_board', 'leave_approval', 'training_manage', 'education', 'edu_docs', 'constraint', 'template', 'notify',
  'jyoban_settings',
]
/** 管理者: 支店・権限者の機能＋アカウントと権限の管理 */
const ADMIN: Capability[] = [...MANAGER, 'role_management']
/** 教育センター: 新任・現任教育の日程・申込の受付・受講記録・教育指導簿 */
const EDUCATION: Capability[] = ['training_manage', 'education', 'edu_docs', 'notify']
/** 運営(TRYANGROW): 運営ダッシュボード・会社管理・契約・セキュリティチェック・お知らせ配信のみ（現場業務は持たない） */
const PLATFORM: Capability[] = [
  'ops_dashboard', 'company_management', 'contract_status', 'security_check', 'platform_notice', 'platform_admin',
]

/** ロールが利用できる capability の一覧（コンソールごとに独立）。 */
export function capabilitiesForRole(role: AuthRole): Capability[] {
  switch (role) {
    case 'site_operator': return [...SITE]
    case 'hq_operator': return [...HQ]
    case 'company_manager': return [...MANAGER]
    case 'company_admin': return [...ADMIN]
    case 'education_center': return [...EDUCATION]
    case 'platform_admin': return [...PLATFORM]
  }
}

/** ロールが特定 capability にアクセスできるか。 */
export function canAccess(role: AuthRole, cap: Capability): boolean {
  return capabilitiesForRole(role).includes(cap)
}

/** データを見られる範囲。company=会社全体 / assigned=担当現場のみ / site=ログインした現場のみ / platform=全社。 */
export type RoleScope = 'company' | 'assigned' | 'site' | 'platform'

export function scopeForRole(role: AuthRole): RoleScope {
  switch (role) {
    case 'site_operator': return 'site'
    case 'company_manager': return 'assigned'
    case 'hq_operator':
    case 'company_admin':
    case 'education_center': return 'company'
    case 'platform_admin': return 'platform'
  }
}

/** 文字列がロールか（DB や URL から来た値の検証用）。 */
export function isAuthRole(v: unknown): v is AuthRole {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROLE_LABEL, v)
}
