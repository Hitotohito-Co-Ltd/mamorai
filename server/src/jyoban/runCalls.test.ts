// [JYB] 未報告コールのワーカー検証（Supabase・送信手段はダブルを注入）
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { runJyobanCalls } from './runCalls.js'
import { createSenders, createSupabaseCallStore, toE164Jp, voiceTwiml } from './providers.js'
import { createJyobanCallsRouter } from '../routes/jyoban-calls.js'
import type { CallCandidate, CallSenders, CallStore, ClaimArgs } from './callTypes.js'

const cand = (over: Partial<CallCandidate> = {}): CallCandidate => ({
  company_id: 'co', site_name: '若葉台店', work_date: '2026-11-07', now_minutes: 5 * 60 + 45,
  slot: {
    id: 'slot1', siteId: 'site', name: '早番', workStart: '08:15', workEnd: '15:00',
    wakeupRequired: true, wakeupDue: '05:30', departureRequired: false, departureDue: null,
    ondutyRequired: true, ondutyDue: '08:15', offdutyRequired: false, offdutyDue: null,
    graceMin: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], isActive: true,
  },
  settings: { emailTo: ['kanri@example.com'], push: true, sms: true, voice: true, remindAfterMin: 0, voiceAfterMin: 5, escalateAfterMin: 10 },
  acknowledged: false, reports: [], sent: [],
  assignees: [{ staffId: 'k', staffNo: '10234', name: '笠井', phone: '090-1234-5678',
    push: [{ id: 'p1', endpoint: 'https://push/1', p256dh: 'x', auth: 'y' }, { id: 'p2', endpoint: 'https://push/2', p256dh: 'x', auth: 'y' }] }],
  ...over,
})

function memStore(list: CallCandidate[]) {
  const claimed = new Set<string>()
  const finished: { id: string; status: string; detail: string | null }[] = []
  const failedSubs: string[] = []
  const store: CallStore = {
    candidates: async () => list,
    claim: async (a: ClaimArgs) => {
      const k = [a.slotId, a.workDate, a.reportType, a.step, a.channel, a.staffId].join('|')
      if (claimed.has(k)) return null
      claimed.add(k)
      return k
    },
    finish: async (id, status, detail) => { finished.push({ id, status, detail }) },
    markPushFailed: async (id) => { failedSubs.push(id) },
  }
  return { store, finished, failedSubs }
}

const okSenders = (): Required<CallSenders> => ({
  email: vi.fn(async () => ({ ok: true })),
  sms: vi.fn(async () => ({ ok: true })),
  voice: vi.fn(async () => ({ ok: true })),
  push: vi.fn(async () => ({ ok: true })),
})

describe('[JYB] runJyobanCalls', () => {
  it('起床が10分遅れ_アプリ通知・SMS・電話・管制メールを1回ずつ送る', async () => {
    const { store, finished } = memStore([cand()])
    const s = okSenders()
    const sum = await runJyobanCalls({ store, senders: s, now: new Date(), appUrl: '/app' })
    expect(sum).toMatchObject({ candidates: 1, planned: 4, sent: 4, failed: 0, skipped: 0 })
    expect(s.push).toHaveBeenCalledTimes(2) // 2台とも
    expect(s.sms).toHaveBeenCalledWith('090-1234-5678', expect.stringContaining('起床連絡'))
    expect(s.email).toHaveBeenCalledWith(['kanri@example.com'], expect.stringContaining('【未報告】'), expect.any(String))
    expect(finished.every((f) => f.status === 'sent')).toBe(true)
  })
  it('同じ実行を2回_台帳で弾かれ二重送信しない', async () => {
    const { store } = memStore([cand()])
    const s = okSenders()
    await runJyobanCalls({ store, senders: s, now: new Date(), appUrl: '/app' })
    const second = await runJyobanCalls({ store, senders: s, now: new Date(), appUrl: '/app' })
    expect(second).toMatchObject({ sent: 0, duplicate: 4 })
    expect(s.sms).toHaveBeenCalledTimes(1)
  })
  it('送信手段が未設定_skipped として台帳に残す', async () => {
    const { store, finished } = memStore([cand()])
    const sum = await runJyobanCalls({ store, senders: { email: okSenders().email }, now: new Date(), appUrl: '/app' })
    expect(sum).toMatchObject({ sent: 1, skipped: 3 })
    expect(finished.filter((f) => f.status === 'skipped').map((f) => f.detail)).toContain('sms の送信手段が未設定')
  })
  it('Push購読先が消えている（410）_購読を無効にし、1台でも届けば sent', async () => {
    const { store, finished, failedSubs } = memStore([cand()])
    const s = okSenders()
    s.push = vi.fn(async (sub) => (sub.id === 'p1' ? { ok: false, gone: true, detail: 'push 410' } : { ok: true }))
    await runJyobanCalls({ store, senders: s, now: new Date(), appUrl: '/app' })
    expect(failedSubs).toEqual(['p1'])
    expect(finished.find((f) => f.id.includes('|push|'))).toMatchObject({ status: 'sent', detail: '1/2台' })
  })
  it('送信で例外_failed として記録し、他の送信は続ける', async () => {
    const { store, finished } = memStore([cand()])
    const s = okSenders()
    s.sms = vi.fn(async () => { throw new Error('network down') })
    const sum = await runJyobanCalls({ store, senders: s, now: new Date(), appUrl: '/app' })
    expect(sum).toMatchObject({ sent: 3, failed: 1 })
    expect(finished.find((f) => f.status === 'failed')?.detail).toBe('network down')
  })
  it('本社が確認済み_何も送らない', async () => {
    const { store } = memStore([cand({ acknowledged: true })])
    expect(await runJyobanCalls({ store, senders: okSenders(), now: new Date(), appUrl: '/app' })).toMatchObject({ planned: 0 })
  })
})

