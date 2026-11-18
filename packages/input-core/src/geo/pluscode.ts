// Plus Code（Open Location Code）の符号化・復号。
//   Googleマップの「MQH9+JM9 中央区、東京都」のような短いコードと、「8Q7XMQH9+JM9」のような完全なコードを扱う。
//   仕様: https://github.com/google/open-location-code/blob/main/Documentation/Specification/specification.md
//   依存を増やさないため最小限を実装（符号化・復号・短いコードの復元）。

const ALPHABET = '23456789CFGHJMPQRVWX'
const SEPARATOR = '+'
const SEPARATOR_POS = 8
const PADDING = '0'
const PAIR_LEN = 10
const MAX_LEN = 15
const GRID_COLS = 4
const GRID_ROWS = 5
// 区画の大きさ（度）: 20°, 1°, 0.05°, 0.0025°, 0.000125°
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125]
// 整数で計算するための倍率（小数の誤差で隣の区画にずれないように）
const PAIR_PRECISION = 8000 // 1 / 0.000125
const GRID_LAT_PRECISION = PAIR_PRECISION * GRID_ROWS ** (MAX_LEN - PAIR_LEN)
const GRID_LNG_PRECISION = PAIR_PRECISION * GRID_COLS ** (MAX_LEN - PAIR_LEN)

export interface CodeArea {
  /** 区画の南西端 */
  latLo: number
  lngLo: number
  /** 区画の北東端 */
  latHi: number
  lngHi: number
  /** 区画の中心（地図で使う座標） */
  lat: number
  lng: number
  codeLength: number
}

const clipLat = (lat: number): number => Math.min(90, Math.max(-90, lat))
const normLng = (lng: number): number => {
  let x = lng
  while (x < -180) x += 360
  while (x >= 180) x -= 360
  return x
}

/** コードとして正しい形か（完全・短いの両方）。大文字小文字は問わない。 */
export function isValidPlusCode(code: string): boolean {
  const c = code.trim().toUpperCase()
  const sep = c.indexOf(SEPARATOR)
  if (sep < 0 || sep !== c.lastIndexOf(SEPARATOR) || sep > SEPARATOR_POS || sep % 2 === 1) return false
  const pad = c.indexOf(PADDING)
  if (pad >= 0) {
    // 埋め字は区切りの前だけ・偶数位置から・区切りまで連続・区切りの後に何もない
    if (sep < SEPARATOR_POS || pad === 0 || pad % 2 === 1) return false
    if (!/^0+$/.test(c.slice(pad, sep)) || c.length > sep + 1) return false
  }
  if (c.length - sep - 1 === 1) return false // 区切りの後が1文字だけは不可
  for (const ch of c.replace(SEPARATOR, '').replace(/0+/g, '')) if (!ALPHABET.includes(ch)) return false
  return true
}

/** 完全なコード（地域名なしで場所が決まる）か。 */
export function isFullPlusCode(code: string): boolean {
  if (!isValidPlusCode(code)) return false
  const c = code.trim().toUpperCase()
  if (c.indexOf(SEPARATOR) !== SEPARATOR_POS) return false
  // 先頭2文字が地球の範囲内（緯度 < 180°, 経度 < 360°）
  if (ALPHABET.indexOf(c[0]!) * 20 >= 180) return false
  if (c.length > 1 && ALPHABET.indexOf(c[1]!) * 20 >= 360) return false
  return true
}

/** 短いコード（地域名か基準点が必要）か。 */
export function isShortPlusCode(code: string): boolean {
  if (!isValidPlusCode(code)) return false
  const sep = code.trim().indexOf(SEPARATOR)
  return sep >= 0 && sep < SEPARATOR_POS
}

/** 座標 → 完全なコード（既定は11桁＝約3m四方。10桁で約14m四方）。 */
export function encodePlusCode(lat: number, lng: number, codeLength = 11): string {
  if (codeLength < 2 || (codeLength < PAIR_LEN && codeLength % 2 === 1) || codeLength > MAX_LEN) throw new Error('コードの桁数が不正です')
  let la = clipLat(lat)
  if (la === 90) la -= 0.5 * 10 ** -(codeLength > PAIR_LEN ? 9 : 7) // 北極ちょうどは一つ南の区画に入れる
  const lo = normLng(lng)
  let latVal = Math.floor(Math.round((la + 90) * GRID_LAT_PRECISION * 1e6) / 1e6)
  let lngVal = Math.floor(Math.round((lo + 180) * GRID_LNG_PRECISION * 1e6) / 1e6)
  let rev = ''
  if (codeLength > PAIR_LEN) {
    for (let i = 0; i < MAX_LEN - PAIR_LEN; i++) {
      const latDigit = latVal % GRID_ROWS
      const lngDigit = lngVal % GRID_COLS
      rev += ALPHABET[latDigit * GRID_COLS + lngDigit]
      latVal = Math.floor(latVal / GRID_ROWS)
      lngVal = Math.floor(lngVal / GRID_COLS)
    }
  } else {
    latVal = Math.floor(latVal / GRID_ROWS ** (MAX_LEN - PAIR_LEN))
    lngVal = Math.floor(lngVal / GRID_COLS ** (MAX_LEN - PAIR_LEN))
  }
  for (let i = 0; i < PAIR_LEN / 2; i++) {
    rev += ALPHABET[lngVal % 20]
    rev += ALPHABET[latVal % 20]
    latVal = Math.floor(latVal / 20)
    lngVal = Math.floor(lngVal / 20)
  }
  let code = rev.split('').reverse().join('')
  code = `${code.slice(0, SEPARATOR_POS)}${SEPARATOR}${code.slice(SEPARATOR_POS)}`
  if (codeLength >= SEPARATOR_POS) return code.slice(0, codeLength + 1)
  return `${code.slice(0, codeLength)}${PADDING.repeat(SEPARATOR_POS - codeLength)}${SEPARATOR}`
}

