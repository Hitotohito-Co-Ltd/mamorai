// [個人情報の閲覧] 本社PC・管理者・支店（company_*）と現場PC（sitepc_*）。見ると本人以外の閲覧として記録される（0414/0415）。
//   DB未接続のデモでは、勤務員アプリが保存した個人情報は見られない（同じ端末の別アプリのため）。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { siteRpc } from '../../shared/secureRpc.js'
import type { Profile } from '../../pwa/profileApi.js'

export type ProfileRealm = 'company' | 'site'
export interface StaffListItem {
  staff_no: string; name: string; is_active: boolean; sites: string[]
  has_profile: boolean; has_face: boolean; credential_count: number; expired_count: number; soon_count: number
}
export interface ViewLogItem { viewer_kind: 'hq' | 'site'; viewer: string | null; what: 'profile' | 'face' | 'credential'; viewed_at: string }
export interface ViewedImage { mime: string; base64: string }

const NO_DB = '本番DBに接続していないため、個人情報は表示できません（デモ表示）'

async function companyRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase()!.rpc(fn, args)
  if (error !== null) throw new Error(error.message)
  return data as T
}

export async function listCompanyStaff(): Promise<StaffListItem[]> {
  if (!isSupabaseConfigured()) throw new Error(NO_DB)
  return await companyRpc<StaffListItem[]>('company_list_staff')
}

export async function fetchStaffProfile(realm: ProfileRealm, staffNo: string): Promise<Profile> {
  if (!isSupabaseConfigured()) throw new Error(NO_DB)
  return realm === 'site'
    ? await siteRpc<Profile>('sitepc_staff_profile', { p_staff_no: staffNo })
    : await companyRpc<Profile>('company_staff_profile', { p_staff_no: staffNo })
}

export async function fetchStaffImage(realm: ProfileRealm, staffNo: string, kind: 'face' | 'credential', credentialId: string | null): Promise<ViewedImage | null> {
  if (!isSupabaseConfigured()) throw new Error(NO_DB)
  const args = { p_staff_no: staffNo, p_kind: kind, p_credential_id: credentialId }
  return realm === 'site'
    ? await siteRpc<ViewedImage | null>('sitepc_staff_image', args)
    : await companyRpc<ViewedImage | null>('company_staff_image', args)
}

/** 閲覧記録（管理者だけ）。 */
export async function fetchViewLog(staffNo: string): Promise<ViewLogItem[]> {
  if (!isSupabaseConfigured()) throw new Error(NO_DB)
  return await companyRpc<ViewLogItem[]>('company_staff_view_log', { p_staff_no: staffNo })
}
