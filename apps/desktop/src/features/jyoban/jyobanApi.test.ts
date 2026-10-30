// [上番報告] 設定データ層（Supabase未構成=デモ/ローカル動作）の振る舞い。
import { describe, it, expect, beforeEach } from 'vitest'
import { buildReportUrl } from '@mamorai/input-core'
import {
  listSites, listSlots, saveSlot, issueReportToken, setSharedDevice, JyobanValidationError,
} from './jyobanApi.js'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()
})

describe('jyobanApi（デモ動作）', () => {
  it('初期値として上番データの2現場と勤務枠を返す', async () => {
    const sites = await listSites()
    expect(sites.map((s) => s.name)).toEqual(['ららぽーと立川立飛', 'コーチャンフォー若葉台店'])
    const coa = sites[1]!
    const slots = await listSlots(coa.id)
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ name: '早番', departureDue: '06:30', ondutyDue: '08:15' })
  })

  it('勤務枠を追加すると一覧と枠数に反映される', async () => {
    const [lala] = await listSites()
    await saveSlot({
      id: '', siteId: lala!.id, name: '夜勤', workStart: '21:00', workEnd: '06:00',
      departureRequired: false, departureDue: null, ondutyRequired: true, ondutyDue: '20:45',
      graceMin: 10, weekdays: [5, 6], isActive: true,
    }, 2)
    expect((await listSlots(lala!.id)).map((s) => s.name)).toContain('夜勤')
    expect((await listSites())[0]!.slotCount).toBe(3)
  })

  it('不正な勤務枠は保存せず検証エラーを返す', async () => {
    const [lala] = await listSites()
    const bad = saveSlot({
      id: '', siteId: lala!.id, name: '', workStart: '08:00', workEnd: '17:00',
      departureRequired: false, departureDue: null, ondutyRequired: false, ondutyDue: null,
      graceMin: 5, weekdays: [1], isActive: true,
    }, 9)
    await expect(bad).rejects.toBeInstanceOf(JyobanValidationError)
    await expect(bad).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ field: 'name' }), expect.objectContaining({ field: 'ondutyRequired' })]) })
    expect(await listSlots(lala!.id)).toHaveLength(2)
  })

  it('不要にした報告の締切は保存時に消す', async () => {
    const coa = (await listSites())[1]!
    const [slot] = await listSlots(coa.id)
    const saved = await saveSlot({ ...slot!, departureRequired: false }, 0)
    expect(saved.departureDue).toBeNull()
  })

  it('QRトークンはURLに使える形式で、再発行すると変わる', async () => {
    const [lala] = await listSites()
    const t1 = await issueReportToken(lala!.id)
    const t2 = await issueReportToken(lala!.id)
    expect(t1).not.toBe(t2)
    expect(buildReportUrl('https://example.test', t2)).toBe(`https://example.test/app/r/${t2}`)
    expect((await listSites())[0]!.reportToken).toBe(t2)
  })

  it('共用端末の有無を保存する', async () => {
    const coa = (await listSites())[1]!
    await setSharedDevice(coa.id, true)
    expect((await listSites())[1]!.sharedDevice).toBe(true)
  })
})
