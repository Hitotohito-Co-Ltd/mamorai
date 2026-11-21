// [勤務員アプリ・設定] 入力の整え方と画像の縮小サイズ（純粋関数）。期限の判定は input-core の classifyQualification を使う。
import { classifyQualification, type QualificationStatus } from '@mamorai/input-core'

export const CREDENTIAL_KINDS = [
  { key: 'kentei', label: '警備員検定' },
  { key: 'shido', label: '指導教育責任者' },
  { key: 'shinnin', label: '新任教育' },
  { key: 'genin', label: '現任教育' },
  { key: 'kenshin', label: '健康診断' },
  { key: 'other', label: 'その他' },
] as const
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number]['key']
export const kindLabel = (k: string): string => CREDENTIAL_KINDS.find((x) => x.key === k)?.label ?? 'その他'

/** 電話番号: ハイフン・空白を除く。空なら null。形式が正しくなければ null と理由。 */
export function normalizePhone(raw: string): { value: string | null; error?: string } {
  const v = raw.replace(/[-\s]/g, '')
  if (v === '') return { value: null }
  if (!/^(\+[1-9][0-9]{7,14}|0[0-9]{9,10})$/.test(v)) return { value: null, error: '電話番号の形式が正しくありません（例: 09012345678）' }
  return { value: v }
}

export function normalizePostal(raw: string): { value: string | null; error?: string } {
  const v = raw.replace(/[-\s]/g, '')
  if (v === '') return { value: null }
  if (!/^[0-9]{7}$/.test(v)) return { value: null, error: '郵便番号は7桁の数字です（例: 100-0001）' }
  return { value: `${v.slice(0, 3)}-${v.slice(3)}` }
}

/** 有効期限の状態（期限なしは null）。30日以内を「更新間近」とする。 */
export function expiryStatus(expiresOn: string | null, today: string): QualificationStatus | null {
  if (!expiresOn) return null
  return classifyQualification(expiresOn, today, 30)
}

/** 長辺が max を超えるときだけ縮小したサイズ（拡大はしない）。 */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const k = max / longest
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** PIN変更の入力チェック（4〜8桁の数字・確認が一致・現在と同じでない）。問題なければ null。 */
export function checkNewPin(oldPin: string, p1: string, p2: string): string | null {
  if (!/^\d{4,8}$/.test(p1)) return '新しいPINは4〜8桁の数字です'
  if (p1 !== p2) return '確認用のPINが一致しません'
  if (p1 === oldPin) return '現在と同じPINには変更できません'
  return null
}
