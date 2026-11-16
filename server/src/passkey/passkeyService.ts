// [BIO] 勤務員アプリの生体認証（WebAuthn パスキー）の登録と本人確認。
//   ・顔・指紋は端末の中で照合され、ここに届くのは署名だけ。保存するのは公開鍵と認証回数のみ。
//   ・勤務員は Supabase Auth を持たないため、端末シークレット（PINで本人登録した端末に発行済み）で
//     「どの勤務員の、どの端末か」を特定してから、その勤務員のパスキーだけで検証する。
//   ・本人確認に成功すると DB が端末に確認時刻を記録し、5分以内の上番報告に bio_verified が付く（0410）。
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

export interface DeviceStaff {
  deviceId: string
  staffId: string
  staffNo: string
  staffName: string
  dept: string
  credentials: Array<{ id: string; transports: AuthenticatorTransportFuture[] }>
}

export interface StoredPasskey {
  id: string
  publicKey: string // base64url
  counter: number
  transports: AuthenticatorTransportFuture[]
}

export type Purpose = 'register' | 'verify'

/** DB 側（0410 の service_role 専用 RPC）。 */
export interface PasskeyStore {
  deviceStaff(deviceSecret: string): Promise<DeviceStaff | null>
  saveChallenge(deviceId: string, purpose: Purpose, challenge: string): Promise<void>
  takeChallenge(deviceId: string, purpose: Purpose): Promise<string | null>
  add(deviceId: string, cred: { id: string; publicKey: string; counter: number; transports: string[] }, label: string | null): Promise<void>
  get(deviceId: string, credentialId: string): Promise<StoredPasskey | null>
  markVerified(deviceId: string, passkeyId: string, counter: number): Promise<string>
}

/** WebAuthn ライブラリ（テストで差し替えられるように注入する）。 */
export interface WebAuthnLib {
  generateRegistrationOptions: typeof generateRegistrationOptions
  verifyRegistrationResponse: typeof verifyRegistrationResponse
  generateAuthenticationOptions: typeof generateAuthenticationOptions
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse
}

export const defaultWebAuthnLib: WebAuthnLib = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
}

export interface PasskeyConfig {
  rpId: string // 勤務員アプリのドメイン（例 mamorai.tryangrow.com）
  rpName: string
  origins: string[] // 勤務員アプリのオリジン（例 https://mamorai.tryangrow.com）
}

export interface Result {
  status: number
  body: Record<string, unknown>
}

const fail = (status: number, error: string): Result => ({ status, body: { error } })

const DEVICE_SECRET = /^[0-9a-f]{64}$/

interface DeviceInput {
  deviceSecret?: unknown
}

