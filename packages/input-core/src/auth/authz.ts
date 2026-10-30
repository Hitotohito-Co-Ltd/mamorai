// [Auth] ロール別アクセス制御（純粋・UI/DB非依存）。
// 3コンソールはそれぞれ独立した機能セットを持つ（積み上げ式ではない）:
//   - 運営(platform_admin): 会社管理・契約状況・アプリ/運営管理。シフト/日報/労務等は持たない。
//   - 現場(site_operator): 日報/月報/シフト/配置表/労務/通知/教育＋有給申請/講習会参加申込 など運用ほぼ全て。
//   - 会社(company_admin/manager): 労務情報(ルール)追加・通知/情報提供・有給申請確認・教育情報・講習会の登録/カレンダー/案内。
// UIのタブ出し分けと APIゲートウェイ認可の単一の真実。

export type AuthRole =
  | 'site_operator'   // 施設(現場)
  | 'company_manager' // 会社 権限者
  | 'company_admin'   // 会社 本社管理者
  | 'platform_admin'  // 運営(TRYANGROW)

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
  | 'jyoban_settings'    // 上番報告の設定（勤務枠・締切・QR発行）— 本社のみ
  | 'company_management' // 会社管理（運営）
  | 'contract_status'    // 契約状況（運営）
  | 'ops_dashboard'      // 運営ダッシュボード（運営）
  | 'security_check'     // セキュリティチェック（運営）
  | 'platform_notice'    // お知らせ配信 バージョン/セキュリティ/メンテ（運営）
  | 'platform_admin'     // 運営コンソール(アプリ/運営管理)

// ── コンソール別 機能セット ──
/** 現場(施設): 運用ほぼ全て＋有給申請・講習会参加申込 */
const SITE: Capability[] = [
  'dashboard', 'staff_register', 'daily_report', 'monthly', 'report_list', 'report_import', 'output',
  'shift', 'assignment', 'placement', 'ai_shift', 'labor', 'risk', 'notify', 'education', 'edu_docs',
  'leave_site_approval', 'training_site_approval',
]
/** 会社: 管理・設定・確認（日報入力やシフト作成は現場が実施） */
const COMPANY: Capability[] = [
  'leave_approval', 'training_manage', 'education', 'edu_docs', 'constraint', 'template', 'notify',
  'jyoban_settings',
]
/** 運営(TRYANGROW): 運営ダッシュボード・会社管理・契約・セキュリティチェック・お知らせ配信のみ（現場業務は持たない） */
const PLATFORM: Capability[] = [
  'ops_dashboard', 'company_management', 'contract_status', 'security_check', 'platform_notice', 'platform_admin',
]

/** ロールが利用できる capability の一覧（コンソールごとに独立）。 */
export function capabilitiesForRole(role: AuthRole): Capability[] {
  switch (role) {
    case 'site_operator': return [...SITE]
    case 'company_manager':
    case 'company_admin': return [...COMPANY]
    case 'platform_admin': return [...PLATFORM]
  }
}

/** ロールが特定 capability にアクセスできるか。 */
export function canAccess(role: AuthRole, cap: Capability): boolean {
  return capabilitiesForRole(role).includes(cap)
}
