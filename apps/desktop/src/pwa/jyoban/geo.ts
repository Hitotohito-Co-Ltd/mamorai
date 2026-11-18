// [勤務員PWA・上番報告] 報告の瞬間だけスマホの現在地を取る（常時の追跡はしない）。
import type { GeoFix } from '@mamorai/input-core'

export type FixFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'
export type FixResult = { ok: true; fix: GeoFix & { at: string } } | { ok: false; reason: FixFailure }

export const FIX_FAILURE_MESSAGE: Record<FixFailure, string> = {
  denied: '位置情報の利用が許可されていません。スマホの設定で、このアプリ（ブラウザ）の位置情報を「許可」にしてください',
  unavailable: '現在地を取得できませんでした。位置情報（GPS）がオンになっているか確認してください',
  timeout: '現在地の取得に時間がかかっています。窓際や屋外で、もう一度お試しください',
  unsupported: 'この端末では現在地を取得できません',
}

/** 現在地を1回だけ取得する。古い位置（30秒より前）は使わない。 */
export function getCurrentFix(timeoutMs = 15000): Promise<FixResult> {
  const geo = globalThis.navigator?.geolocation
  if (geo === undefined) return Promise.resolve({ ok: false, reason: 'unsupported' })
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (p) => resolve({ ok: true, fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: new Date(p.timestamp).toISOString() } }),
      (e) => resolve({ ok: false, reason: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}
