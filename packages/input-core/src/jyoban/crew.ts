// [JYB] 本日の現場一覧の判定（勤務枠×勤務日・複数人）。
//   要件定義 4.1: 約定人数（曜日別）との照合（R2）、勤務表外の印（R5）、シフト記入なしでの運用（R6）。
//   ・実際に入った人＝上番した人（勤務表＝配置者は「誰に知らせるか」と「勤務表外」の判定にだけ使う）
//   ・約定人数＝曜日別の設定。未設定なら配置者の人数、配置者もいなければ1名
//   ・取消された報告は数えない（記録は残る）。後から登録された報告は数える
//   状態の名前・並び順は computeSlotStatus と同じ（SlotStatus）。画面ではこの結果だけを使う。
import {
  computeSlotStatus, typeDueMinutes, localMinutesFrom, isSlotScheduledOn, weekdayOf,
  type JyobanSlot, type JyobanReport, type SlotStatus, type JyobanTimedType,
} from './model.js'
import type { GeoStatus } from '../geo/geofence.js'

/** 一覧用の報告（台帳の行。取消・訂正・位置判定つき） */
export interface BoardReport extends JyobanReport {
  id: string
  phone?: string | null
  voidReason?: string | null
  voidedBy?: string | null
  /** 後から登録した人（null＝本人のスマホから） */
  enteredBy?: string | null
  entryReason?: string | null
  geoStatus?: GeoStatus | null
  geoDistanceM?: number | null
}

export interface CrewRosterMember { staffNo: string; name: string; phone?: string | null }

export interface CrewStep {
  /** 報告時刻 'HH:MM'（未報告は null） */
  at: string | null
  report?: BoardReport
}

export interface CrewPerson {
  staffNo: string
  name: string
  phone: string | null
  /** 勤務表（配置者）に入っているか。配置者が未登録の勤務枠では null（判定しない） */
  onRoster: boolean | null
  wakeup: CrewStep
  departure: CrewStep
  onduty: CrewStep
  offduty: CrewStep
  /** 最新のその他報告（遅刻等） */
  other?: BoardReport
  /** 配置者なのに上番の締切＋猶予を過ぎても上番がない */
  missingOnduty: boolean
  /** 上番したのに下番の締切＋猶予を過ぎても下番がない */
  missingOffduty: boolean
  /** この人の報告に、後から登録（訂正）されたものがある */
  corrected: boolean
}

export interface CrewStatusInput {
  slot: JyobanSlot
  workDate: string
  /** 現在時刻（勤務日0時からの分） */
  nowMinutes: number
  reports: BoardReport[]
  roster: CrewRosterMember[]
  acknowledged?: boolean
}

export interface CrewStatusResult {
  status: SlotStatus
  /** 約定人数 */
  required: number
  /** 上番した人数 */
  ondutyCount: number
  /** 不足人数（約定−上番。0以上） */
  shortage: number
  /** 上番の締切＋猶予を過ぎたか */
  ondutyOverdue: boolean
  people: CrewPerson[]
  offRosterCount: number
  /** 取消された報告（一覧の「取消」欄用） */
  voided: BoardReport[]
}

/** その日の約定人数。曜日別の設定 → 配置者の人数 → 1名 の順に決める。 */
export function requiredCount(slot: JyobanSlot, workDate: string, rosterSize: number): number {
  const v = slot.requiredByDow?.[weekdayOf(workDate)]
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  return rosterSize > 0 ? rosterSize : 1
}

const hm = (r: JyobanReport): string => r.receivedAt.slice(11, 16)

function firstOf(list: BoardReport[], workDate: string): BoardReport | undefined {
  let best: BoardReport | undefined
  for (const r of list) if (best === undefined || localMinutesFrom(workDate, r.receivedAt) < localMinutesFrom(workDate, best.receivedAt)) best = r
  return best
}

