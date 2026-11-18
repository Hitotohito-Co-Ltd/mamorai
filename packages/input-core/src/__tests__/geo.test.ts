// 上番・下番の位置確認: Plus Code の符号化・復号と、現場の範囲判定
import { describe, it, expect } from 'vitest'
import {
  encodePlusCode, decodePlusCode, recoverNearestPlusCode, isValidPlusCode, isFullPlusCode, isShortPlusCode,
} from '../geo/pluscode.js'
import {
  distanceMeters, judgeGeofence, geofenceApplies, parseLocationInput, prefectureReference, mapUrl,
  type SiteGeofence,
} from '../geo/geofence.js'

// 東京ミッドタウン八重洲付近（サンプル地点）
const P = { lat: 35.6790375, lng: 139.769234375 }

describe('Plus Code', () => {
  it('座標を11桁のコードにし、元の区画に戻せる', () => {
    expect(encodePlusCode(P.lat, P.lng)).toBe('8Q7XMQH9+JM9')
    expect(encodePlusCode(P.lat, P.lng, 10)).toBe('8Q7XMQH9+JM')
    const a = decodePlusCode('8Q7XMQH9+JM9')
    expect(a.lat).toBeCloseTo(P.lat, 6)
    expect(a.lng).toBeCloseTo(P.lng, 6)
    expect(a.latHi - a.latLo).toBeCloseTo(0.000025, 9)
  })

  it('短いコードを基準点の近くとして復元する', () => {
    expect(recoverNearestPlusCode('MQH9+JM9', 35.69, 139.69)).toBe('8Q7XMQH9+JM9')
    expect(recoverNearestPlusCode('mqh9+jm9', 35.2, 139.3)).toBe('8Q7XMQH9+JM9')
    // 完全なコードはそのまま
    expect(recoverNearestPlusCode('8Q7XMQH9+JM9', 0, 0)).toBe('8Q7XMQH9+JM9')
  })

  it('形の判定', () => {
    expect(isFullPlusCode('8Q7XMQH9+JM9')).toBe(true)
    expect(isShortPlusCode('MQH9+JM9')).toBe(true)
    expect(isValidPlusCode('8Q7X0000+')).toBe(true)
    expect(isValidPlusCode('8Q7XMQH9+J')).toBe(false) // 区切りの後1文字は不可
    expect(isValidPlusCode('ABCD+12')).toBe(false)
    expect(isValidPlusCode('MQH9JM9')).toBe(false)
  })

  it('符号化と復号を往復しても区画からはみ出さない', () => {
    for (const [lat, lng] of [[35.68, 139.77], [43.06, 141.35], [26.21, 127.68], [-33.86, 151.2], [51.5, -0.12], [89.99, 179.99], [-89.99, -180]]) {
      const a = decodePlusCode(encodePlusCode(lat!, lng!))
      expect(lat!).toBeGreaterThanOrEqual(a.latLo - 1e-9)
      expect(lat!).toBeLessThanOrEqual(a.latHi + 1e-9)
      expect(lng!).toBeGreaterThanOrEqual(a.lngLo - 1e-9)
      expect(lng!).toBeLessThanOrEqual(a.lngHi + 1e-9)
    }
  })
})

