// [JYB] 未報告コール — ワーカーが使う型（Supabase RPC の戻り値と、送信手段の抽象）
import type { CallChannel, CallSettings, CallStep, JyobanSlot, JyobanTimedType } from '@mamorai/input-core'

export interface PushSub { id: string; endpoint: string; p256dh: string; auth: string }

/** jyoban_call_candidates の1要素（勤務枠×勤務日） */
export interface CallCandidate {
  company_id: string
  site_name: string
  work_date: string
  now_minutes: number
  slot: JyobanSlot
  settings: CallSettings
  acknowledged: boolean
  reports: { staffId: string | null; type: JyobanTimedType | 'other' }[]
  assignees: { staffId: string; staffNo: string; name: string; phone: string | null; push: PushSub[] }[]
  sent: { staffId: string | null; reportType: JyobanTimedType; step: CallStep; channel: CallChannel }[]
}

export interface ClaimArgs {
  companyId: string
  slotId: string
  workDate: string
  reportType: JyobanTimedType
  step: CallStep
  channel: CallChannel
  staffId: string | null
}

/** Supabase 側の操作（service_role 専用 RPC） */
export interface CallStore {
  candidates(now: Date): Promise<CallCandidate[]>
  /** 送信前に台帳へ記録。すでに記録済みなら null（＝送らない） */
  claim(a: ClaimArgs): Promise<string | null>
  finish(id: string, status: 'sent' | 'failed' | 'skipped', detail: string | null): Promise<void>
  markPushFailed(subscriptionId: string): Promise<void>
}

/** 送信結果。ok=false の detail はログ・台帳に残す（宛先や鍵は入れない） */
export interface SendResult { ok: boolean; detail?: string; /** Push購読先が無効（410/404） */ gone?: boolean }

/** 送信手段。未設定（環境変数なし）の手段は undefined ＝ 台帳に skipped で残す */
export interface CallSenders {
  email?: (to: string[], subject: string, text: string) => Promise<SendResult>
  sms?: (to: string, text: string) => Promise<SendResult>
  voice?: (to: string, speech: string) => Promise<SendResult>
  push?: (sub: PushSub, payload: { title: string; body: string; url: string }) => Promise<SendResult>
}
