// 上番・下番の位置確認（ジオフェンス）。現場の地点と半径を決め、報告時のスマホの位置が範囲内かを判定する。
//   判定の考え方は DB（0412 の jyoban_geo_judge）と同じ。画面では事前の案内に使い、最終判定は DB が行う。
import { decodePlusCode, encodePlusCode, isFullPlusCode, isShortPlusCode, recoverNearestPlusCode } from './pluscode.js'

/** off=使わない / record=位置を記録するだけ（範囲外でも報告できる） / required=範囲内でのみ報告できる */
export type GeofenceMode = 'off' | 'record' | 'required'
export const GEOFENCE_MODES: { mode: GeofenceMode; label: string; hint: string }[] = [
  { mode: 'off', label: '使わない', hint: '位置は確認しません' },
  { mode: 'record', label: '記録だけ', hint: '位置を記録します。範囲外でも報告でき、一覧に「範囲外」と出ます' },
  { mode: 'required', label: '範囲内でのみ報告可', hint: '現場の範囲内にいるときだけ報告できます' },
]
/** 位置を確認する報告の種類（出発・起床は自宅などから送るため対象外） */
export const GEOFENCE_REPORT_TYPES = ['onduty', 'offduty'] as const
export const GEOFENCE_RADIUS_OPTIONS = [50, 100, 150, 200, 300, 500, 1000]
export const GEOFENCE_RADIUS_MIN = 30
export const GEOFENCE_RADIUS_MAX = 2000
export const GEOFENCE_DEFAULT_RADIUS = 200
/** これより精度が悪い（誤差の大きい）位置は判定に使わない（m） */
export const GEOFENCE_MAX_ACCURACY_M = 300
/** 誤差の分だけ範囲を広げて判定する上限（m）。屋内でGPSがずれても上番できるように */
export const GEOFENCE_ACCURACY_ALLOWANCE_M = 100

export interface SiteGeofence {
  mode: GeofenceMode
  lat: number | null
  lng: number | null
  radiusM: number
}
export interface GeoFix {
  lat: number
  lng: number
  /** 誤差の目安（m） */
  accuracyM: number
}
export type GeoStatus = 'inside' | 'outside' | 'low_accuracy' | 'no_fix'
export interface GeoJudgement {
  status: GeoStatus
  /** 現場の中心からの距離（m）。位置がなければ null */
  distanceM: number | null
  /** この報告を送ってよいか（required のときだけ範囲外を止める） */
  allowed: boolean
  message: string
}

/** 2点間の距離（m・球面）。 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 位置確認の対象になる報告か。 */
export function geofenceApplies(fence: SiteGeofence | null | undefined, type: string): boolean {
  return fence != null && fence.mode !== 'off' && fence.lat !== null && fence.lng !== null
    && (GEOFENCE_REPORT_TYPES as readonly string[]).includes(type)
}