/** UUID の文字列を 16バイトにする（WebAuthn の userID に使う。個人情報は入れない）。 */
export function uuidToBytes(uuid: string): Uint8Array<ArrayBuffer> {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('invalid uuid')
  const out = new Uint8Array(new ArrayBuffer(16))
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function readConfig(env: Record<string, string | undefined>): PasskeyConfig | null {
  const rpId = env.WEBAUTHN_RP_ID?.trim()
  const origins = (env.WEBAUTHN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
  if (rpId === undefined || rpId === '' || origins.length === 0) return null
  return { rpId, rpName: env.WEBAUTHN_RP_NAME?.trim() || 'MAMOR-AI', origins }
}

export function createPasskeyService(store: PasskeyStore, cfg: PasskeyConfig, lib: WebAuthnLib = defaultWebAuthnLib) {
  async function device(input: DeviceInput): Promise<DeviceStaff | Result> {
    const { deviceSecret } = input
    if (typeof deviceSecret !== 'string' || !DEVICE_SECRET.test(deviceSecret)) return fail(400, '端末の情報が不正です')
    const d = await store.deviceStaff(deviceSecret)
    return d ?? fail(401, 'この端末は本人登録されていません。スタッフNoとPINでログインし直してください')
  }

  return {
    /** 登録の準備: 端末の勤務員向けにパスキー作成のオプションを返す。 */
    async registerOptions(input: DeviceInput): Promise<Result> {
      const d = await device(input)
      if ('status' in d) return d
      const options = await lib.generateRegistrationOptions({
        rpName: cfg.rpName,
        rpID: cfg.rpId,
        userID: uuidToBytes(d.staffId),
        userName: d.staffNo,
        userDisplayName: d.staffName,
        attestationType: 'none',
        excludeCredentials: d.credentials,
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
      })
      await store.saveChallenge(d.deviceId, 'register', options.challenge)
      return { status: 200, body: { options } }
    },

    /** 登録の確定: 端末が作った公開鍵を検証して保存する。 */
    async registerVerify(input: DeviceInput & { response?: unknown; label?: unknown }): Promise<Result> {
      const d = await device(input)
      if ('status' in d) return d
      if (typeof input.response !== 'object' || input.response === null) return fail(400, '登録の内容がありません')
      const expectedChallenge = await store.takeChallenge(d.deviceId, 'register')
      if (expectedChallenge === null) return fail(400, '時間切れです。もう一度お試しください')
      let verification
      try {
        verification = await lib.verifyRegistrationResponse({
          response: input.response as RegistrationResponseJSON,
          expectedChallenge,
          expectedOrigin: cfg.origins,
          expectedRPID: cfg.rpId,
          requireUserVerification: true,
        })
      } catch {
        return fail(400, '顔・指紋の登録を確認できませんでした')
      }
      if (!verification.verified || verification.registrationInfo === undefined) {
        return fail(400, '顔・指紋の登録を確認できませんでした')
      }
      const c = verification.registrationInfo.credential
      const label = typeof input.label === 'string' ? input.label.slice(0, 300) : null
      await store.add(d.deviceId, {
        id: c.id,
        publicKey: isoBase64URL.fromBuffer(c.publicKey),
        counter: c.counter,
        transports: c.transports ?? [],
      }, label)
      return { status: 200, body: { ok: true } }
    },

    /** 本人確認の準備: その勤務員のパスキーで署名を求めるオプションを返す。 */
    async verifyOptions(input: DeviceInput): Promise<Result> {
      const d = await device(input)
      if ('status' in d) return d
      if (d.credentials.length === 0) return fail(409, '顔・指紋がまだ登録されていません')
      const options = await lib.generateAuthenticationOptions({
        rpID: cfg.rpId,
        allowCredentials: d.credentials,
        userVerification: 'required',
        timeout: 60_000,
      })
      await store.saveChallenge(d.deviceId, 'verify', options.challenge)
      return { status: 200, body: { options } }
    },

    /** 本人確認: 署名を検証し、端末に確認時刻を記録して勤務員の情報を返す（ログイン・報告の前に使う）。 */
    async verify(input: DeviceInput & { response?: unknown }): Promise<Result> {
      const d = await device(input)
      if ('status' in d) return d
      const response = input.response as AuthenticationResponseJSON | undefined
      if (typeof response !== 'object' || response === null || typeof response.id !== 'string') {
        return fail(400, '確認の内容がありません')
      }
      const expectedChallenge = await store.takeChallenge(d.deviceId, 'verify')
      if (expectedChallenge === null) return fail(400, '時間切れです。もう一度お試しください')
      const key = await store.get(d.deviceId, response.id)
      if (key === null) return fail(401, 'この端末の顔・指紋ではありません。PINでログインしてください')
      let verification
      try {
        verification = await lib.verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: cfg.origins,
          expectedRPID: cfg.rpId,
          credential: {
            id: response.id,
            publicKey: new Uint8Array(isoBase64URL.toBuffer(key.publicKey)),
            counter: key.counter,
            transports: key.transports,
          },
          requireUserVerification: true,
        })
      } catch {
        return fail(401, '顔・指紋を確認できませんでした')
      }
      if (!verification.verified) return fail(401, '顔・指紋を確認できませんでした')
      const verifiedAt = await store.markVerified(d.deviceId, key.id, verification.authenticationInfo.newCounter)
      return {
        status: 200,
        body: { ok: true, verifiedAt, staff: { no: d.staffNo, name: d.staffName, dept: d.dept } },
      }
    },
  }
}

export type PasskeyService = ReturnType<typeof createPasskeyService>
