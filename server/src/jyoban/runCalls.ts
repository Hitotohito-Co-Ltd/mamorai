// [JYB] 未報告コールを1回分まわす。外部（cron 等）から数分おきに呼ぶ。
//   1. Supabase から「いま判定すべき勤務枠」を取得（現場の現地時刻・勤務日はDB側で計算）
//   2. input-core の planCalls で「誰に・何で」を決める（判定ロジックはここに再実装しない）
//   3. 台帳に claim → 送信 → 結果を記録。claim 済みは送らないので、二重起動しても二重送信しない
import { planCalls, type CallAction } from '@mamorai/input-core'
import type { CallCandidate, CallSenders, CallStore, SendResult } from './callTypes.js'

export interface RunSummary { candidates: number; planned: number; sent: number; failed: number; skipped: number; duplicate: number }

export interface RunDeps {
  store: CallStore
  senders: CallSenders
  now: Date
  /** 通知タップ時に開くURL（例: https://example.com/app） */
  appUrl: string
  log?: (msg: string) => void
}

async function deliver(c: CallCandidate, a: CallAction, deps: RunDeps): Promise<SendResult | null> {
  const s = deps.senders
  switch (a.channel) {
    case 'email':
      return s.email ? s.email(a.to, a.title, a.body) : null
    case 'sms':
      return s.sms ? s.sms(a.to[0]!, a.body) : null
    case 'voice':
      return s.voice ? s.voice(a.to[0]!, a.body) : null
    case 'push': {
      if (!s.push) return null
      const subs = c.assignees.find((p) => p.staffId === a.staffId)?.push ?? []
      let okCount = 0
      const errors: string[] = []
      for (const sub of subs) {
        const r = await s.push(sub, { title: a.title, body: a.body, url: deps.appUrl })
        if (r.ok) okCount++
        else {
          errors.push(r.detail ?? 'error')
          if (r.gone) await deps.store.markPushFailed(sub.id)
        }
      }
      return okCount > 0 ? { ok: true, detail: `${okCount}/${subs.length}台` } : { ok: false, detail: errors.join('; ') || '購読先なし' }
    }
  }
}

export async function runJyobanCalls(deps: RunDeps): Promise<RunSummary> {
  const log = deps.log ?? (() => {})
  const sum: RunSummary = { candidates: 0, planned: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 }
  const list = await deps.store.candidates(deps.now)
  sum.candidates = list.length
  for (const c of list) {
    const actions = planCalls({
      slot: c.slot, siteName: c.site_name, workDate: c.work_date, nowMinutes: c.now_minutes,
      reports: c.reports, settings: c.settings, acknowledged: c.acknowledged, sent: c.sent,
      assignees: c.assignees.map((p) => ({ staffId: p.staffId, staffNo: p.staffNo, name: p.name, phone: p.phone, hasPush: p.push.length > 0 })),
    })
    sum.planned += actions.length
    for (const a of actions) {
      const id = await deps.store.claim({
        companyId: c.company_id, slotId: c.slot.id, workDate: c.work_date,
        reportType: a.reportType, step: a.step, channel: a.channel, staffId: a.staffId,
      })
      if (id === null) { sum.duplicate++; continue }
      let r: SendResult | null
      try {
        r = await deliver(c, a, deps)
      } catch (e) {
        r = { ok: false, detail: e instanceof Error ? e.message : String(e) }
      }
      if (r === null) {
        sum.skipped++
        await deps.store.finish(id, 'skipped', `${a.channel} の送信手段が未設定`)
      } else if (r.ok) {
        sum.sent++
        await deps.store.finish(id, 'sent', r.detail ?? null)
      } else {
        sum.failed++
        await deps.store.finish(id, 'failed', (r.detail ?? 'error').slice(0, 500))
        log(`[jyoban-calls] ${a.channel} 失敗 slot=${c.slot.id} ${a.reportType}: ${r.detail ?? ''}`)
      }
    }
  }
  return sum
}
