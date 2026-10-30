// [勤務員PWA・上番報告] データ層。Supabase構成時は 0407 の RPC、未構成時はブラウザ内のデモデータ。
//   端末シークレット（個人スマホの本人登録結果）と送信待ちキュー（オフライン時）を localStorage に保持する。
import {
  resolveWorkDate, validateOtherReport,
  type JyobanSlot, type JyobanReport, type JyobanOtherKind,
} from '@mamorai/input-core'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { authStaff } from '../../shared/staffStore.js'
import { demoSnapshot } from '../../features/jyoban/jyobanApi.js'

export type ReportType = 'departure' | 'onduty' | 'other'
export interface CtxReport extends JyobanReport { id: string }
export interface CtxSlot extends JyobanSlot { workDate: string; reports: CtxReport[] }
export interface ReportContext {
  site: { name: string; dept: string; shared: boolean }
  staff: { no: string; name: string } | null
  /** サーバ時刻（現地）'YYYY-MM-DDTHH:MM' */
  now: string
  slots: CtxSlot[]
}
export interface Device { secret: string; staffNo: string; staffName: string }
export interface SubmitInput {
  slotId: string
  type: ReportType
  otherKind?: JyobanOtherKind
  eta?: string
  note?: string
  /** 共用端末のみ */
  staffNo?: string
  pin?: string
}
export interface SubmitResult { reportId: string; workDate: string; receivedAt: string; duplicate: boolean }

/** 本人確認やPINの誤り（再入力で解決する）。 */
export class ReportAuthError extends Error {}
/** 通信できなかった（送信待ちに回す）。 */
export class NetworkError extends Error {}

const DB = (): boolean => isSupabaseConfigured()
const K_DEVICE = 'mamorai.jyoban.device'
const K_TOKEN = 'mamorai.jyoban.lastToken'
const K_OUTBOX = 'mamorai.jyoban.outbox'
const K_DEMO_REPORTS = 'mamorai.jyoban.demoReports'

