// [月次シフト(=配置予定)] データ層。Supabase構成時は現場RPC(0405)、未構成時は shiftStore(localStorage)。
// 現場(/s)が saveShift で保存→配置予定表(Placement)が loadShift で参照。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { siteRpc } from '../../shared/secureRpc.js'
import {
  saveShift as localSave, loadShift as localLoad,
  subscribe as localSubscribe, type ShiftSnapshot,
} from '../../shared/shiftStore.js'

export type { ShiftSnapshot }
const DB = (): boolean => isSupabaseConfigured()

interface Row { ym: string; staff: ShiftSnapshot['staff'] | null; grid: ShiftSnapshot['grid'] | null; saved_at: string | null }
function fromRow(r: Row): ShiftSnapshot {
  return { ym: r.ym, staff: r.staff ?? [], grid: r.grid ?? {}, savedAt: r.saved_at ?? r.ym }
}

/** 現場(/s): 月次シフト(=配置予定)を保存（同一現場・同一月は上書き）。 */
export async function saveShift(s: ShiftSnapshot): Promise<void> {
  if (DB()) {
    await siteRpc('sitepc_save_shift', { p_ym: s.ym, p_staff: s.staff, p_grid: s.grid })
    return
  }
  localSave(s)
}

/** 現場(/s)・配置予定表: 月次シフトを取得。 */
export async function loadShift(ym: string): Promise<ShiftSnapshot | undefined> {
  if (DB()) {
    const rows = (await siteRpc<Row[] | null>('sitepc_load_shift', { p_ym: ym })) ?? []
    return rows.length > 0 ? fromRow(rows[0]!) : undefined
  }
  return localLoad(ym)
}

export function subscribe(cb: () => void): () => void {
  if (DB()) {
    const ch = getSupabase()!.channel('shift_snap_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'shift_snapshots' }, () => cb()).subscribe()
    return () => { try { getSupabase()!.removeChannel(ch) } catch { /* ignore */ } }
  }
  return localSubscribe(cb)
}
