// [上番報告・勤務員PWA] データ層（デモ動作）: トークン解決・本人登録・共用端末・二重送信・取消
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  tokenFromPath, rememberToken, fetchContext, registerDevice, submitReport, voidReport,
  saveDevice, ReportAuthError,
} from './reportApi.js'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 30, 7, 30)) // 10/30(金) 7:30（端末の現地時刻）
})
afterEach(() => { vi.useRealTimers() })

describe('tokenFromPath', () => {
  it('/app/r/<トークン> からトークンを取り出す', () => {
    expect(tokenFromPath('/app/r/AbC123_x-9')).toBe('AbC123_x-9')
    expect(tokenFromPath('/app/r/AbC123_x-9/')).toBe('AbC123_x-9')
  })
  it('/app/r/ だけ（ホーム画面から起動）なら前回のトークン、無ければ null', () => {
    expect(tokenFromPath('/app/r/')).toBeNull()
    rememberToken('PrevTok123')
    expect(tokenFromPath('/app/r/')).toBe('PrevTok123')
  })
  it('使えない文字を含むパスはトークンとして扱わない', () => {
    expect(tokenFromPath('/app/r/../../etc')).toBeNull()
  })
})

describe('報告（デモ動作）', () => {
  // デモの 'demo-site' トークン = ららぽーと立川立飛（共用端末ON・日勤1 8:00/上番締切7:45、日勤2 9:30/9:15）
  it('共用端末の現場: 本人なしで受付中の勤務枠が出る', async () => {
    const c = await fetchContext('demo-site')
    expect(c.site).toMatchObject({ name: 'ららぽーと立川立飛', shared: true })
    expect(c.staff).toBeNull()
    expect(c.slots.map((s) => s.name)).toEqual(['日勤1（荷捌）', '日勤2（隊長）'])
    expect(c.slots[0]!.workDate).toBe('2026-10-30')
  })

  it('無効なQRは分かるメッセージで拒否', async () => {
    await expect(fetchContext('nosuchtoken')).rejects.toThrow('QRコードが無効です')
  })

  it('本人登録: PIN誤りは ReportAuthError、正しければ氏名が返る', async () => {
    await expect(registerDevice('demo-site', '783', '0000')).rejects.toBeInstanceOf(ReportAuthError)
    const d = await registerDevice('demo-site', '783', '0412')
    expect(d).toMatchObject({ staffNo: '783', staffName: '三角 龍彦' })
  })

  it('共用端末: スタッフNo＋PINが必要で、同じ報告は二重登録しない', async () => {
    const [slot] = (await fetchContext('demo-site')).slots
    await expect(submitReport('demo-site', { slotId: slot!.id, type: 'onduty', staffNo: '783', pin: '9999' })).rejects.toBeInstanceOf(ReportAuthError)
    const a = await submitReport('demo-site', { slotId: slot!.id, type: 'onduty', staffNo: '783', pin: '0412' })
    const b = await submitReport('demo-site', { slotId: slot!.id, type: 'onduty', staffNo: '783', pin: '0412' })
    expect(a.status).toBe('sent')
    expect(b.status === 'sent' && b.result.duplicate).toBe(true)
    const c = await fetchContext('demo-site')
    expect(c.slots[0]!.reports.map((r) => [r.type, r.staffName, r.receivedAt])).toEqual([['onduty', '三角 龍彦', '2026-10-30T07:30']])
  })

  it('個人スマホ: 登録後は端末だけで送信でき、取消すると未送信に戻る', async () => {
    const d = await registerDevice('demo-site', '784', '0903')
    saveDevice({ secret: d.secret, staffNo: d.staffNo, staffName: d.staffName })
    const ctx = await fetchContext('demo-site')
    expect(ctx.staff).toEqual({ no: '784', name: '藤井 隆幸' })
    const slot = ctx.slots[1]!
    const out = await submitReport('demo-site', { slotId: slot.id, type: 'onduty' })
    expect(out.status).toBe('sent')
    expect((await fetchContext('demo-site')).slots[1]!.reports).toHaveLength(1)
    if (out.status === 'sent') await voidReport('demo-site', out.result.reportId)
    expect((await fetchContext('demo-site')).slots[1]!.reports).toHaveLength(0)
  })

  it('その他報告: 遅刻は到着見込みが無ければ送らない', async () => {
    const d = await registerDevice('demo-site', '783', '0412')
    saveDevice(d)
    const [slot] = (await fetchContext('demo-site')).slots
    await expect(submitReport('demo-site', { slotId: slot!.id, type: 'other', otherKind: 'late' })).rejects.toThrow('到着見込み時刻')
    const ok = await submitReport('demo-site', { slotId: slot!.id, type: 'other', otherKind: 'late', eta: '08:20', note: '電車遅延' })
    expect(ok.status).toBe('sent')
  })

  it('受付時間外の勤務枠は出さない（終了2時間後で締める）', async () => {
    vi.setSystemTime(new Date(2026, 9, 30, 19, 30)) // 日勤1(〜17:00)は締め、日勤2(〜18:30)は20:30まで受付
    expect((await fetchContext('demo-site')).slots.map((s) => s.name)).toEqual(['日勤2（隊長）'])
    vi.setSystemTime(new Date(2026, 9, 30, 20, 31)) // 当日分はすべて締め、翌日の日勤1（8:00開始）が開始12時間前から受付
    expect((await fetchContext('demo-site')).slots.map((s) => [s.name, s.workDate])).toEqual([['日勤1（荷捌）', '2026-10-31']])
  })
})

