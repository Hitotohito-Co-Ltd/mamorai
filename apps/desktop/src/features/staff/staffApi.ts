// [勤務員] データ層。Supabase構成時は現場RPC(0403)、未構成時は staffStore(localStorage) に委譲。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { siteRpc } from '../../shared/secureRpc.js'
import { SITE, type PilotStaff } from '../../pilot/bulgari.js'
import {
  listStaff as localList, upsertStaff as localUpsert, setActive as localSetActive,
  resetPinToDob as localReset, subscribe as localSubscribe,
} from '../../shared/staffStore.js'

export type Staff = PilotStaff
const DB = (): boolean => isSupabaseConfigured()

interface Row { staff_no: string; name: string; dob: string | null; dept: string | null; role: string | null; pin_current: string | null; pin_must_change: boolean; is_active: boolean }
function fromRow(r: Row): Staff {
  const role = (r.role === '現場責任者' || r.role === '副責任者') ? r.role : '隊員'
  return {
    no: r.staff_no, name: r.name, dob: r.dob ?? '', dept: r.dept ?? SITE.dept, site: SITE.name,
    role, active: r.is_active, pin: r.pin_current ?? undefined, pinMustChange: r.pin_must_change,
  }
}

export async function listStaff(): Promise<Staff[]> {
  if (DB()) {
    const data = await siteRpc<Row[] | null>('sitepc_list_staff')
    return (data ?? []).map(fromRow)
  }
  return localList()
}
export async function upsertStaff(s: Staff): Promise<void> {
  if (DB()) {
    await siteRpc('sitepc_register_staff', {
      p_staff_no: s.no, p_name: s.name, p_dob: s.dob || null, p_dept: s.dept, p_role: s.role, p_pin: s.pin ?? '',
    })
    return
  }
  localUpsert(s)
}
export async function setActive(no: string, active: boolean): Promise<void> {
  if (DB()) { await siteRpc('sitepc_set_staff_active', { p_staff_no: no, p_active: active }); return }
  localSetActive(no, active)
}
export async function resetPin(no: string): Promise<string> {
  if (DB()) { const data = await siteRpc<string | null>('sitepc_reset_pin', { p_staff_no: no }); return String(data ?? '') }
  return localReset(no)
}
/** 一括取込（Excel/CSV）。DB時は順にRPC、未構成時はローカルにupsert。 */
export async function bulkUpsert(list: Staff[]): Promise<number> {
  if (DB()) { for (const s of list) await upsertStaff(s); return list.length }
  list.forEach((s) => localUpsert(s)); return list.length
}
export function subscribe(cb: () => void): () => void {
  if (DB()) {
    const ch = getSupabase()!.channel('staff_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => cb()).subscribe()
    return () => { try { getSupabase()!.removeChannel(ch) } catch { /* ignore */ } }
  }
  return localSubscribe(cb)
}