function getJson<T>(k: string, fallback: T): T {
  try { const raw = globalThis.localStorage?.getItem(k); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
function setJson(k: string, v: unknown): void {
  try { if (v === null) globalThis.localStorage?.removeItem(k); else globalThis.localStorage?.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

export const loadDevice = (): Device | null => getJson<Device | null>(K_DEVICE, null)
export const saveDevice = (d: Device | null): void => setJson(K_DEVICE, d)
export const lastToken = (): string | null => getJson<string | null>(K_TOKEN, null)
export const rememberToken = (t: string): void => setJson(K_TOKEN, t)

/** パス /app/r/<トークン> からトークンを取り出す（/app/r/ だけなら前回のトークン＝ホーム画面から起動）。 */
export function tokenFromPath(pathname: string): string | null {
  const m = /^\/app\/r\/([A-Za-z0-9_-]{6,64})\/?$/.exec(pathname)
  if (m) return m[1]!
  return lastToken()
}

/** 'YYYY-MM-DDTHH:MM'（端末の現地時刻） */
export function localNow(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function isNetworkMessage(m: string): boolean {
  return /fetch|network|load failed|timeout/i.test(m)
}
function raise(error: { message: string }): never {
  if (isNetworkMessage(error.message) || globalThis.navigator?.onLine === false) throw new NetworkError(error.message)
  throw new Error(error.message)
}

// ── DB 応答 → モデル ──
interface CtxJson {
  site: { name: string; dept: string | null; shared: boolean }
  staff: { no: string; name: string } | null
  now: string
  slots: {
    id: string; name: string; work_start: string; work_end: string; departure_required: boolean; departure_due: string | null
    onduty_required: boolean; onduty_due: string | null; grace_min: number; weekdays: number[]; work_date: string
    reports: { id: string; type: ReportType; other_kind: JyobanOtherKind | null; eta: string | null; staff_no: string; staff_name: string; voided: boolean; received_at: string }[]
  }[]
}
function ctxFrom(j: CtxJson): ReportContext {
  return {
    site: { name: j.site.name, dept: j.site.dept ?? '', shared: j.site.shared },
    staff: j.staff,
    now: j.now,
    slots: j.slots.map((s) => ({
      id: s.id, siteId: '', name: s.name, workStart: s.work_start, workEnd: s.work_end,
      departureRequired: s.departure_required, departureDue: s.departure_due, ondutyRequired: s.onduty_required, ondutyDue: s.onduty_due,
      graceMin: s.grace_min, weekdays: s.weekdays, isActive: true, workDate: s.work_date,
      reports: s.reports.map((r) => ({
        id: r.id, slotId: s.id, workDate: s.work_date, type: r.type, staffNo: r.staff_no, staffName: r.staff_name,
        otherKind: r.other_kind ?? undefined, eta: r.eta ?? undefined, receivedAt: r.received_at, voided: r.voided,
      })),
    })),
  }
}

// ── デモ（Supabase未構成）──
interface DemoReport extends CtxReport { siteId: string; clientId?: string }
function demoSite(token: string): { id: string; name: string; dept: string; sharedDevice: boolean } {
  const snap = demoSnapshot()
  const site = snap.sites.find((s) => s.reportToken === token) ?? (token === 'demo-site' ? snap.sites[0] : undefined)
  if (site === undefined) throw new Error('QRコードが無効です。現場に掲示された最新のQRを読み取ってください')
  return site
}
function demoContext(token: string, device: Device | null): ReportContext {
  const site = demoSite(token)
  const now = localNow()
  const all = getJson<DemoReport[]>(K_DEMO_REPORTS, [])
  const slots: CtxSlot[] = []
  for (const s of demoSnapshot().slots.filter((x) => x.siteId === site.id && x.isActive)) {
    const wd = resolveWorkDate(s, now)
    if (wd === null) continue
    const reports = all.filter((r) => r.slotId === s.id && r.workDate === wd && r.voided !== true
      && (device !== null ? r.staffNo === device.staffNo : site.sharedDevice))
    slots.push({ ...s, workDate: wd, reports })
  }
  return { site: { name: site.name, dept: site.dept, shared: site.sharedDevice }, staff: device ? { no: device.staffNo, name: device.staffName } : null, now, slots }
}

// ── 公開API ──
export async function fetchContext(token: string): Promise<ReportContext> {
  const device = loadDevice()
  if (!DB()) return demoContext(token, device)
  const { data, error } = await getSupabase()!.rpc('jyoban_context', { p_token: token, p_device_secret: device?.secret ?? null })
  if (error !== null) raise(error)
  const ctx = ctxFrom(data as CtxJson)
  if (device !== null && ctx.staff === null) saveDevice(null) // 失効・他社・退職済みの端末登録は破棄
  return ctx
}

/** 個人スマホの本人登録（スタッフNo＋PIN）。端末には保存せず結果を返す（本人確認後に saveDevice）。 */
export async function registerDevice(token: string, staffNo: string, pin: string): Promise<Device & { pinMustChange: boolean }> {
  if (!DB()) {
    demoSite(token)
    const s = authStaff(staffNo, pin)
    if (s === null) throw new ReportAuthError('スタッフNoまたはPINが正しくありません')
    return { secret: `demo-${s.no}-${'x'.repeat(32)}`, staffNo: s.no, staffName: s.name, pinMustChange: s.pinMustChange === true }
  }
  const { data, error } = await getSupabase()!.rpc('jyoban_register_device', {
    p_token: token, p_staff_no: staffNo.trim(), p_pin: pin, p_user_agent: globalThis.navigator?.userAgent ?? null,
  })
  if (error !== null) raise(error)
  const row = (Array.isArray(data) ? data[0] : data) as { device_secret: string | null; staff_no: string; staff_name: string; pin_must_change: boolean; error: string | null }
  if (row.error !== null || row.device_secret === null) throw new ReportAuthError(row.error ?? '本人登録できませんでした')
  return { secret: row.device_secret, staffNo: row.staff_no, staffName: row.staff_name, pinMustChange: row.pin_must_change }
}

async function submitOnce(token: string, input: SubmitInput, clientId: string, clientAt: string): Promise<SubmitResult> {
  if (input.type === 'other') {
    const errs = validateOtherReport({ kind: input.otherKind, eta: input.eta, note: input.note })
    if (errs.length > 0) throw new Error(errs.join(' / '))
  }
  const device = input.staffNo === undefined ? loadDevice() : null
  if (!DB()) {
    const site = demoSite(token)
    const slot = demoSnapshot().slots.find((s) => s.id === input.slotId && s.siteId === site.id)
    if (slot === undefined) throw new Error('この現場の勤務枠ではありません')
    let who: { no: string; name: string }
    if (device !== null) who = { no: device.staffNo, name: device.staffName }
    else {
      if (!site.sharedDevice) throw new ReportAuthError('本人登録が必要です。スタッフNoとPINで登録してください')
      const s = authStaff(input.staffNo ?? '', input.pin ?? '')
      if (s === null) throw new ReportAuthError('スタッフNoまたはPINが正しくありません')
      who = { no: s.no, name: s.name }
    }
    const now = localNow()
    const wd = resolveWorkDate(slot, now)
    if (wd === null) throw new Error(`いまは「${slot.name}」の報告を受け付ける時間ではありません`)
    const all = getJson<DemoReport[]>(K_DEMO_REPORTS, [])
    const dup = all.find((r) => r.clientId === clientId)
      ?? (input.type !== 'other' ? all.find((r) => r.slotId === slot.id && r.workDate === wd && r.type === input.type && r.staffNo === who.no && r.voided !== true) : undefined)
    if (dup !== undefined) return { reportId: dup.id, workDate: dup.workDate, receivedAt: dup.receivedAt, duplicate: true }
    const rep: DemoReport = {
      id: `demo-${clientId}`, clientId, siteId: site.id, slotId: slot.id, workDate: wd, type: input.type, staffNo: who.no, staffName: who.name,
      otherKind: input.otherKind, eta: input.eta, note: input.note, receivedAt: now,
    }
    setJson(K_DEMO_REPORTS, [...all, rep])
    return { reportId: rep.id, workDate: wd, receivedAt: now, duplicate: false }
  }
  const { data, error } = await getSupabase()!.rpc('jyoban_submit_report', {
    p_token: token, p_slot_id: input.slotId, p_type: input.type,
    p_device_secret: device?.secret ?? null, p_staff_no: input.staffNo ?? null, p_pin: input.pin ?? null,
    p_other_kind: input.otherKind ?? null, p_eta: input.eta ?? null, p_note: input.note ?? null,
    p_client_id: clientId, p_client_at: clientAt,
  })
  if (error !== null) raise(error)
  const row = (Array.isArray(data) ? data[0] : data) as { report_id: string | null; work_date: string; received_at: string; duplicate: boolean; error: string | null }
  if (row.error !== null || row.report_id === null) throw new ReportAuthError(row.error ?? '送信できませんでした')
  return { reportId: row.report_id, workDate: row.work_date, receivedAt: row.received_at, duplicate: row.duplicate }
}

// ── 送信待ちキュー（個人スマホのみ。共用端末はPINを端末に残さないため対象外）──
export interface OutboxItem { clientId: string; token: string; input: SubmitInput; clientAt: string }
export const outbox = (): OutboxItem[] => getJson<OutboxItem[]>(K_OUTBOX, [])
const setOutbox = (items: OutboxItem[]): void => setJson(K_OUTBOX, items.length === 0 ? null : items)

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

export type SubmitOutcome = { status: 'sent'; result: SubmitResult } | { status: 'queued' }

/** 送信。個人スマホで通信できなければ送信待ちに入れる。 */
export async function submitReport(token: string, input: SubmitInput): Promise<SubmitOutcome> {
  const item: OutboxItem = { clientId: newClientId(), token, input, clientAt: new Date().toISOString() }
  try {
    return { status: 'sent', result: await submitOnce(token, input, item.clientId, item.clientAt) }
  } catch (e) {
    if (e instanceof NetworkError && input.staffNo === undefined) {
      setOutbox([...outbox(), item])
      return { status: 'queued' }
    }
    throw e
  }
}

/** 送信待ちを順に送る。通信できなければ残す。サーバに拒否されたものは失敗として返す。 */
export async function flushOutbox(): Promise<{ sent: number; failed: { item: OutboxItem; message: string }[]; remaining: number }> {
  const items = outbox()
  const failed: { item: OutboxItem; message: string }[] = []
  let sent = 0
  const keep: OutboxItem[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    try {
      await submitOnce(it.token, it.input, it.clientId, it.clientAt)
      sent++
    } catch (e) {
      if (e instanceof NetworkError) { keep.push(...items.slice(i)); break }
      failed.push({ item: it, message: (e as Error).message })
    }
  }
  setOutbox(keep)
  return { sent, failed, remaining: keep.length }
}

/** 押し間違いの取消（個人スマホ・本人の報告のみ）。 */
export async function voidReport(token: string, reportId: string): Promise<void> {
  if (!DB()) {
    const all = getJson<DemoReport[]>(K_DEMO_REPORTS, [])
    const me = loadDevice()
    const r = all.find((x) => x.id === reportId && me !== null && x.staffNo === me.staffNo && x.voided !== true)
    if (r === undefined) throw new Error('取り消せる報告が見つかりません')
    r.voided = true
    setJson(K_DEMO_REPORTS, all)
    return
  }
  const { data, error } = await getSupabase()!.rpc('jyoban_void_report', { p_token: token, p_report_id: reportId, p_device_secret: loadDevice()?.secret ?? null })
  if (error !== null) raise(error)
  if (typeof data === 'string' && data !== '') throw new ReportAuthError(data)
}