describe('最近使った現場（掛け持ち）', () => {
  it('QRを読んだ現場を新しい順に覚え、同じ現場は重複させない', async () => {
    const { rememberSite, recentSites } = await import('./reportApi.js')
    rememberSite('TokA123456', 'A現場', '2026-10-28T07:00')
    rememberSite('TokB123456', 'B現場', '2026-10-29T07:00')
    rememberSite('TokA123456', 'A現場', '2026-10-30T07:00')
    expect(recentSites().map((s) => s.name)).toEqual(['A現場', 'B現場'])
  })
  it('上限を超えたら古いものから外す', async () => {
    const { rememberSite, recentSites } = await import('./reportApi.js')
    for (let i = 1; i <= 9; i++) rememberSite(`TokSite00${i}`, `現場${i}`, `2026-10-0${i}T07:00`)
    rememberSite('TokSite010', '現場10', '2026-10-10T07:00')
    rememberSite('TokSite011', '現場11', '2026-10-11T07:00')
    expect(recentSites()).toHaveLength(10)
    expect(recentSites().map((s) => s.name)).not.toContain('現場1')
  })
  it('現場名が変わったら新しい名前で上書き', async () => {
    const { rememberSite, recentSites } = await import('./reportApi.js')
    rememberSite('TokA123456', '旧名', '2026-10-29T07:00')
    rememberSite('TokA123456', '新名', '2026-10-30T07:00')
    expect(recentSites()).toEqual([{ token: 'TokA123456', name: '新名', usedAt: '2026-10-30T07:00' }])
  })
  it('使えなくなったQRは一覧から外す', async () => {
    const { rememberSite, forgetSite, recentSites } = await import('./reportApi.js')
    rememberSite('TokA123456', 'A現場', '2026-10-29T07:00')
    rememberSite('TokB123456', 'B現場', '2026-10-30T07:00')
    forgetSite('TokB123456')
    expect(recentSites().map((s) => s.token)).toEqual(['TokA123456'])
  })
})

