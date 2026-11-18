// [有給] データ層。Supabase構成時はRPC(0402)を呼び、未構成時は localStorage(leaveStore) に委譲。
// これにより本番(実DB・端末間共有)とデモ(ローカル)を同一UIで両立する。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { siteRpc, workerRpc } from '../../shared/secureRpc.js'
import { COMPANY, SITE } from '../../pilot/bulgari.js'
import {
  listLeave as localList, listLeaveForStaff as localListStaff, submitLeave as localSubmit,
  approveSite as localApproveSite, approveCompany as localApproveCompany, rejectLeave as localReject,
  subscribe as localSubscribe, type LeaveReq, type Approver,
} from '../../shared/leaveStore.js'

export type { LeaveReq, Approver }
const DB = (): boolean => isSupabaseConfigured()

// DB行(snake_case) → アプリのLeaveReq(camelCase)。会社/現場名はパイロット定数で補完。
interface Row {
  id: string; staff_no: string; staff_name: string; dept: string
  date_from: string; date_to: string; days: number; reason: string; status: LeaveReq['status']
  site_approver: Approver | null; company_approver: Approver | null; submitted_at: string; rejected_by: string | null
}
function fromRow(r: Row): LeaveReq {
  return {
    id: r.id, staffNo: r.staff_no, name: r.staff_name, company: COMPANY.name, dept: r.dept, site: SITE.name,
    from: r.date_from, to: r.date_to, days: r.days, reason: r.reason, status: r.status,
    submittedAt: r.submitted_at, siteApprover: r.site_approver ?? undefined,
    companyApprover: r.company_approver ?? undefined, rejectedBy: r.rejected_by ?? undefined,
  }
}

// 勤務員(/app): 提出
export async function submitLeave(input: { staffNo: string; name: string; dept: string; from: string; to: string; days: number; reason: string }): Promise<void> {
  if (DB()) {
    // スタッフNo・氏名・所属はサーバーが端末から決める（他人の名前で出せないように）
    await workerRpc('worker_submit_leave', { p_from: input.from, p_to: input.to, p_days: input.days, p_reason: input.reason })
    return
  }
  localSubmit({ staffNo: input.staffNo, name: input.name, company: COMPANY.name, dept: input.dept, site: SITE.name, from: input.from, to: input.to, days: input.days, reason: input.reason })
}
export async function listForStaff(staffNo: string): Promise<LeaveReq[]> {
  if (DB()) { const data = await workerRpc<Row[] | null>('worker_list_leave'); return (data ?? []).map(fromRow) }
  return localListStaff(staffNo)
}

// 現場(/s)
export async function listForSite(): Promise<LeaveReq[]> {
  if (DB()) { const data = await siteRpc<Row[] | null>('sitepc_list_leave'); return (data ?? []).map(fromRow) }
  return localList()
}
export async function approveSite(id: string, approver: Approver): Promise<void> {
  if (DB()) { await siteRpc('sitepc_approve_leave', { p_id: id, p_approver: approver }); return }
  localApproveSite(id, approver)
}
export async function rejectAtSite(id: string, by: string): Promise<void> {
  if (DB()) { await siteRpc('sitepc_reject_leave', { p_id: id, p_by: by }); return }
  localReject(id, by)
}

// 会社(/co, Auth)
export async function listForCompany(): Promise<LeaveReq[]> {
  if (DB()) { const { data } = await getSupabase()!.rpc('company_list_leave'); return ((data as Row[]) ?? []).map(fromRow) }
  return localList()
}
export async function approveCompany(id: string, approver: Approver): Promise<void> {
  if (DB()) { await getSupabase()!.rpc('company_approve_leave', { p_id: id, p_approver: approver }); return }
  localApproveCompany(id, approver)
}
export async function rejectAtCompany(id: string, by: string): Promise<void> {
  if (DB()) { await getSupabase()!.rpc('company_reject_leave', { p_id: id, p_by: by }); return }
  localReject(id, by)
}

/** 変更購読。ローカルはstore購読、DBはRealtimeでleave_requestsを購読。 */
export function subscribe(cb: () => void): () => void {
  if (DB()) {
    const ch = getSupabase()!.channel('leave_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => cb())
      .subscribe()
    return () => { try { getSupabase()!.removeChannel(ch) } catch { /* ignore */ } }
  }
  return localSubscribe(cb)
}
