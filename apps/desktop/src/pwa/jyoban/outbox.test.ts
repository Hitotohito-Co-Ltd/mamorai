// [上番報告・勤務員PWA] 送信待ちキュー: 通信断なら端末に残し、つながったら同じ client_id で再送する（Supabase RPC をモック）
import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabaseClient.js', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({ rpc }),
}))

const { submitReport, flushOutbox, outbox, saveDevice } = await import('./reportApi.js')

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()
  rpc.mockReset()
  saveDevice({ secret: 'a'.repeat(64), staffNo: '10234', staffName: '笠井' })
})

const ok = { data: [{ report_id: 'r1', work_date: '2026-10-30', received_at: '2026-10-30T07:52', duplicate: false, error: null }], error: null }
const offline = { data: null, error: { message: 'TypeError: Failed to fetch' } }

describe('送信待ちキュー', () => {
  it('個人スマホで通信できなければ送信待ちに入り、復帰後に同じ client_id で送る', async () => {
    rpc.mockResolvedValueOnce(offline)
    const out = await submitReport('TOKEN123', { slotId: 's1', type: 'onduty' })
    expect(out.status).toBe('queued')
    expect(outbox()).toHaveLength(1)
    const clientId = outbox()[0]!.clientId

    rpc.mockResolvedValueOnce(ok)
    const r = await flushOutbox()
    expect(r).toMatchObject({ sent: 1, remaining: 0 })
    expect(outbox()).toHaveLength(0)
    expect(rpc).toHaveBeenLastCalledWith('jyoban_submit_report', expect.objectContaining({
      p_token: 'TOKEN123', p_slot_id: 's1', p_type: 'onduty', p_device_secret: 'a'.repeat(64), p_client_id: clientId,
    }))
  })

  it('まだ通信できなければ残したまま、以降も順番を崩さない', async () => {
    rpc.mockResolvedValue(offline)
    await submitReport('TOKEN123', { slotId: 's1', type: 'departure' })
    await submitReport('TOKEN123', { slotId: 's1', type: 'onduty' })
    const r = await flushOutbox()
    expect(r).toMatchObject({ sent: 0, remaining: 2 })
    expect(outbox().map((i) => i.input.type)).toEqual(['departure', 'onduty'])
  })

  it('サーバに拒否された報告はキューから外して失敗として返す', async () => {
    rpc.mockResolvedValueOnce(offline)
    await submitReport('TOKEN123', { slotId: 's1', type: 'onduty' })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'いまは「日勤」の報告を受け付ける時間ではありません' } })
    const r = await flushOutbox()
    expect(r.sent).toBe(0)
    expect(r.remaining).toBe(0)
    expect(r.failed[0]!.message).toContain('受け付ける時間ではありません')
  })

  it('共用端末（スタッフNo＋PIN）の報告は送信待ちにしない（PINを端末に残さない）', async () => {
    rpc.mockResolvedValueOnce(offline)
    await expect(submitReport('TOKEN123', { slotId: 's1', type: 'onduty', staffNo: '10234', pin: '1234' })).rejects.toThrow()
    expect(outbox()).toHaveLength(0)
  })

  it('PIN誤りなどRPCが error を返したら送信待ちにせず例外', async () => {
    rpc.mockResolvedValueOnce({ data: [{ report_id: null, work_date: null, received_at: null, duplicate: false, error: 'スタッフNoまたはPINが正しくありません' }], error: null })
    await expect(submitReport('TOKEN123', { slotId: 's1', type: 'onduty', staffNo: '1', pin: '0' })).rejects.toThrow('PINが正しくありません')
    expect(outbox()).toHaveLength(0)
  })
})
