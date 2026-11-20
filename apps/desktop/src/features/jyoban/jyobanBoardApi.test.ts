// 本日の現場一覧のデータ（デモ動作）: 訂正（取消・後から登録）と確認済み
import { describe, it, expect, beforeEach } from 'vitest'
import { fetchBoard, voidBoardReport, addBoardReport, ackSlot, boardFromJson } from './jyobanBoardApi.js'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
}

describe('本日の現場一覧（デモ）', () => {
  beforeEach(() => { (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage() })

  it('台帳の形を画面の形に変換する', () => {
    const b = boardFromJson({
      date: '2026-11-20', now_local: '2026-11-20T09:00',
      sites: [{ id: 's', name: '現場', code: 'A-01', slots: [{
        id: 'x', site_id: 's', name: '日勤', work_start: '08:00', work_end: '17:00', departure_required: false, departure_due: null,
        onduty_required: true, onduty_due: '07:45', wakeup_required: false, wakeup_due: null, offduty_required: false, offduty_due: null,
        grace_min: 5, weekdays: [0, 1, 2, 3, 4, 5, 6], is_active: true, required_by_dow: [1, 1, 1, 1, 1, 2, 1],
        roster: [{ staff_no: '90001', name: '架空', phone: null }], ack: null,
        reports: [{ id: 'r', type: 'onduty', staff_no: '90001', staff_name: '架空', phone: null, other_kind: null, eta: null, note: null,
          received_at: '2026-11-20T07:40', voided: false, void_reason: null, voided_by: null, entered_by: null, entry_reason: null,
          geo_status: 'outside', geo_distance_m: 620 }],
      }] }],
    })
    const s = b.sites[0]!.slots[0]!
    expect(s.slot.requiredByDow?.[5]).toBe(2)
    expect(s.reports[0]).toMatchObject({ slotId: 'x', workDate: '2026-11-20', geoStatus: 'outside', geoDistanceM: 620 })
  })

  it('理由のない訂正は受け付けない', async () => {
    await expect(voidBoardReport('site', 'r', ' ')).rejects.toThrow('理由')
    await expect(addBoardReport('site', { slotId: 'demo-lala-1', date: '2026-11-20', type: 'onduty', staffNo: '783', time: '07:40', reason: '' })).rejects.toThrow('理由')
  })

  it('後から登録 → 取消 → 確認済み', async () => {
    const day = (await fetchBoard('company')).date
    await addBoardReport('site', { slotId: 'demo-lala-1', date: day, type: 'onduty', staffNo: '783', time: '00:01', reason: 'スマホを忘れた' })
    let b = await fetchBoard('company', day)
    const rep = b.sites.flatMap((s) => s.slots).find((x) => x.slot.id === 'demo-lala-1')!.reports[0]!
    expect(rep).toMatchObject({ enteredBy: '現場PC（デモ）', entryReason: 'スマホを忘れた' })
    await expect(addBoardReport('site', { slotId: 'demo-lala-1', date: day, type: 'onduty', staffNo: '783', time: '00:02', reason: '二重' })).rejects.toThrow('すでに')
    await voidBoardReport('company', rep.id, '別日の出勤だった')
    await ackSlot('company', 'demo-lala-1', day, '')
    b = await fetchBoard('company', day)
    const s = b.sites.flatMap((x) => x.slots).find((x) => x.slot.id === 'demo-lala-1')!
    expect(s.reports[0]).toMatchObject({ voided: true, voidReason: '別日の出勤だった', voidedBy: '本社（デモ）' })
    expect(s.ack?.by).toBe('デモ')
  })
})