describe('[JYB] providers', () => {
  it('toE164Jp_国内番号を+81へ', () => {
    expect(toE164Jp('090-1234-5678')).toBe('+819012345678')
    expect(toE164Jp('+819012345678')).toBe('+819012345678')
  })
  it('voiceTwiml_日本語で2回読み上げ・XMLをエスケープ', () => {
    const x = voiceTwiml('A&B<店>')
    expect(x.match(/<Say language="ja-JP">A&amp;B&lt;店&gt;<\/Say>/g)?.length).toBe(2)
  })
  it('createSenders_環境変数が無い手段は作らない', () => {
    expect(Object.keys(createSenders({}))).toEqual([])
    expect(Object.keys(createSenders({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+815012345678' })).sort()).toEqual(['sms', 'voice'])
  })
  it('createSenders_SMSはTwilioへフォームで送る（鍵は Basic 認証のみ）', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 201 }))
    const s = createSenders({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+815012345678' }, f as unknown as typeof fetch)
    expect(await s.sms!('09012345678', 'テスト')).toEqual({ ok: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    expect(String(init.body)).toContain('To=%2B819012345678')
    expect(String(init.body)).not.toContain('tok')
  })
  it('createSenders_メール失敗時はHTTPステータスを返す', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 422 }))
    const s = createSenders({ RESEND_API_KEY: 'k', JYOBAN_MAIL_FROM: 'a@b.jp' }, f as unknown as typeof fetch)
    expect(await s.email!(['x@y.jp'], 's', 't')).toEqual({ ok: false, detail: 'HTTP 422 bad' })
  })
  it('createSupabaseCallStore_service_role で RPC を呼ぶ', async () => {
    const f = vi.fn(async () => new Response('"id-1"', { status: 200 }))
    const st = createSupabaseCallStore({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'srk' }, f as unknown as typeof fetch)!
    expect(await st.claim({ companyId: 'c', slotId: 's', workDate: '2026-11-07', reportType: 'wakeup', step: 'remind', channel: 'sms', staffId: null })).toBe('id-1')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/jyoban_claim_call')
    expect(JSON.parse(String(init.body))).toMatchObject({ p_report_type: 'wakeup', p_staff_id: null })
    expect(createSupabaseCallStore({})).toBeNull()
  })
})

describe('[JYB] POST /api/jobs/jyoban-calls', () => {
  async function call(env: Record<string, string>, auth?: string) {
    const { store } = memStore([])
    const app = express().use('/j', createJyobanCallsRouter(env, (now) => ({ store, senders: {}, now, appUrl: '/app' })))
    const server = app.listen(0)
    const port = (server.address() as AddressInfo).port
    try {
      const res = await fetch(`http://127.0.0.1:${port}/j`, { method: 'POST', headers: auth ? { authorization: auth } : {} })
      return { status: res.status, body: (await res.json()) as unknown }
    } finally {
      server.close()
    }
  }
  it('CRON_SECRET 未設定_503（公開しない）', async () => {
    expect((await call({}, 'Bearer x')).status).toBe(503)
  })
  it('合言葉が違う_401', async () => {
    expect((await call({ CRON_SECRET: 'secret' }, 'Bearer nope')).status).toBe(401)
    expect((await call({ CRON_SECRET: 'secret' })).status).toBe(401)
  })
  it('合言葉が合う_実行結果を返す', async () => {
    const r = await call({ CRON_SECRET: 'secret' }, 'Bearer secret')
    expect(r).toEqual({ status: 200, body: { candidates: 0, planned: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 } })
  })
})