describe('現場の地点の入力', () => {
  it('Googleマップの短い Plus Code＋地域名', () => {
    const r = parseLocationInput('MQH9+JM9 中央区、東京都')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.plusCode).toBe('8Q7XMQH9+JM9')
    expect(r.value.source).toBe('plus_code_short')
    expect(r.value.reference).toBe('東京都')
    expect(distanceMeters(r.value.lat, r.value.lng, P.lat, P.lng)).toBeLessThan(1)
  })

  it('全角や英語の地域名でも読める', () => {
    expect(parseLocationInput('ＭＱＨ９＋ＪＭ９　中央区、東京都').ok).toBe(true)
    const r = parseLocationInput('MQH9+JM9 Chuo City, Tokyo')
    expect(r.ok && r.value.plusCode).toBe('8Q7XMQH9+JM9')
  })

  it('完全な Plus Code・緯度経度・GoogleマップのURL', () => {
    const a = parseLocationInput('8Q7XMQH9+JM9')
    expect(a.ok && a.value.source).toBe('plus_code')
    const b = parseLocationInput('35.6790375, 139.769234375')
    expect(b.ok && b.value.plusCode).toBe('8Q7XMQH9+JM9')
    const c = parseLocationInput('https://www.google.com/maps/place/x/@35.679,139.7692,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.6790375!4d139.769234375')
    expect(c.ok && c.value.plusCode).toBe('8Q7XMQH9+JM9')
    const d = parseLocationInput('https://www.google.com/maps/search/?api=1&query=35.6790375,139.769234375')
    expect(d.ok && d.value.source).toBe('map_url')
  })

  it('地域名がない短いコードは、登録済みの地点があればそれを基準にする', () => {
    expect(parseLocationInput('MQH9+JM9').ok).toBe(false)
    const r = parseLocationInput('MQH9+JM9', { lat: 35.68, lng: 139.77 })
    expect(r.ok && r.value.plusCode).toBe('8Q7XMQH9+JM9')
  })

  it('読めない入力はエラー文を返す', () => {
    expect(parseLocationInput('').ok).toBe(false)
    expect(parseLocationInput('東京駅').ok).toBe(false)
    expect(parseLocationInput('95, 139').ok).toBe(false)
    const u = parseLocationInput('https://maps.app.goo.gl/abc')
    expect(u.ok).toBe(false)
  })

  it('「東京都」を「京都府」と取り違えない', () => {
    expect(prefectureReference('中央区、東京都')?.name).toBe('東京都')
    expect(prefectureReference('下京区、京都府')?.name).toBe('京都府')
    expect(prefectureReference('Shimogyo Ward, Kyoto')?.name).toBe('京都府')
    expect(prefectureReference('立川市 東京')?.name).toBe('東京都')
    expect(prefectureReference('どこか')).toBeNull()
  })

  it('確認用の地図URL', () => {
    expect(mapUrl(P.lat, P.lng)).toBe('https://www.google.com/maps/search/?api=1&query=35.679037,139.769234')
  })
})

describe('範囲の判定', () => {
  const fence = (mode: SiteGeofence['mode'], radiusM = 200): SiteGeofence => ({ mode, lat: P.lat, lng: P.lng, radiusM })
  // 北へ約 n m の地点（緯度1度 ≒ 111.2km）
  const north = (m: number, accuracyM = 20): { lat: number; lng: number; accuracyM: number } => ({ lat: P.lat + m / 111195, lng: P.lng, accuracyM })

  it('距離（m）', () => {
    expect(distanceMeters(P.lat, P.lng, north(1000).lat, P.lng)).toBeCloseTo(1000, -1)
  })

  it('範囲内なら送れる', () => {
    const j = judgeGeofence(fence('required'), north(150))
    expect(j.status).toBe('inside')
    expect(j.allowed).toBe(true)
  })

  it('誤差の分（最大100m）だけ広げて判定する', () => {
    expect(judgeGeofence(fence('required'), north(260, 80)).status).toBe('inside')
    expect(judgeGeofence(fence('required'), north(320, 250)).status).toBe('outside') // 広げるのは100mまで
  })

  it('必須なら範囲外・位置なし・誤差大は送れない', () => {
    expect(judgeGeofence(fence('required'), north(600)).allowed).toBe(false)
    expect(judgeGeofence(fence('required'), north(600)).message).toMatch(/離れています/)
    expect(judgeGeofence(fence('required'), null)).toMatchObject({ status: 'no_fix', allowed: false })
    expect(judgeGeofence(fence('required'), north(10, 500))).toMatchObject({ status: 'low_accuracy', allowed: false })
  })

  it('記録だけなら範囲外でも送れる（範囲外として記録）', () => {
    expect(judgeGeofence(fence('record'), north(600))).toMatchObject({ status: 'outside', allowed: true })
    expect(judgeGeofence(fence('record'), null)).toMatchObject({ status: 'no_fix', allowed: true })
  })

  it('対象は上番・下番だけ。未設定の現場や「使わない」は対象外', () => {
    expect(geofenceApplies(fence('required'), 'onduty')).toBe(true)
    expect(geofenceApplies(fence('required'), 'offduty')).toBe(true)
    expect(geofenceApplies(fence('required'), 'departure')).toBe(false)
    expect(geofenceApplies(fence('off'), 'onduty')).toBe(false)
    expect(geofenceApplies({ mode: 'required', lat: null, lng: null, radiusM: 200 }, 'onduty')).toBe(false)
    expect(geofenceApplies(null, 'onduty')).toBe(false)
  })
})
