// [Auth] 3系統ログインの共通型。実認証(Supabase Auth/MFA)は本結線フェーズ。
export type Realm = 'company' | 'site' | 'tradmin'

// ロールの定義と表示名・権限は input-core（authz.ts）が唯一の正。ここでは型を受け継ぐだけ。
import type { AuthRole } from '@mamorai/input-core'
export type Role = AuthRole

/** ログイン成功後のセッション（デモ）。scope で RLS 相当の可視範囲を表す。 */
export interface Session {
  realm: Realm
  role: Role
  companyCode?: string
  siteCode?: string
  email?: string
  /** データ可視範囲: 会社全体 / 担当現場のみ（支店・権限者）/ 単一現場 / プラットフォーム全体 */
  scope: 'company' | 'assigned' | 'site' | 'platform'
  /** 複数現場を担当する社員/役員の担当現場一覧（担当外は含めない）。 */
  assignedSites?: string[]
  label: string
}

/** 会社識別コードの形式（例 TRA-8821）。英大文字3+ハイフン+数字4。 */
export function isValidCompanyCode(code: string): boolean {
  return /^[A-Z]{2,4}-\d{3,5}$/.test(code.trim())
}

/** 施設(現場)コードの形式（例 LALA-01）。英数2以上+ハイフン+数字1以上。 */
export function isValidSiteCode(code: string): boolean {
  return /^[A-Z0-9]{2,8}-\d{1,3}$/.test(code.trim())
}

/** メール形式の簡易判定。 */
export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/** 現場PIN: 4〜8桁の数字。 */
export function isValidPin(v: string): boolean {
  return /^\d{4,8}$/.test(v.trim())
}
