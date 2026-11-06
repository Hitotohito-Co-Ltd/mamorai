// [JYB] 送信手段とSupabase RPC の実装。いずれも環境変数が無ければ作らない（＝その手段は skipped）。
//   メール : Resend        RESEND_API_KEY, JYOBAN_MAIL_FROM
//   SMS    : Twilio        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM（または TWILIO_MESSAGING_SERVICE_SID）
//   電話   : Twilio        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM（未設定なら TWILIO_FROM）
//   Push   : Web Push      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   DB     : Supabase      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 鍵・宛先はログや台帳の detail に出さない。
import webpush from 'web-push'
import type { CallCandidate, CallSenders, CallStore, PushSub, SendResult } from './callTypes.js'

type Env = Record<string, string | undefined>
type Fetch = typeof fetch
const has = (v: string | undefined): v is string => v !== undefined && v.trim() !== ''

/** 国内番号（090…）を E.164（+8190…）へ */
export function toE164Jp(phone: string): string {
  const p = phone.replace(/[-\s()]/g, '')
  if (p.startsWith('+')) return p
  if (p.startsWith('0')) return `+81${p.slice(1)}`
  return p
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

/** 音声電話で読み上げる TwiML（2回くり返す） */
export function voiceTwiml(speech: string): string {
  const say = `<Say language="ja-JP">${escapeXml(speech)}</Say>`
  return `<Response>${say}<Pause length="1"/>${say}</Response>`
}

async function errText(res: Response): Promise<string> {
  const t = await res.text().catch(() => '')
  return `HTTP ${res.status} ${t.slice(0, 200)}`
}

export function createSenders(env: Env, f: Fetch = fetch): CallSenders {
  const out: CallSenders = {}

  if (has(env.RESEND_API_KEY) && has(env.JYOBAN_MAIL_FROM)) {
    const key = env.RESEND_API_KEY, from = env.JYOBAN_MAIL_FROM
    out.email = async (to, subject, text): Promise<SendResult> => {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
      })
      return res.ok ? { ok: true } : { ok: false, detail: await errText(res) }
    }
  }

  if (has(env.TWILIO_ACCOUNT_SID) && has(env.TWILIO_AUTH_TOKEN)) {
    const sid = env.TWILIO_ACCOUNT_SID
    const auth = `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`
    const post = async (path: string, form: Record<string, string>): Promise<SendResult> => {
      const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
      return res.ok ? { ok: true } : { ok: false, detail: await errText(res) }
    }
    if (has(env.TWILIO_FROM) || has(env.TWILIO_MESSAGING_SERVICE_SID)) {
      out.sms = (to, text) => post('Messages.json', {
        To: toE164Jp(to), Body: text,
        ...(has(env.TWILIO_MESSAGING_SERVICE_SID) ? { MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID } : { From: env.TWILIO_FROM! }),
      })
    }
    const voiceFrom = has(env.TWILIO_VOICE_FROM) ? env.TWILIO_VOICE_FROM : env.TWILIO_FROM
    if (has(voiceFrom)) {
      out.voice = (to, speech) => post('Calls.json', { To: toE164Jp(to), From: voiceFrom, Twiml: voiceTwiml(speech) })
    }
  }

  if (has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY)) {
    webpush.setVapidDetails(has(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : 'mailto:noreply@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
    out.push = async (sub: PushSub, payload): Promise<SendResult> => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload), { TTL: 60 * 30, urgency: 'high' })
        return { ok: true }
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        return { ok: false, detail: `push ${code ?? 'error'}`, gone: code === 404 || code === 410 }
      }
    }
  }
  return out
}

/** Supabase の service_role で RPC を呼ぶ（サーバ内のみ。キーはクライアントへ出さない） */
export function createSupabaseCallStore(env: Env, f: Fetch = fetch): CallStore | null {
  if (!has(env.SUPABASE_URL) || !has(env.SUPABASE_SERVICE_ROLE_KEY)) return null
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await f(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`rpc ${name}: ${await errText(res)}`)
    const text = await res.text()
    return (text === '' ? null : JSON.parse(text)) as T
  }
  return {
    candidates: async (now) => (await rpc<CallCandidate[] | null>('jyoban_call_candidates', { p_now: now.toISOString() })) ?? [],
    claim: (a) => rpc<string | null>('jyoban_claim_call', {
      p_company_id: a.companyId, p_slot_id: a.slotId, p_work_date: a.workDate,
      p_report_type: a.reportType, p_step: a.step, p_channel: a.channel, p_staff_id: a.staffId,
    }),
    finish: async (id, status, detail) => { await rpc('jyoban_finish_call', { p_id: id, p_status: status, p_detail: detail }) },
    markPushFailed: async (id) => { await rpc('jyoban_mark_push_failed', { p_subscription_id: id }) },
  }
}
