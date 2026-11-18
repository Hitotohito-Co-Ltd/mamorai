// [勤務員PWA] ログイン。Supabase構成時は staff_login/staff_change_pin RPC、未構成時は staffStore。
// 初期PINは生年月日(MMDD)。初回ログイン時に変更を強制（pinMustChange）。
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { siteCodes } from '../shared/runtimeCtx.js'
import { SITE } from '../pilot/bulgari.js'
import { authStaff, changePin as storeChangePin } from '../shared/staffStore.js'

export interface Staff {
  no: string
  name: string
  dob: string
  dept: string
  sites: string[]
  pinMustChange?: boolean
}

/** スタッフNo＋PINでログイン。 */
export async function signInStaff(no: string, pin: string): Promise<Staff | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase()!.rpc('staff_login', {
      p_company_code: siteCodes().companyCode, p_staff_no: no, p_pin: pin,
    })
    if (error) return null
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return null
    return { no, name: row.name as string, dob: '', dept: (row.dept as string) ?? '', sites: [SITE.name], pinMustChange: Boolean(row.must_change) }
  }
  const s = authStaff(no, pin)
  return s ? { no: s.no, name: s.name, dob: s.dob, dept: s.dept, sites: [s.site], pinMustChange: s.pinMustChange } : null
}

/** PIN変更（初回・任意）。DB時は旧PIN照合、未構成時はローカル更新。 */
export async function changeStaffPin(no: string, oldPin: string, newPin: string): Promise<void> {
  if (isSupabaseConfigured()) {
    // 0411 から失敗は戻り値（文言）で返る。旧版の例外にも対応
    const { data, error } = await getSupabase()!.rpc('staff_change_pin', {
      p_company_code: siteCodes().companyCode, p_staff_no: no, p_old_pin: oldPin, p_new_pin: newPin,
    })
    if (error) throw new Error(error.message)
    if (typeof data === 'string' && data !== '') throw new Error(data)
    return
  }
  storeChangePin(no, newPin)
}
