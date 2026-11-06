// [上番報告] 未報告コール（起床・出発・上番・下番）の本社側設定。
//   会社全体の通知設定 / 勤務枠ごとの担当者と電話番号 / 送信記録の閲覧。
//   Supabase構成時は 0409 の RLS・会社RPC、未構成時は localStorage（デモ）。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'

export interface NotifySettings {
  enabled: boolean
  emailTo: string[]
  push: boolean
  sms: boolean
  voice: boolean
  remindAfterMin: number
  voiceAfterMin: number
  escalateAfterMin: number
}
export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: true, emailTo: [], push: true, sms: false, voice: false, remindAfterMin: 0, voiceAfterMin: 5, escalateAfterMin: 10,
}

export interface SlotStaff { staffId: string; staffNo: string; name: string; phone: string | null; assigned: boolean; hasPush: boolean }

export interface NotificationLog {
  id: string; slotId: string; workDate: string; reportType: string; step: string; channel: string
  status: string; detail: string | null; createdAt: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^(\+[1-9][0-9]{7,14}|0[0-9]{9,10})$/

/** 入力チェック（保存前・DB制約と同じ範囲） */
export function validateNotify(s: NotifySettings): string[] {
  const out: string[] = []
  if (s.emailTo.length > 10) out.push('メールの宛先は10件までです')
  const bad = s.emailTo.filter((e) => !EMAIL_RE.test(e))
  if (bad.length > 0) out.push(`メールアドレスの形式が正しくありません: ${bad.join(', ')}`)
  if (s.remindAfterMin < 0 || s.remindAfterMin > 60) out.push('本人へのお知らせは0〜60分で指定してください')
  if (s.voiceAfterMin < 0 || s.voiceAfterMin > 120) out.push('電話は0〜120分で指定してください')
  if (s.escalateAfterMin < 0 || s.escalateAfterMin > 180) out.push('管制へのメールは0〜180分で指定してください')
  return out
}

/** 電話番号を保存用に正規化（ハイフン・空白・括弧を除く）。空なら null、形式違いは例外 */
export function normalizePhone(v: string): string | null {
  const p = v.replace(/[-\s()]/g, '')
  if (p === '') return null
  if (!PHONE_RE.test(p)) throw new Error('電話番号の形式が正しくありません（例: 090-1234-5678）')
  return p
}

/** 「a@x.jp, b@y.jp」→ 配列 */
export function parseEmails(v: string): string[] {
  return [...new Set(v.split(/[\s,、;]+/).map((x) => x.trim()).filter((x) => x !== ''))]
}

const DB = (): boolean => isSupabaseConfigured()
function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// ── デモ ──
const KEY = 'mamorai.jyoban.calls.v1'
interface Local { settings: NotifySettings; staff: SlotStaff[]; assign: Record<string, string[]>; phones: Record<string, string | null> }
const DEMO_STAFF: SlotStaff[] = [
  { staffId: 'demo-st-1', staffNo: '10234', name: '笠井 大輔', phone: '09012345678', assigned: false, hasPush: true },
  { staffId: 'demo-st-2', staffNo: '10251', name: '大島 由紀', phone: null, assigned: false, hasPush: false },
  { staffId: 'demo-st-3', staffNo: '10307', name: '日高 翔', phone: '08055550123', assigned: false, hasPush: false },
]
function readLocal(): Local {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw) return JSON.parse(raw) as Local
  } catch { /* ignore */ }
  return { settings: { ...DEFAULT_NOTIFY }, staff: DEMO_STAFF, assign: {}, phones: {} }
}
function writeLocal(s: Local): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

// ── 通知設定 ──
interface SettingsRow {
  company_id: string; enabled: boolean; email_to: string[]; push_enabled: boolean; sms_enabled: boolean; voice_enabled: boolean
  remind_after_min: number; voice_after_min: number; escalate_after_min: number
}
const settingsFrom = (r: SettingsRow): NotifySettings => ({
  enabled: r.enabled, emailTo: r.email_to ?? [], push: r.push_enabled, sms: r.sms_enabled, voice: r.voice_enabled,
  remindAfterMin: r.remind_after_min, voiceAfterMin: r.voice_after_min, escalateAfterMin: r.escalate_after_min,
})

