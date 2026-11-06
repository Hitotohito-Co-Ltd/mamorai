// [JYB] 起床・出発・到着（上番）・下番コール — 未報告のときに「誰に・何で・いつ」知らせるかの計画（純粋・決定論）
//   段階:
//     remind   … 期限＋猶予＋remindAfterMin を過ぎたら、本人へアプリ通知・SMS
//     call     … 期限＋猶予＋voiceAfterMin を過ぎたら、本人へ自動音声電話
//     escalate … 期限＋猶予＋escalateAfterMin を過ぎたら、管制（本社）へメール
//   知らせない場合:
//     ・本人がその報告をした／後の報告をした（例: 上番済みなら起床・出発は知らせない）
//     ・本人が「その他」（遅刻・寝坊など）で連絡済み（下番は除く）
//     ・本社が「確認済み」にした
//     ・期限から時間が経ちすぎた（ワーカー停止後の再開で古い督促を大量に送らない）
//     ・すでに同じ知らせを送った（台帳 sent）
// 時刻はすべて「勤務日0時からの分」。現在時刻は引数で受け取る（Date.now 等は使わない）。
import { JYOBAN_TIMED_TYPES, JYOBAN_TYPE_LABEL, typeDueMinutes, type JyobanSlot, type JyobanTimedType } from './model.js'

export type CallStep = 'remind' | 'call' | 'escalate'
export type CallChannel = 'push' | 'sms' | 'voice' | 'email'

export interface CallSettings {
  /** 管制メールの宛先（空ならメールは送らない） */
  emailTo: string[]
  push: boolean
  sms: boolean
  voice: boolean
  /** 期限＋猶予の何分後に本人へアプリ通知・SMS */
  remindAfterMin: number
  /** 何分後に本人へ電話 */
  voiceAfterMin: number
  /** 何分後に管制へメール */
  escalateAfterMin: number
}

export interface CallAssignee {
  staffId: string
  staffNo: string
  name: string
  phone: string | null
  /** 有効なPush購読先があるか */
  hasPush: boolean
}

export interface CallReportLite {
  staffId: string | null
  type: JyobanTimedType | 'other'
}

export interface CallSentLite {
  staffId: string | null
  reportType: JyobanTimedType
  step: CallStep
  channel: CallChannel
}

export interface PlanCallsInput {
  slot: JyobanSlot
  siteName: string
  workDate: string
  /** 現在（勤務日0時からの分） */
  nowMinutes: number
  reports: CallReportLite[]
  assignees: CallAssignee[]
  settings: CallSettings
  acknowledged: boolean
  sent: CallSentLite[]
}

export interface CallAction {
  reportType: JyobanTimedType
  step: CallStep
  channel: CallChannel
  /** 本人あての知らせは隊員ID。管制メールで担当者が決まっていない枠は null */
  staffId: string | null
  /** 宛先（電話番号・メールアドレス）。push は購読先をワーカー側で引く */
  to: string[]
  /** 件名（メール・通知のタイトル） */
  title: string
  /** 本文（SMS・通知・メール）。音声電話はこの文を読み上げる */
  body: string
}

/** 期限からこの分数を過ぎた本人あての督促は送らない（ワーカー停止後の再開対策） */
export const CALL_PERSONAL_STALE_MIN = 60
/** 期限からこの分数を過ぎた管制メールは送らない */
export const CALL_ESCALATE_STALE_MIN = 180

const pad = (n: number): string => String(n).padStart(2, '0')
/** 勤務日0時からの分 → 'H:MM'（翌日は「翌H:MM」） */
export function minutesLabel(m: number): string {
  const day = Math.floor(m / 1440)
  const r = ((m % 1440) + 1440) % 1440
  const t = `${Math.floor(r / 60)}:${pad(r % 60)}`
  return day >= 1 ? `翌${t}` : day < 0 ? `前日${t}` : t
}