describe('起動時の現場の決め方', () => {
  it('QRから開いたら（パスにトークン）その現場', async () => {
    const { resolveStart, rememberSite } = await import('./reportApi.js')
    rememberSite('TokA123456', 'A現場', '2026-10-29T07:00')
    rememberSite('TokB123456', 'B現場', '2026-10-30T07:00')
    expect(resolveStart('/app/r/TokC123456')).toEqual({ token: 'TokC123456', pick: false })
  })
  it('ホーム画面から開き（トークンなし）覚えている現場が2つ以上なら選んでもらう', async () => {
    const { resolveStart, rememberSite } = await import('./reportApi.js')
    rememberSite('TokA123456', 'A現場', '2026-10-29T07:00')
    rememberSite('TokB123456', 'B現場', '2026-10-30T07:00')
    expect(resolveStart('/app/r/')).toEqual({ token: null, pick: true })
  })
  it('覚えている現場が1つならそのまま開く', async () => {
    const { resolveStart, rememberSite } = await import('./reportApi.js')
    rememberSite('TokA123456', 'A現場', '2026-10-29T07:00')
    expect(resolveStart('/app/r/')).toEqual({ token: 'TokA123456', pick: false })
  })
  it('何も覚えていなければ「QRを読んでください」（以前の版で保存したトークンは引き継ぐ）', async () => {
    const { resolveStart, rememberToken } = await import('./reportApi.js')
    expect(resolveStart('/app/r/')).toEqual({ token: null, pick: false })
    rememberToken('LegacyTok1')
    expect(resolveStart('/app/r/')).toEqual({ token: 'LegacyTok1', pick: false })
  })
})

describe('QR読み取り結果の解析', () => {
  it('報告用URLからトークンを取り出す（末尾スラッシュ・クエリも許容）', async () => {
    const { tokenFromScan } = await import('./reportApi.js')
    expect(tokenFromScan('https://mamorai.tryangrow.com/app/r/AbC123_x-9')).toBe('AbC123_x-9')
    expect(tokenFromScan('https://mamorai.tryangrow.com/app/r/AbC123_x-9/?utm=qr')).toBe('AbC123_x-9')
    expect(tokenFromScan('  AbC123_x-9  ')).toBe('AbC123_x-9')
  })
  it('報告用でないQR・不正な文字は null', async () => {
    const { tokenFromScan } = await import('./reportApi.js')
    expect(tokenFromScan('https://example.com/menu')).toBeNull()
    expect(tokenFromScan('https://x.example/app/r/../../etc')).toBeNull()
    expect(tokenFromScan('こんにちは')).toBeNull()
    expect(tokenFromScan('')).toBeNull()
  })
})

describe('勤務員アプリのログインで端末登録（デモ動作）', () => {
  it('ログインのスタッフNo＋PINで端末を登録し、上番報告で本人として扱われる', async () => {
    const { ensureLoginDevice, loadDevice } = await import('./reportApi.js')
    const r = await ensureLoginDevice('HTH-0001', '783', '0412')
    expect(r).toEqual({ ok: true })
    expect(loadDevice()).toMatchObject({ staffNo: '783', staffName: '三角 龍彦' })
    const c = await fetchContext('demo-site')
    expect(c.staff).toEqual({ no: '783', name: '三角 龍彦' })
  })
  it('同じ人の端末登録が残っていれば登録し直さない', async () => {
    const { ensureLoginDevice, loadDevice } = await import('./reportApi.js')
    saveDevice({ secret: 'keep-'.padEnd(40, 'x'), staffNo: '783', staffName: '三角 龍彦' })
    await ensureLoginDevice('HTH-0001', '783', '0412')
    expect(loadDevice()!.secret.startsWith('keep-')).toBe(true)
  })
  it('別の人がログインしたら、その人で登録し直す', async () => {
    const { ensureLoginDevice, loadDevice } = await import('./reportApi.js')
    saveDevice({ secret: 'old-'.padEnd(40, 'x'), staffNo: '783', staffName: '三角 龍彦' })
    await ensureLoginDevice('HTH-0001', '784', '0903')
    expect(loadDevice()).toMatchObject({ staffNo: '784' })
  })
  it('PIN誤りは失敗を返し、端末登録は変えない', async () => {
    const { ensureLoginDevice, loadDevice } = await import('./reportApi.js')
    const r = await ensureLoginDevice('HTH-0001', '783', '0000')
    expect(r.ok).toBe(false)
    expect(loadDevice()).toBeNull()
  })
})

describe('登録現場の上限', () => {
  it('10件まで覚える（掛け持ち・応援の多い隊員向け）', async () => {
    const { rememberSite, recentSites } = await import('./reportApi.js')
    for (let i = 10; i <= 21; i++) rememberSite(`TokSite0${i}`, `現場${i}`, `2026-10-${i}T07:00`)
    expect(recentSites()).toHaveLength(10)
    expect(recentSites()[0]!.name).toBe('現場21')
  })
})