/** 会社の通知設定。未作成なら null（＝まだ通知しない） */
export async function getNotifySettings(): Promise<NotifySettings | null> {
  if (DB()) {
    const { data, error } = await getSupabase()!.from('jyoban_notify_settings').select('*').maybeSingle()
    fail(error)
    return data ? settingsFrom(data as SettingsRow) : null
  }
  return readLocal().settings
}

export async function saveNotifySettings(s: NotifySettings): Promise<void> {
  const errs = validateNotify(s)
  if (errs.length > 0) throw new Error(errs.join(' / '))
  const row = {
    enabled: s.enabled, email_to: s.emailTo, push_enabled: s.push, sms_enabled: s.sms, voice_enabled: s.voice,
    remind_after_min: s.remindAfterMin, voice_after_min: s.voiceAfterMin, escalate_after_min: s.escalateAfterMin,
    updated_at: new Date().toISOString(),
  }
  if (DB()) {
    const sb = getSupabase()!
    const { data: cur, error: e1 } = await sb.from('jyoban_notify_settings').select('company_id').maybeSingle()
    fail(e1)
    const { error } = cur
      ? await sb.from('jyoban_notify_settings').update(row).eq('company_id', (cur as { company_id: string }).company_id)
      : await sb.from('jyoban_notify_settings').insert(row) // company_id は app_company_id() が既定値
    fail(error)
    return
  }
  const l = readLocal(); l.settings = { ...s }; writeLocal(l)
}

// ── 勤務枠の担当者 ──
export async function listSlotStaff(slotId: string): Promise<SlotStaff[]> {
  if (DB()) {
    const { data, error } = await getSupabase()!.rpc('company_list_slot_staff', { p_slot_id: slotId })
    fail(error)
    return ((data as { staff_id: string; staff_no: string; name: string; phone: string | null; assigned: boolean; has_push: boolean }[]) ?? [])
      .map((r) => ({ staffId: r.staff_id, staffNo: r.staff_no, name: r.name, phone: r.phone, assigned: r.assigned, hasPush: r.has_push }))
  }
  const l = readLocal()
  const set = new Set(l.assign[slotId] ?? [])
  return l.staff.map((x) => ({ ...x, phone: x.staffId in l.phones ? l.phones[x.staffId]! : x.phone, assigned: set.has(x.staffId) }))
}

export async function setSlotStaff(slotId: string, staffIds: string[]): Promise<void> {
  if (DB()) {
    const { error } = await getSupabase()!.rpc('company_set_slot_staff', { p_slot_id: slotId, p_staff_ids: staffIds })
    fail(error)
    return
  }
  const l = readLocal(); l.assign[slotId] = [...staffIds]; writeLocal(l)
}

export async function setStaffPhone(staffId: string, phone: string): Promise<string | null> {
  const p = normalizePhone(phone)
  if (DB()) {
    const { error } = await getSupabase()!.rpc('company_set_staff_phone', { p_staff_id: staffId, p_phone: p })
    fail(error)
    return p
  }
  const l = readLocal(); l.phones[staffId] = p; writeLocal(l)
  return p
}

// ── 送信記録（直近） ──
export async function listNotifications(limit = 30): Promise<NotificationLog[]> {
  if (!DB()) return []
  const { data, error } = await getSupabase()!.from('jyoban_notifications')
    .select('id, slot_id, work_date, report_type, step, channel, status, detail, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  fail(error)
  return ((data as { id: string; slot_id: string; work_date: string; report_type: string; step: string; channel: string; status: string; detail: string | null; created_at: string }[]) ?? [])
    .map((r) => ({ id: r.id, slotId: r.slot_id, workDate: r.work_date, reportType: r.report_type, step: r.step, channel: r.channel, status: r.status, detail: r.detail, createdAt: r.created_at }))
}