const fmtM = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`)

/** 範囲内かの判定。fix が null は位置を取れなかった（許可なし・電波なし等）。 */
export function judgeGeofence(fence: SiteGeofence, fix: GeoFix | null): GeoJudgement {
  const req = fence.mode === 'required'
  if (fence.lat === null || fence.lng === null || fence.mode === 'off') {
    return { status: 'inside', distanceM: null, allowed: true, message: '' }
  }
  if (fix === null || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return { status: 'no_fix', distanceM: null, allowed: !req, message: req ? '位置を確認できないため報告できません。位置情報をオンにして、もう一度お試しください' : '位置を確認できませんでした（このまま報告できます）' }
  }
  const d = distanceMeters(fence.lat, fence.lng, fix.lat, fix.lng)
  const acc = Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 ? fix.accuracyM : GEOFENCE_MAX_ACCURACY_M + 1
  if (acc > GEOFENCE_MAX_ACCURACY_M) {
    return { status: 'low_accuracy', distanceM: d, allowed: !req, message: req ? `位置の誤差が大きすぎます（約${fmtM(acc)}）。窓際や屋外で、もう一度位置を取得してください` : `位置の誤差が大きいため、範囲内か判定できませんでした（約${fmtM(acc)}）` }
  }
  if (d <= fence.radiusM + Math.min(acc, GEOFENCE_ACCURACY_ALLOWANCE_M)) {
    return { status: 'inside', distanceM: d, allowed: true, message: `現場の範囲内です（中心から約${fmtM(d)}）` }
  }
  return {
    status: 'outside', distanceM: d, allowed: !req,
    message: req ? `現場から約${fmtM(d)}離れています。現場（半径${fmtM(fence.radiusM)}）に着いてから報告してください` : `現場から約${fmtM(d)}離れています（範囲外として記録されます）`,
  }
}

export const GEO_STATUS_LABEL: Record<GeoStatus, string> = {
  inside: '範囲内', outside: '範囲外', low_accuracy: '位置不明（誤差大）', no_fix: '位置なし',
}

// ── 現場の地点の入力（Plus Code・緯度経度・GoogleマップのURL）──

/** 都道府県の基準点（県庁所在地付近）。短い Plus Code の復元に使う。 */
const PREFECTURES: [string[], number, number][] = [
  [['北海道', 'Hokkaido'], 43.064, 141.347], [['青森県', 'Aomori'], 40.824, 140.740], [['岩手県', 'Iwate'], 39.704, 141.153],
  [['宮城県', 'Miyagi'], 38.269, 140.872], [['秋田県', 'Akita'], 39.719, 140.102], [['山形県', 'Yamagata'], 38.240, 140.364],
  [['福島県', 'Fukushima'], 37.750, 140.468], [['茨城県', 'Ibaraki'], 36.342, 140.447], [['栃木県', 'Tochigi'], 36.566, 139.884],
  [['群馬県', 'Gunma'], 36.391, 139.061], [['埼玉県', 'Saitama'], 35.857, 139.649], [['千葉県', 'Chiba'], 35.605, 140.123],
  [['東京都', 'Tokyo'], 35.690, 139.692], [['神奈川県', 'Kanagawa'], 35.448, 139.643], [['新潟県', 'Niigata'], 37.902, 139.023],
  [['富山県', 'Toyama'], 36.695, 137.211], [['石川県', 'Ishikawa'], 36.595, 136.626], [['福井県', 'Fukui'], 36.065, 136.222],
  [['山梨県', 'Yamanashi'], 35.664, 138.568], [['長野県', 'Nagano'], 36.651, 138.181], [['岐阜県', 'Gifu'], 35.391, 136.722],
  [['静岡県', 'Shizuoka'], 34.977, 138.383], [['愛知県', 'Aichi'], 35.180, 136.907], [['三重県', 'Mie'], 34.730, 136.509],
  [['滋賀県', 'Shiga'], 35.004, 135.868], [['京都府', 'Kyoto'], 35.021, 135.756], [['大阪府', 'Osaka'], 34.686, 135.520],
  [['兵庫県', 'Hyogo'], 34.691, 135.183], [['奈良県', 'Nara'], 34.685, 135.833], [['和歌山県', 'Wakayama'], 34.226, 135.168],
  [['鳥取県', 'Tottori'], 35.504, 134.238], [['島根県', 'Shimane'], 35.472, 133.051], [['岡山県', 'Okayama'], 34.662, 133.935],
  [['広島県', 'Hiroshima'], 34.396, 132.459], [['山口県', 'Yamaguchi'], 34.186, 131.471], [['徳島県', 'Tokushima'], 34.066, 134.559],
  [['香川県', 'Kagawa'], 34.340, 134.043], [['愛媛県', 'Ehime'], 33.842, 132.766], [['高知県', 'Kochi'], 33.560, 133.531],
  [['福岡県', 'Fukuoka'], 33.607, 130.418], [['佐賀県', 'Saga'], 33.249, 130.299], [['長崎県', 'Nagasaki'], 32.745, 129.874],
  [['熊本県', 'Kumamoto'], 32.790, 130.742], [['大分県', 'Oita'], 33.238, 131.613], [['宮崎県', 'Miyazaki'], 31.911, 131.424],
  [['鹿児島県', 'Kagoshima'], 31.560, 130.558], [['沖縄県', 'Okinawa'], 26.212, 127.681],
]

/** 住所・地域名から都道府県の基準点を探す（「中央区、東京都」→ 東京都）。 */
export function prefectureReference(text: string): { name: string; lat: number; lng: number } | null {
  const t = text.normalize('NFKC')
  for (const [names, lat, lng] of PREFECTURES) {
    for (const n of names) {
      // 「東京都」に含まれる「京都」を誤って拾わないよう、日本語は都道府県の字まで含めて照合する
      const hit = /^[A-Za-z]/.test(n) ? new RegExp(`\\b${n}\\b`, 'i').test(t) : t.includes(n)
      if (hit) return { name: names[0]!, lat, lng }
    }
  }
  // 「都・府・県」を省いた日本語（例: 「中央区 東京」）
  for (const [names, lat, lng] of PREFECTURES) {
    const short = names[0]!.replace(/[都府県]$/, '')
    if (short !== '北海道' && short.length >= 2 && new RegExp(`(^|[\\s、,])${short}($|[\\s、,])`).test(t)) return { name: names[0]!, lat, lng }
  }
  return null
}

export interface ParsedLocation {
  lat: number
  lng: number
  /** 完全な Plus Code（11桁＝約3m四方） */
  plusCode: string
  /** どう解釈したか（画面で確認してもらう） */
  source: 'plus_code' | 'plus_code_short' | 'lat_lng' | 'map_url'
  /** 短いコードを地域名から復元したとき、その地域 */
  reference?: string
}
export type ParseLocationResult = { ok: true; value: ParsedLocation } | { ok: false; message: string }

const inRange = (lat: number, lng: number): boolean => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
function fromLatLng(lat: number, lng: number, source: ParsedLocation['source']): ParseLocationResult {
  if (!inRange(lat, lng)) return { ok: false, message: '緯度・経度の値が範囲外です' }
  return { ok: true, value: { lat, lng, plusCode: encodePlusCode(lat, lng), source } }
}

/**
 * 現場の地点の入力を解釈する。受け付ける形:
 *  - Plus Code（完全）  8Q7XMQH9+JM9
 *  - Plus Code（短い＋地域名）  MQH9+JM9 中央区、東京都   ※地域名から都道府県を判別して復元
 *  - 緯度,経度  35.67904, 139.76923
 *  - GoogleマップのURL（…/@35.679,139.769,17z や ?q=35.679,139.769）
 * fallback は短いコードに地域名がないときの基準点（既に登録済みの現場の地点など）。
 */
export function parseLocationInput(input: string, fallback?: { lat: number; lng: number }): ParseLocationResult {
  const text = input.normalize('NFKC').trim()
  if (text === '') return { ok: false, message: '場所を入力してください' }

  // GoogleマップのURL
  if (/^https?:\/\//i.test(text)) {
    const at = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(text)
    const q = /[?&](?:q|query|ll|center|destination)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C)\s*(-?\d{1,3}(?:\.\d+)?)/i.exec(text)
    const d = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(text) // 場所のピン（@ は画面の中心なのでこちらを優先）
    const m = d ?? q ?? at
    if (m) return fromLatLng(Number(m[1]), Number(m[2]), 'map_url')
    const pc = /[?&](?:q|query)=([23456789CFGHJMPQRVWX]{4,8}(?:\+|%2B)[23456789CFGHJMPQRVWX]{2,7})/i.exec(text)
    if (pc) return parseLocationInput(decodeURIComponent(pc[1]!), fallback)
    return { ok: false, message: 'このURLからは場所を読み取れませんでした。Googleマップで場所を長押しして出る「緯度, 経度」か Plus Code を貼り付けてください' }
  }

  // 緯度,経度（「北緯」等の表記や空白区切りも許容）
  const ll = /^(?:北緯)?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,，、\s]\s*(?:東経)?\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(text)
  if (ll) return fromLatLng(Number(ll[1]), Number(ll[2]), 'lat_lng')

  // Plus Code（先頭の語）＋ 残りは地域名
  const m = /^([23456789CFGHJMPQRVWX0]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})(?:[\s,、]+(.*))?$/i.exec(text)
  if (m) {
    const code = m[1]!.toUpperCase()
    const locality = (m[2] ?? '').trim()
    if (isFullPlusCode(code)) {
      const a = decodePlusCode(code)
      return { ok: true, value: { lat: a.lat, lng: a.lng, plusCode: encodePlusCode(a.lat, a.lng), source: 'plus_code' } }
    }
    if (isShortPlusCode(code)) {
      const ref = locality !== '' ? prefectureReference(locality) : null
      const base = ref ?? (fallback ? { name: '登録済みの地点', ...fallback } : null)
      if (base === null) {
        return { ok: false, message: locality === '' ? '短い Plus Code には地域名が必要です（例: MQH9+JM9 中央区、東京都）' : `地域名「${locality}」から都道府県を判別できませんでした。「東京都」のように都道府県名を含めてください` }
      }
      const full = recoverNearestPlusCode(code, base.lat, base.lng)
      const a = decodePlusCode(full)
      return { ok: true, value: { lat: a.lat, lng: a.lng, plusCode: encodePlusCode(a.lat, a.lng), source: 'plus_code_short', reference: base.name } }
    }
    return { ok: false, message: 'Plus Code の形式が正しくありません' }
  }
  return { ok: false, message: 'Plus Code（例: MQH9+JM9 中央区、東京都）か、緯度・経度（例: 35.6790, 139.7692）を入力してください' }
}

/** Googleマップで地点を開くURL（確認用）。 */
export function mapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`
}
