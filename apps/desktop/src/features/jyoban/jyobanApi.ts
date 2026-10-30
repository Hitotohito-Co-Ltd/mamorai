// [上番報告] 設定のデータ層。Supabase構成時は 0406 の会社RPC/RLS、未構成時は localStorage（デモ）に委譲。
//   会社(/co)専用: 現場一覧・共用端末の有無・報告用QRトークン発行・勤務枠の保存/停止。
//   入力値の検証は @mamorai/input-core（validateJyobanSlot）が単一の真実。
import { validateJyobanSlot, type JyobanSlot, type SlotFieldError } from '@mamorai/input-core'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'

export interface JyobanSite {
  id: string
  name: string
  code: string
  dept: string
  isActive: boolean
  reportToken: string | null
  tokenIssuedAt: string | null
  sharedDevice: boolean
  slotCount: number
}

export class JyobanValidationError extends Error {
  constructor(public readonly errors: SlotFieldError[]) { super(errors.map((e) => e.message).join(' / ')) }
}

const DB = (): boolean => isSupabaseConfigured()

// ── DB 行 ⇔ モデル ──
interface SiteRow {
  site_id: string; name: string; code: string; dept: string | null; is_active: boolean
  report_token: string | null; report_token_issued_at: string | null; shared_device_enabled: boolean; slot_count: number
}
interface SlotRow {
  id: string; site_id: string; name: string; work_start: string; work_end: string
  departure_required: boolean; departure_due: string | null; onduty_required: boolean; onduty_due: string | null
  grace_min: number; weekdays: number[]; is_active: boolean; sort_order: number
}
const siteFrom = (r: SiteRow): JyobanSite => ({
  id: r.site_id, name: r.name, code: r.code, dept: r.dept ?? '', isActive: r.is_active,
  reportToken: r.report_token, tokenIssuedAt: r.report_token_issued_at, sharedDevice: r.shared_device_enabled, slotCount: r.slot_count,
})
const slotFrom = (r: SlotRow): JyobanSlot => ({
  id: r.id, siteId: r.site_id, name: r.name, workStart: r.work_start, workEnd: r.work_end,
  departureRequired: r.departure_required, departureDue: r.departure_due, ondutyRequired: r.onduty_required, ondutyDue: r.onduty_due,
  graceMin: r.grace_min, weekdays: r.weekdays, isActive: r.is_active,
})
const slotTo = (s: JyobanSlot, sortOrder: number): Omit<SlotRow, 'id'> => ({
  site_id: s.siteId, name: s.name.trim(), work_start: s.workStart, work_end: s.workEnd,
  departure_required: s.departureRequired, departure_due: s.departureRequired ? s.departureDue : null,
  onduty_required: s.ondutyRequired, onduty_due: s.ondutyRequired ? s.ondutyDue : null,
  grace_min: s.graceMin, weekdays: [...s.weekdays].sort((a, b) => a - b), is_active: s.isActive, sort_order: sortOrder,
})