/** 本人がこの報告を済ませた（または後の報告で不要になった）か */
function satisfied(type: JyobanTimedType, mine: CallReportLite[]): boolean {
  const idx = JYOBAN_TIMED_TYPES.indexOf(type)
  return mine.some((r) => {
    if (r.type === 'other') return false
    const j = JYOBAN_TIMED_TYPES.indexOf(r.type)
    // 下番は「下番の報告」でしか満たされない。それ以外は後の報告でも満たす
    return type === 'offduty' ? r.type === 'offduty' : j >= idx
  })
}

function alreadySent(sent: CallSentLite[], a: { staffId: string | null; reportType: JyobanTimedType; step: CallStep; channel: CallChannel }): boolean {
  return sent.some((s) => s.staffId === a.staffId && s.reportType === a.reportType && s.step === a.step && s.channel === a.channel)
}

/**
 * いま送るべき知らせの一覧を返す。送ったものはワーカーが台帳（sent）に記録し、次回以降は返らない。
 * 担当者が未設定の枠は、本人への督促はできないため、誰も報告していなければ管制メールだけを返す。
 */
export function planCalls(input: PlanCallsInput): CallAction[] {
  const { slot, settings, nowMinutes } = input
  if (input.acknowledged || !slot.isActive) return []
  const out: CallAction[] = []
  const place = `${input.siteName}（${slot.name}）`

  for (const type of JYOBAN_TIMED_TYPES) {
    const due = typeDueMinutes(slot, type)
    if (due === null) continue
    const overdueAt = due + slot.graceMin
    const label = JYOBAN_TYPE_LABEL[type]
    const dueText = minutesLabel(due)
    const late = nowMinutes - overdueAt
    if (late < 0) continue

    const people: (CallAssignee | null)[] = input.assignees.length > 0 ? input.assignees : [null]
    for (const p of people) {
      const staffId = p?.staffId ?? null
      if (p === null) {
        // 担当者未設定: 誰かが報告していれば知らせない
        if (input.reports.some((r) => r.type !== 'other' && satisfied(type, [r]))) continue
      } else {
        const mine = input.reports.filter((r) => r.staffId === p.staffId)
        if (satisfied(type, mine)) continue
        if (type !== 'offduty' && mine.some((r) => r.type === 'other')) continue
      }
      const push = (step: CallStep, channel: CallChannel, to: string[], title: string, body: string): void => {
        const a = { staffId, reportType: type, step, channel }
        if (!alreadySent(input.sent, a)) out.push({ ...a, to, title, body })
      }
      const who = p === null ? '担当者未設定' : `${p.name}（No.${p.staffNo}）`

      if (p !== null && late <= CALL_PERSONAL_STALE_MIN) {
        const title = `${label}がまだです`
        const body = `${place}の${label}（期限${dueText}）がまだ届いていません。MAMOR-AIの上番報告から報告してください。遅れる場合は「その他」から連絡してください。`
        if (late >= settings.remindAfterMin) {
          if (settings.push && p.hasPush) push('remind', 'push', [], title, body)
          if (settings.sms && p.phone !== null) push('remind', 'sms', [p.phone], title, body)
        }
        if (late >= settings.voiceAfterMin && settings.voice && p.phone !== null) {
          push('call', 'voice', [p.phone], title,
            `こちらはマモライです。${place}の${label}が、まだ届いていません。至急、報告するか、本社へ連絡してください。`)
        }
      }
      if (late >= settings.escalateAfterMin && late <= CALL_ESCALATE_STALE_MIN && settings.emailTo.length > 0) {
        push('escalate', 'email', [...settings.emailTo],
          `【未報告】${place} ${label}（期限${dueText}）`,
          `${input.workDate} ${place}\n${label}の期限 ${dueText}（猶予${slot.graceMin}分）を過ぎても報告がありません。\n対象: ${who}\n経過: 期限＋猶予から${late}分\n\n本人へはアプリ通知・SMS・電話で督促しています。本人が報告するか「その他」で遅刻・寝坊を連絡すると、以後の通知は止まります。`)
      }
    }
  }
  return out
}
