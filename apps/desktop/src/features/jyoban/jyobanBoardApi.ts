// [JYB] 本日の現場一覧のデータ（0413）。
//   会社（本社PC・支店・管理者）: company_jyoban_board / company_jyoban_ack / company_jyoban_void / company_jyoban_add_report
//   現場PC: sitepc_jyoban_*（shared/secureRpc の siteRpc でセッションを付ける）
//   デモ（DB未接続）: 上番報告設定のデモ現場と、勤務員アプリのデモ報告（同じブラウザの localStorage）を使う
import type { BoardReport, CrewRosterMember, JyobanSlot, GeoStatus, JyobanTimedType } from '@mamorai/input-core'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { siteRpc } from '../../shared/secureRpc.js'
import { demoSnapshot } from './jyobanApi.js'

export type BoardRealm = 'company' | 'site'

export interface BoardSlot {
  slot: JyobanSlot
  roster: CrewRosterMember[]
  reports: BoardReport[]
  ack: { at: string; memo: string | null; by: string } | null
}
export interface BoardSite { id: string; name: string; code: string; slots: BoardSlot[] }
export interface BoardData {
  /** 勤務日 'YYYY-MM-DD' */
  date: string
  /** 取得時のサーバ時刻（現地）'YYYY-MM-DDTHH:MM' */
  nowLocal: string
  sites: BoardSite[]
}

interface ReportJson {
  id: string; type: BoardReport['type']; staff_no: string; staff_name: string; phone: string | null
  other_kind: BoardReport['otherKind'] | null; eta: string | null; note: string | null; received_at: string
  voided: boolean; void_reason: string | null; voided_by: string | null; entered_by: string | null; entry_reason: string | null
  geo_status: GeoStatus | null; geo_distance_m: number | null
}
interface SlotJson {
  id: string; site_id: string; name: string; work_start: string; work_end: string
  departure_required: boolean; departure_due: string | null; onduty_required: boolean; onduty_due: string | null
  wakeup_required: boolean; wakeup_due: string | null; offduty_required: boolean; offduty_due: string | null
  grace_min: number; weekdays: number[]; is_active: boolean; required_by_dow: number[] | null
  roster: { staff_no: string; name: string; phone: string | null }[]
  ack: { at: string; memo: string | null; by: string } | null
  reports: ReportJson[]
}
interface BoardJson { date: string; now_local: string; sites: { id: string; name: string; code: string; slots: SlotJson[] }[] }

export function boardFromJson(j: BoardJson): BoardData {
  return {
    date: j.date, nowLocal: j.now_local,
    sites: j.sites.map((s) => ({
      id: s.id, name: s.name, code: s.code,
      slots: s.slots.map((x) => ({
        slot: {
          id: x.id, siteId: x.site_id, name: x.name, workStart: x.work_start, workEnd: x.work_end,
          departureRequired: x.departure_required, departureDue: x.departure_due, ondutyRequired: x.onduty_required, ondutyDue: x.onduty_due,
          wakeupRequired: x.wakeup_required, wakeupDue: x.wakeup_due, offdutyRequired: x.offduty_required, offdutyDue: x.offduty_due,
          graceMin: x.grace_min, weekdays: x.weekdays, isActive: x.is_active, requiredByDow: x.required_by_dow,
        },
        roster: x.roster.map((m) => ({ staffNo: m.staff_no, name: m.name, phone: m.phone })),
        ack: x.ack,
        reports: x.reports.map((r) => ({
          id: r.id, slotId: x.id, workDate: j.date, type: r.type, staffNo: r.staff_no, staffName: r.staff_name, phone: r.phone,
          otherKind: r.other_kind ?? undefined, eta: r.eta ?? undefined, note: r.note ?? undefined, receivedAt: r.received_at,
          voided: r.voided, voidReason: r.void_reason, voidedBy: r.voided_by, enteredBy: r.entered_by, entryReason: r.entry_reason,
          geoStatus: r.geo_status, geoDistanceM: r.geo_distance_m,
        })),
      })),
    })),
  }
}

const DB = (): boolean => isSupabaseConfigured()

async function companyRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase()!.rpc(fn, args)
  if (error !== null) throw new Error(error.message)
  return data as T
}

/** 本日（または指定日）の現場一覧。 */
export async function fetchBoard(realm: BoardRealm, date?: string): Promise<BoardData> {
  if (!DB()) return demoBoard(date)
  const args = { p_date: date ?? null }
  const j = realm === 'site' ? await siteRpc<BoardJson>('sitepc_jyoban_board', args) : await companyRpc<BoardJson>('company_jyoban_board', args)
  return boardFromJson(j)
}

/** 確認済みにする（勤務枠×勤務日で1件）。 */
export async function ackSlot(realm: BoardRealm, slotId: string, date: string, memo: string): Promise<void> {
  if (!DB()) { demoAck(slotId, date, memo); return }
  const args = { p_slot_id: slotId, p_date: date, p_memo: memo || null }
  if (realm === 'site') await siteRpc('sitepc_jyoban_ack', args)
  else await companyRpc('company_jyoban_ack', args)
}