// ── ローカル（デモ）ストア ──
const KEY = 'mamorai.jyoban.v1'
interface LocalState { sites: JyobanSite[]; slots: (JyobanSlot & { sortOrder: number })[] }
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** デモ初期値: 上番データ(2026.10)の2現場。 */
function seed(): LocalState {
  return {
    sites: [
      { id: 'demo-lala', name: 'ららぽーと立川立飛', code: 'LALA-01', dept: '交通', isActive: true, reportToken: null, tokenIssuedAt: null, sharedDevice: true, slotCount: 2 },
      { id: 'demo-coa', name: 'コーチャンフォー若葉台店', code: 'COA-01', dept: '施設', isActive: true, reportToken: null, tokenIssuedAt: null, sharedDevice: false, slotCount: 1 },
    ],
    slots: [
      { id: 'demo-lala-1', siteId: 'demo-lala', name: '日勤1（荷捌）', workStart: '08:00', workEnd: '17:00', departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '07:45', graceMin: 5, weekdays: ALL_DAYS, isActive: true, sortOrder: 0 },
      { id: 'demo-lala-2', siteId: 'demo-lala', name: '日勤2（隊長）', workStart: '09:30', workEnd: '18:30', departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '09:15', graceMin: 5, weekdays: ALL_DAYS, isActive: true, sortOrder: 1 },
      { id: 'demo-coa-1', siteId: 'demo-coa', name: '早番', workStart: '08:15', workEnd: '15:00', departureRequired: true, departureDue: '06:30', ondutyRequired: true, ondutyDue: '08:15', graceMin: 5, weekdays: ALL_DAYS, isActive: true, sortOrder: 0 },
    ],
  }
}
function readLocal(): LocalState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw) return JSON.parse(raw) as LocalState
  } catch { /* ignore */ }
  return seed()
}
function writeLocal(s: LocalState): void {
  for (const site of s.sites) site.slotCount = s.slots.filter((x) => x.siteId === site.id && x.isActive).length
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
/** デモ用のURL安全なトークン（本番はDB側 gen_random_bytes で発行）。 */
function demoToken(): string {
  const bytes = new Uint8Array(18)
  globalThis.crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fail(error: { message: string } | null): void {
  if (error !== null) throw new Error(error.message)
}

// ── 公開API ──
export async function listSites(): Promise<JyobanSite[]> {
  if (DB()) {
    const { data, error } = await getSupabase()!.rpc('company_list_jyoban_sites')
    fail(error)
    return ((data as SiteRow[]) ?? []).map(siteFrom)
  }
  const s = readLocal()
  writeLocal(s)
  return s.sites
}

export async function listSlots(siteId: string): Promise<JyobanSlot[]> {
  if (DB()) {
    const { data, error } = await getSupabase()!.from('jyoban_slots').select('*').eq('site_id', siteId).order('sort_order')
    fail(error)
    return ((data as SlotRow[]) ?? []).map(slotFrom)
  }
  return readLocal().slots.filter((x) => x.siteId === siteId).sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _o, ...rest }) => rest)
}

/** 勤務枠を作成/更新。新規は id を空文字で渡す。検証エラーは JyobanValidationError。 */
export async function saveSlot(slot: JyobanSlot, sortOrder: number): Promise<JyobanSlot> {
  const errors = validateJyobanSlot(slot)
  if (errors.length > 0) throw new JyobanValidationError(errors)
  const row = slotTo(slot, sortOrder)
  if (DB()) {
    const sb = getSupabase()!
    const q = slot.id === ''
      ? sb.from('jyoban_slots').insert(row).select('*').single()
      : sb.from('jyoban_slots').update(row).eq('id', slot.id).select('*').single()
    const { data, error } = await q
    fail(error)
    return slotFrom(data as SlotRow)
  }
  const s = readLocal()
  const saved: JyobanSlot & { sortOrder: number } = { ...slotFrom({ id: slot.id === '' ? `local-${demoToken()}` : slot.id, ...row }), sortOrder }
  const i = s.slots.findIndex((x) => x.id === saved.id)
  if (i >= 0) s.slots[i] = saved
  else s.slots.push(saved)
  writeLocal(s)
  const { sortOrder: _o, ...out } = saved
  return out
}

/** 報告用QRトークンを発行/再発行（旧トークンは即無効）。 */
export async function issueReportToken(siteId: string): Promise<string> {
  if (DB()) {
    const { data, error } = await getSupabase()!.rpc('company_issue_report_token', { p_site_id: siteId })
    fail(error)
    return String(data)
  }
  const s = readLocal()
  const site = s.sites.find((x) => x.id === siteId)
  if (site === undefined) throw new Error('現場が見つかりません')
  site.reportToken = demoToken()
  site.tokenIssuedAt = new Date().toISOString()
  writeLocal(s)
  return site.reportToken
}

export async function setSharedDevice(siteId: string, enabled: boolean): Promise<void> {
  if (DB()) {
    const { error } = await getSupabase()!.rpc('company_set_shared_device', { p_site_id: siteId, p_enabled: enabled })
    fail(error)
    return
  }
  const s = readLocal()
  const site = s.sites.find((x) => x.id === siteId)
  if (site !== undefined) site.sharedDevice = enabled
  writeLocal(s)
}

/** QRに載せるURLの基点（未設定ならこのコンソールのオリジン）。 */
export function publicOrigin(): string {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>
  return env.VITE_PUBLIC_ORIGIN ?? globalThis.location?.origin ?? ''
}
