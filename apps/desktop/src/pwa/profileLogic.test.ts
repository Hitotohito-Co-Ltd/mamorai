import { describe, expect, it } from 'vitest'
import { checkNewPin, expiryStatus, fitSize, normalizePhone, normalizePostal } from './profileLogic.js'

describe('profileLogic', () => {
  it('電話番号を整え、形式が違えば理由を返す', () => {
    expect(normalizePhone('090-0000-0000')).toEqual({ value: '09000000000' })
    expect(normalizePhone('  ')).toEqual({ value: null })
    expect(normalizePhone('123').error).toBeTruthy()
  })
  it('郵便番号を 3-4 桁にそろえる', () => {
    expect(normalizePostal('1000001')).toEqual({ value: '100-0001' })
    expect(normalizePostal('100-0001')).toEqual({ value: '100-0001' })
    expect(normalizePostal('10').error).toBeTruthy()
  })
  it('期限の状態: 切れ・間近(30日)・有効・期限なし', () => {
    expect(expiryStatus('2026-01-01', '2026-02-01')).toBe('期限切れ')
    expect(expiryStatus('2026-02-20', '2026-02-01')).toBe('更新間近')
    expect(expiryStatus('2027-02-01', '2026-02-01')).toBe('有効')
    expect(expiryStatus(null, '2026-02-01')).toBeNull()
  })
  it('画像は長辺だけ縮小し、拡大しない', () => {
    expect(fitSize(4000, 3000, 1000)).toEqual({ w: 1000, h: 750 })
    expect(fitSize(800, 600, 1000)).toEqual({ w: 800, h: 600 })
  })
  it('PIN変更の入力チェック', () => {
    expect(checkNewPin('1234', '5678', '5678')).toBeNull()
    expect(checkNewPin('1234', '56', '56')).toBeTruthy()
    expect(checkNewPin('1234', '5678', '5679')).toBeTruthy()
    expect(checkNewPin('1234', '1234', '1234')).toBeTruthy()
    expect(checkNewPin('1234', 'abcd', 'abcd')).toBeTruthy()
  })
})
