// [BIO] パスキーの保存先: Supabase の service_role 専用 RPC（0410_biometric_passkey.sql）を REST で呼ぶ。
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import type { DeviceStaff, PasskeyStore, StoredPasskey } from './passkeyService.js'

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

const has = (v: string | undefined): v is string => v !== undefined && v !== ''

export function createSupabasePasskeyStore(env: Env, f: Fetch = fetch): PasskeyStore | null {
  if (!has(env.SUPABASE_URL) || !has(env.SUPABASE_SERVICE_ROLE_KEY)) return null
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await f(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`rpc ${name}: HTTP ${res.status}`)
    const text = await res.text()
    return (text === '' ? null : JSON.parse(text)) as T
  }
  const first = <T>(v: T[] | T | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  return {
    async deviceStaff(deviceSecret): Promise<DeviceStaff | null> {
      const row = first(await rpc<Array<Record<string, unknown>> | null>('passkey_device_staff', { p_device_secret: deviceSecret }))
      if (row === null) return null
      return {
        deviceId: String(row.device_id),
        staffId: String(row.staff_id),
        staffNo: String(row.staff_no),
        staffName: String(row.staff_name),
        dept: typeof row.dept === 'string' ? row.dept : '',
        credentials: (Array.isArray(row.credentials) ? row.credentials : []) as DeviceStaff['credentials'],
      }
    },
    async saveChallenge(deviceId, purpose, challenge) {
      await rpc('passkey_save_challenge', { p_device_id: deviceId, p_purpose: purpose, p_challenge: challenge })
    },
    takeChallenge: (deviceId, purpose) => rpc<string | null>('passkey_take_challenge', { p_device_id: deviceId, p_purpose: purpose }),
    async add(deviceId, cred, label) {
      await rpc('passkey_add', {
        p_device_id: deviceId, p_credential_id: cred.id, p_public_key: cred.publicKey,
        p_counter: cred.counter, p_transports: cred.transports, p_device_label: label,
      })
    },
    async get(deviceId, credentialId): Promise<StoredPasskey | null> {
      const row = first(await rpc<Array<Record<string, unknown>> | null>('passkey_get', {
        p_device_id: deviceId, p_credential_id: credentialId,
      }))
      if (row === null) return null
      return {
        id: String(row.id),
        publicKey: String(row.public_key),
        counter: Number(row.counter ?? 0),
        transports: (Array.isArray(row.transports) ? row.transports : []) as AuthenticatorTransportFuture[],
      }
    },
    async markVerified(deviceId, passkeyId, counter) {
      return String(await rpc<string>('passkey_mark_verified', { p_device_id: deviceId, p_passkey_id: passkeyId, p_counter: counter }))
    },
  }
}
