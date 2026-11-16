// [勤務員PWA・生体認証] 顔・指紋（WebAuthn パスキー）でのログインと、上番報告の本人確認。
//   ・顔・指紋は端末の中で照合され、アプリにもサーバーにも届かない。届くのは端末が作った署名だけ。
//   ・PIN で本人登録した端末（端末シークレット）にだけ登録できる。検証は APIゲートウェイ（/api/passkey）。
//   ・本人確認に成功すると、5分以内にこの端末から送った上番報告に「本人確認済み」が付く（0410）。
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import type { Device } from './jyoban/reportApi.js'

export type { BiometricMode } from './jyoban/reportApi.js'

/** 利用者に見せる文言を持つエラー。 */
export class BiometricError extends Error {
  constructor(message: string, readonly canceled = false) { super(message) }
}

const K_ENROLLED = 'mamorai.bio.enrolled'
const K_DISMISSED = 'mamorai.bio.dismissed'

function apiBase(): string | null {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>
  const b = env.VITE_API_BASE?.trim()
  return b ? b.replace(/\/$/, '') : null
}

function read<T>(k: string): T | null {
  try { const raw = globalThis.localStorage?.getItem(k); return raw ? (JSON.parse(raw) as T) : null } catch { return null }
}
function write(k: string, v: unknown): void {
  try { if (v === null) globalThis.localStorage?.removeItem(k); else globalThis.localStorage?.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

// 端末シークレットそのものは保存しない。どの端末登録に対する登録かを末尾だけで見分ける
const deviceTag = (d: Device): string => `${d.staffNo}:${d.secret.slice(-8)}`

/** この端末・この人で顔・指紋を登録済みか。 */
export function isEnrolled(d: Device | null): boolean {
  return d !== null && read<string>(K_ENROLLED) === deviceTag(d)
}
export function forgetEnrollment(): void { write(K_ENROLLED, null); write(K_DISMISSED, null) }
/** 「あとで」を選んだ人には、同じ端末登録のあいだ登録の案内を出さない。 */
export function enrollDismissed(d: Device | null): boolean {
  return d !== null && read<string>(K_DISMISSED) === deviceTag(d)
}
export function dismissEnroll(d: Device): void { write(K_DISMISSED, deviceTag(d)) }

/** この端末で顔・指紋が使えるか（APIゲートウェイの設定と、端末の生体認証の両方が必要）。 */
export async function biometricAvailable(): Promise<boolean> {
  if (apiBase() === null || !browserSupportsWebAuthn()) return false
  try { return await platformAuthenticatorIsAvailable() } catch { return false }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = apiBase()
  if (base === null) throw new BiometricError('この環境では顔・指紋を使えません')
  let res: Response
  try {
    res = await fetch(`${base}/api/passkey${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch {
    throw new BiometricError('通信できません。電波の良い場所でお試しください')
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new BiometricError(json.error ?? '顔・指紋を使えませんでした')
  return json
}

function fromBrowserError(e: unknown): BiometricError {
  if (e instanceof BiometricError) return e
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return new BiometricError('顔・指紋の確認をキャンセルしました', true)
  if (name === 'InvalidStateError') return new BiometricError('この端末はすでに登録されています')
  return new BiometricError('顔・指紋を使えませんでした。PINをお使いください')
}

/** 顔・指紋を登録する（ボタンを押したときに呼ぶ）。 */
export async function enrollBiometric(device: Device): Promise<void> {
  const auth = { deviceSecret: device.secret }
  try {
    const { options } = await post<{ options: PublicKeyCredentialCreationOptionsJSON }>('/register/options', auth)
    const response = await startRegistration({ optionsJSON: options })
    const label = globalThis.navigator?.userAgent?.slice(0, 300) ?? null
    await post('/register/verify', { ...auth, response, label })
    write(K_ENROLLED, deviceTag(device))
  } catch (e) {
    throw fromBrowserError(e)
  }
}

/** 本人確認の準備（画面を開いた時点で取っておくと、ボタンを押してすぐ顔・指紋の画面が出る）。 */
export async function prepareVerify(device: Device): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { options } = await post<{ options: PublicKeyCredentialRequestOptionsJSON }>('/verify/options', { deviceSecret: device.secret })
  return options
}

export interface VerifiedStaff { no: string; name: string; dept: string }

/** 顔・指紋で本人確認する。成功すると勤務員の情報を返す（ログイン・上番報告の直前に使う）。 */
export async function verifyBiometric(device: Device, prepared?: PublicKeyCredentialRequestOptionsJSON): Promise<VerifiedStaff> {
  try {
    const options = prepared ?? await prepareVerify(device)
    const response = await startAuthentication({ optionsJSON: options })
    const out = await post<{ staff: VerifiedStaff }>('/verify', { deviceSecret: device.secret, response })
    return out.staff
  } catch (e) {
    const err = fromBrowserError(e)
    // サーバー側で登録が消えていた（会社が失効させた等）ときは、次から案内し直す
    if (/まだ登録されていません|この端末の顔・指紋ではありません/.test(err.message)) write(K_ENROLLED, null)
    throw err
  }
}