/** 訂正：報告を取り消す（理由必須。記録は残る）。 */
export async function voidBoardReport(realm: BoardRealm, reportId: string, reason: string): Promise<void> {
  if (reason.trim().length < 2) throw new Error('訂正の理由を入力してください')
  if (!DB()) { demoVoid(reportId, reason, realm); return }
  const args = { p_report_id: reportId, p_reason: reason.trim() }
  if (realm === 'site') await siteRpc('sitepc_jyoban_void', args)
  else await companyRpc('company_jyoban_void', args)
}

export interface AddReportInput { slotId: string; date: string; type: JyobanTimedType; staffNo: string; time: string; reason: string }

/** 訂正：後から登録（スマホを忘れた等。理由必須）。 */
export async function addBoardReport(realm: BoardRealm, input: AddReportInput): Promise<void> {
  if (input.reason.trim().length < 2) throw new Error('訂正の理由を入力してください')
  if (!/^\d{1,8}$/.test(input.staffNo.trim())) throw new Error('スタッフNoを入力してください')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('時刻を HH:MM で入力してください')
  if (!DB()) { demoAdd(input, realm); return }
  const args = { p_slot_id: input.slotId, p_date: input.date, p_type: input.type, p_staff_no: input.staffNo.trim(), p_time: input.time, p_reason: input.reason.trim() }
  if (realm === 'site') await siteRpc('sitepc_jyoban_add_report', args)
  else await companyRpc('company_jyoban_add_report', args)
}

// ── デモ（DB未接続） ──
const K_REPORTS = 'mamorai.jyoban.demoReports'   // 勤務員アプリのデモ報告と共有
const K_ACKS = 'mamorai.jyoban.demoAcks'
interface DemoReport extends BoardReport { siteId: string }
const read = <T,>(k: string, f: T): T => { try { const r = globalThis.localStorage?.getItem(k); return r ? (JSON.parse(r) as T) : f } catch { return f } }
const write = (k: string, v: unknown): void => { try { globalThis.localStorage?.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
const pad = (n: number): string => String(n).padStart(2, '0')
function nowLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function demoBoard(date?: string): BoardData {
  const now = nowLocal()
  const day = date ?? now.slice(0, 10)
  const snap = demoSnapshot()
  const reports = read<DemoReport[]>(K_REPORTS, [])
  const acks = read<Record<string, { at: string; memo: string | null; by: string }>>(K_ACKS, {})
  return {
    date: day, nowLocal: now,
    sites: snap.sites.filter((s) => s.isActive).map((s) => ({
      id: s.id, name: s.name, code: s.code,
      slots: snap.slots.filter((x) => x.siteId === s.id && x.isActive).map((slot) => ({
        slot, roster: [],
        ack: acks[`${slot.id}|${day}`] ?? null,
        reports: reports.filter((r) => r.slotId === slot.id && r.workDate === day),
      })),
    })),
  }
}
function demoAck(slotId: string, date: string, memo: string): void {
  const acks = read<Record<string, unknown>>(K_ACKS, {})
  const k = `${slotId}|${date}`
  if (acks[k] === undefined) acks[k] = { at: nowLocal(), memo: memo || null, by: 'デモ' }
  write(K_ACKS, acks)
}
function demoVoid(reportId: string, reason: string, realm: BoardRealm): void {
  const all = read<DemoReport[]>(K_REPORTS, [])
  const r = all.find((x) => x.id === reportId)
  if (r === undefined) throw new Error('報告が見つかりません')
  if (r.voided === true) throw new Error('この報告はすでに取り消されています')
  r.voided = true; r.voidReason = reason.trim(); r.voidedBy = realm === 'site' ? '現場PC（デモ）' : '本社（デモ）'
  write(K_REPORTS, all)
}
function demoAdd(input: AddReportInput, realm: BoardRealm): void {
  const all = read<DemoReport[]>(K_REPORTS, [])
  const slot = demoSnapshot().slots.find((s) => s.id === input.slotId)
  if (slot === undefined) throw new Error('勤務枠が見つかりません')
  if (all.some((r) => r.slotId === input.slotId && r.workDate === input.date && r.type === input.type && r.staffNo === input.staffNo.trim() && r.voided !== true)) {
    throw new Error('この人の同じ報告がすでにあります。誤りなら先に取り消してください')
  }
  all.push({
    id: `demo-${Date.now()}`, siteId: slot.siteId, slotId: input.slotId, workDate: input.date, type: input.type,
    staffNo: input.staffNo.trim(), staffName: `スタッフ${input.staffNo.trim()}`, receivedAt: `${input.date}T${input.time}`,
    enteredBy: realm === 'site' ? '現場PC（デモ）' : '本社（デモ）', entryReason: input.reason.trim(),
  })
  write(K_REPORTS, all)
}