/** 勤務枠×勤務日の状態（約定人数・勤務表外・人ごとの報告）を判定する。 */
export function computeCrewStatus(input: CrewStatusInput): CrewStatusResult {
  const { slot, workDate, nowMinutes, roster } = input
  const mine = input.reports.filter((r) => r.slotId === slot.id && r.workDate === workDate)
  const live = mine.filter((r) => r.voided !== true)
  const voided = mine.filter((r) => r.voided === true)
  const base = computeSlotStatus({ slot, workDate, nowMinutes, reports: live, acknowledged: input.acknowledged })
  const due = (t: JyobanTimedType): number | null => typeDueMinutes(slot, t)
  const onDue = due('onduty')
  const offDue = due('offduty')
  const ondutyOverdue = onDue !== null && nowMinutes > onDue + slot.graceMin
  const offOverdue = offDue !== null && nowMinutes > offDue + slot.graceMin
  const rosterNos = new Set(roster.map((m) => m.staffNo))
  const hasRoster = roster.length > 0

  const byStaff = new Map<string, BoardReport[]>()
  for (const r of live) byStaff.set(r.staffNo, [...(byStaff.get(r.staffNo) ?? []), r])
  for (const m of roster) if (!byStaff.has(m.staffNo)) byStaff.set(m.staffNo, [])

  const people: CrewPerson[] = [...byStaff.entries()].map(([staffNo, list]) => {
    const pick = (t: JyobanTimedType): CrewStep => {
      const r = firstOf(list.filter((x) => x.type === t), workDate)
      return r === undefined ? { at: null } : { at: hm(r), report: r }
    }
    const others = list.filter((x) => x.type === 'other')
    let other: BoardReport | undefined
    for (const r of others) if (other === undefined || localMinutesFrom(workDate, r.receivedAt) >= localMinutesFrom(workDate, other.receivedAt)) other = r
    const m = roster.find((x) => x.staffNo === staffNo)
    const onduty = pick('onduty')
    const offduty = pick('offduty')
    return {
      staffNo,
      name: list[0]?.staffName ?? m?.name ?? '',
      phone: m?.phone ?? list.find((x) => x.phone)?.phone ?? null,
      onRoster: hasRoster ? rosterNos.has(staffNo) : null,
      wakeup: pick('wakeup'), departure: pick('departure'), onduty, offduty, other,
      missingOnduty: rosterNos.has(staffNo) && onduty.at === null && ondutyOverdue && other === undefined,
      missingOffduty: onduty.at !== null && offduty.at === null && offOverdue,
      corrected: list.some((x) => x.enteredBy != null && x.enteredBy !== ''),
    }
  })
  // 並び：対応が要る人 → 勤務表外 → 上番済み、同順はスタッフNo
  const rank = (p: CrewPerson): number => (p.missingOnduty || p.missingOffduty ? 0 : p.onRoster === false ? 1 : p.onduty.at === null ? 2 : 3)
  people.sort((a, b) => rank(a) - rank(b) || a.staffNo.localeCompare(b.staffNo))

  const required = requiredCount(slot, workDate, roster.length)
  const ondutyCount = people.filter((p) => p.onduty.at !== null).length
  const shortage = Math.max(0, required - ondutyCount)
  const offRosterCount = people.filter((p) => p.onRoster === false).length
  const out = (status: SlotStatus): CrewStatusResult => ({ status, required, ondutyCount, shortage, ondutyOverdue, people, offRosterCount, voided })

  // 約定0名の曜日は稼働なしとして扱う
  if (!isSlotScheduledOn(slot, workDate) || required === 0) return out('not_scheduled')
  const short = slot.ondutyRequired && ondutyOverdue && shortage > 0
  const anyOffMissing = people.some((p) => p.missingOffduty)
  if (short || anyOffMissing) return out(input.acknowledged === true ? 'acknowledged' : 'missing')
  if (base.status === 'on_duty' && shortage > 0) return out(people.some((p) => p.departure.at !== null) ? 'departed' : 'pending')
  return out(base.status)
}