/** 完全なコード → 区画（中心の座標を地図で使う）。 */
export function decodePlusCode(code: string): CodeArea {
  if (!isFullPlusCode(code)) throw new Error('Plus Code の形式が正しくありません')
  const c = code.trim().toUpperCase().replace(SEPARATOR, '').replace(/0+$/, '').slice(0, MAX_LEN)
  let latVal = 0
  let lngVal = 0
  let latSize = 20 * PAIR_PRECISION
  let lngSize = 20 * PAIR_PRECISION
  const pairs = c.slice(0, PAIR_LEN)
  for (let i = 0; i < pairs.length; i += 2) {
    const place = 20 ** (4 - i / 2) // 20^4 … 20^0（PAIR_PRECISION 単位）
    latVal += ALPHABET.indexOf(pairs[i]!) * place
    lngVal += ALPHABET.indexOf(pairs[i + 1]!) * place
    latSize = place
    lngSize = place
  }
  // ここまでは「PAIR_PRECISION 倍した度」。グリッド部は更に細かい単位で積む
  let latG = latVal * GRID_ROWS ** (MAX_LEN - PAIR_LEN)
  let lngG = lngVal * GRID_COLS ** (MAX_LEN - PAIR_LEN)
  let latSizeG = latSize * GRID_ROWS ** (MAX_LEN - PAIR_LEN)
  let lngSizeG = lngSize * GRID_COLS ** (MAX_LEN - PAIR_LEN)
  const grid = c.slice(PAIR_LEN)
  let rowPlace = GRID_ROWS ** (MAX_LEN - PAIR_LEN - 1)
  let colPlace = GRID_COLS ** (MAX_LEN - PAIR_LEN - 1)
  for (const ch of grid) {
    const d = ALPHABET.indexOf(ch)
    latG += Math.floor(d / GRID_COLS) * rowPlace
    lngG += (d % GRID_COLS) * colPlace
    latSizeG = rowPlace
    lngSizeG = colPlace
    rowPlace /= GRID_ROWS
    colPlace /= GRID_COLS
  }
  const latLo = latG / GRID_LAT_PRECISION - 90
  const lngLo = lngG / GRID_LNG_PRECISION - 180
  const latHi = latLo + latSizeG / GRID_LAT_PRECISION
  const lngHi = lngLo + lngSizeG / GRID_LNG_PRECISION
  return {
    latLo, lngLo, latHi, lngHi,
    lat: Math.min(latLo + (latHi - latLo) / 2, 90),
    lng: Math.min(lngLo + (lngHi - lngLo) / 2, 180),
    codeLength: Math.min(c.length, MAX_LEN),
  }
}

/**
 * 短いコードを、基準点に一番近い場所として復元する（完全なコードはそのまま返す）。
 * 基準点から ±0.5°（約50km）以内なら正しく復元できる。
 */
export function recoverNearestPlusCode(shortCode: string, refLat: number, refLng: number): string {
  const s = shortCode.trim().toUpperCase()
  if (!isShortPlusCode(s)) {
    if (isFullPlusCode(s)) return s
    throw new Error('Plus Code の形式が正しくありません')
  }
  const la = clipLat(refLat)
  const lo = normLng(refLng)
  const padLen = SEPARATOR_POS - s.indexOf(SEPARATOR)
  const resolution = 20 ** (2 - padLen / 2)
  const half = resolution / 2
  const area = decodePlusCode(encodePlusCode(la, lo).slice(0, padLen) + s)
  let lat = area.lat
  let lng = area.lng
  if (la + half < lat && lat - resolution >= -90) lat -= resolution
  else if (la - half > lat && lat + resolution <= 90) lat += resolution
  if (lo + half < lng) lng -= resolution
  else if (lo - half > lng) lng += resolution
  return encodePlusCode(lat, lng, area.codeLength)
}
