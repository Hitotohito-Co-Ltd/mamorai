// [BIO] パスキーの登録・本人確認の検証。
//   実際の @simplewebauthn/server で検証させるため、テスト内に「ソフトウェアの認証器」を用意し、
//   端末が作るのと同じ形式（attestation 'none'・ES256）で登録応答と署名を作る。
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, generateKeyPairSync, sign, randomBytes, type KeyObject } from 'node:crypto'
import { createPasskeyService, readConfig, uuidToBytes, type DeviceStaff, type PasskeyStore, type Purpose, type StoredPasskey } from './passkeyService.js'
import { createRateLimiter } from '../routes/passkey.js'

const RP_ID = 'mamorai.example.com'
const ORIGIN = 'https://mamorai.example.com'
const cfg = { rpId: RP_ID, rpName: 'MAMOR-AI', origins: [ORIGIN] }
const SECRET = 'a'.repeat(64)
const OTHER_SECRET = 'b'.repeat(64)

// ── 最小の CBOR エンコーダ（認証器の応答を組み立てる用）──
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b
  }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]) }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) { const b = Buffer.from(v); return Buffer.concat([head(2, b.length), b]) }
  if (v instanceof Map) {
    const parts: Buffer[] = [head(5, v.size)]
    for (const [k, val] of v) parts.push(cbor(k), cbor(val))
    return Buffer.concat(parts)
  }
  throw new Error('unsupported')
}
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url')
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest()

/** 端末の生体認証の代わりをするソフトウェア認証器（ES256）。 */
class SoftAuthenticator {
  readonly credId = randomBytes(32)
  private readonly priv: KeyObject
  private readonly jwk: { x: string; y: string }
  counter = 0
  constructor(private readonly rpId = RP_ID, private readonly origin = ORIGIN, private readonly uv = true) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.priv = privateKey
    this.jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  }
  private flags(at: boolean) { return (this.uv ? 0x05 : 0x01) | (at ? 0x40 : 0) }
  register(challenge: string) {
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]]))
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credId.length)
    const authData = Buffer.concat([sha256(Buffer.from(this.rpId)), Buffer.from([this.flags(true)]), Buffer.alloc(4),
      Buffer.alloc(16), len, this.credId, cose])
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: this.origin, crossOrigin: false }))
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))),
        transports: ['internal'],
      },
    }
  }
  assert(challenge: string, credId: Buffer = this.credId) {
    this.counter += 1
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter)
    const authData = Buffer.concat([sha256(Buffer.from(this.rpId)), Buffer.from([this.flags(false)]), cnt])
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: this.origin, crossOrigin: false }))
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.priv)
    return {
      id: b64u(credId), rawId: b64u(credId), type: 'public-key', authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) },
    }
  }
}

/** DB の代わり（0410 の RPC と同じ振る舞い）。 */
class MemStore implements PasskeyStore {
  devices = new Map<string, Omit<DeviceStaff, 'credentials'>>([
    [SECRET, { deviceId: 'dev-1', staffId: '5a000000-0000-0000-0000-000000000001', staffNo: '10234', staffName: '笠井', dept: '警備1課' }],
    [OTHER_SECRET, { deviceId: 'dev-2', staffId: '5a000000-0000-0000-0000-000000000002', staffNo: '20001', staffName: '萩原', dept: '警備1課' }],
  ])
  challenges: Array<{ deviceId: string; purpose: Purpose; challenge: string; used: boolean }> = []
  keys: Array<StoredPasskey & { deviceId: string; staffId: string; revoked: boolean }> = []
  verified: Array<{ deviceId: string; counter: number }> = []
  async deviceStaff(secret: string) {
    const d = this.devices.get(secret)
    if (d === undefined) return null
    return { ...d, credentials: this.keys.filter((k) => k.staffId === d.staffId && !k.revoked).map((k) => ({ id: k.id, transports: k.transports })) }
  }
  async saveChallenge(deviceId: string, purpose: Purpose, challenge: string) {
    for (const c of this.challenges) if (c.deviceId === deviceId && c.purpose === purpose) c.used = true
    this.challenges.push({ deviceId, purpose, challenge, used: false })
  }
  async takeChallenge(deviceId: string, purpose: Purpose) {
    const c = this.challenges.find((x) => x.deviceId === deviceId && x.purpose === purpose && !x.used)
    if (c === undefined) return null
    c.used = true
    return c.challenge
  }
  async add(deviceId: string, cred: { id: string; publicKey: string; counter: number; transports: string[] }) {
    const staffId = [...this.devices.values()].find((d) => d.deviceId === deviceId)!.staffId
    this.keys.push({ id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports as StoredPasskey['transports'], deviceId, staffId, revoked: false })
  }
  async get(deviceId: string, credentialId: string) {
    const staffId = [...this.devices.values()].find((d) => d.deviceId === deviceId)!.staffId
    const k = this.keys.find((x) => x.id === credentialId && x.staffId === staffId && !x.revoked)
    return k === undefined ? null : { id: k.id, publicKey: k.publicKey, counter: k.counter, transports: k.transports }
  }
  async markVerified(deviceId: string, passkeyId: string, counter: number) {
    const k = this.keys.find((x) => x.id === passkeyId)!
    k.counter = Math.max(k.counter, counter)
    this.verified.push({ deviceId, counter })
    return '2026-11-16T12:00:00+09:00'
  }
}

const me = { deviceSecret: SECRET }

async function registerWith(svc: ReturnType<typeof createPasskeyService>, auth: SoftAuthenticator, who = me) {
  const opt = await svc.registerOptions(who)
  const challenge = (opt.body.options as { challenge: string }).challenge
  return svc.registerVerify({ ...who, response: auth.register(challenge), label: 'iPhone' })
}
async function verifyWith(svc: ReturnType<typeof createPasskeyService>, auth: SoftAuthenticator, who = me, credId?: Buffer) {
  const opt = await svc.verifyOptions(who)
  if (opt.status !== 200) return opt
  const challenge = (opt.body.options as { challenge: string }).challenge
  return svc.verify({ ...who, response: auth.assert(challenge, credId) })
}

describe('passkeyService（実際の WebAuthn 検証）', () => {
  let store: MemStore
  let svc: ReturnType<typeof createPasskeyService>
  beforeEach(() => { store = new MemStore(); svc = createPasskeyService(store, cfg) })

  it('登録オプションは本人の端末にだけ出し、生体認証（UV）必須・端末内蔵の認証器を求める', async () => {
    const r = await svc.registerOptions(me)
    expect(r.status).toBe(200)
    const o = r.body.options as Record<string, any>
    expect(o.rp).toEqual({ name: 'MAMOR-AI', id: RP_ID })
    expect(o.user.name).toBe('10234')
    expect(o.authenticatorSelection).toMatchObject({ userVerification: 'required', authenticatorAttachment: 'platform' })
    expect(store.challenges).toHaveLength(1)
    expect((await svc.registerOptions({ deviceSecret: 'c'.repeat(64) })).status).toBe(401)
    expect((await svc.registerOptions({ deviceSecret: 'short' })).status).toBe(400)
  })

  it('登録して本人確認できる。勤務員の情報が返り、認証回数が更新される', async () => {
    const auth = new SoftAuthenticator()
    expect((await registerWith(svc, auth)).status).toBe(200)
    expect(store.keys).toHaveLength(1)
    const v = await verifyWith(svc, auth)
    expect(v.status).toBe(200)
    expect(v.body).toMatchObject({ ok: true, staff: { no: '10234', name: '笠井' } })
    expect(store.verified).toEqual([{ deviceId: 'dev-1', counter: 1 }])
    expect((await verifyWith(svc, auth)).status).toBe(200)
    expect(store.keys[0]!.counter).toBe(2)
  })

  it('未登録なら本人確認のオプションを出さない', async () => {
    expect((await svc.verifyOptions(me)).status).toBe(409)
  })

  it('チャレンジは使い回せない（同じ応答の再送は拒否）', async () => {
    const auth = new SoftAuthenticator()
    await registerWith(svc, auth)
    const opt = await svc.verifyOptions(me)
    const resp = auth.assert((opt.body.options as { challenge: string }).challenge)
    expect((await svc.verify({ ...me, response: resp })).status).toBe(200)
    expect((await svc.verify({ ...me, response: resp })).status).toBe(400)
  })

  it('別のサイト（フィッシング）向けの署名は拒否', async () => {
    const good = new SoftAuthenticator()
    await registerWith(svc, good)
    const evil = new SoftAuthenticator(RP_ID, 'https://evil.example.net')
    const opt = await svc.registerOptions(me)
    const r = await svc.registerVerify({ ...me, response: evil.register((opt.body.options as { challenge: string }).challenge) })
    expect(r.status).toBe(400)
  })

  it('生体認証なし（UVなし）の登録・確認は拒否', async () => {
    const noUv = new SoftAuthenticator(RP_ID, ORIGIN, false)
    expect((await registerWith(svc, noUv)).status).toBe(400)
    expect(store.keys).toHaveLength(0)
  })

  it('他人のパスキーでは本人確認できない（萩原の端末から笠井の鍵）', async () => {
    const kasai = new SoftAuthenticator()
    await registerWith(svc, kasai)
    const hagi = new SoftAuthenticator()
    await registerWith(svc, hagi, { deviceSecret: OTHER_SECRET })
    const r = await verifyWith(svc, kasai, { deviceSecret: OTHER_SECRET })
    expect(r.status).toBe(401)
    expect(store.verified).toHaveLength(0)
  })

  it('別の鍵で作った署名は拒否', async () => {
    const auth = new SoftAuthenticator()
    await registerWith(svc, auth)
    const impostor = new SoftAuthenticator()
    const r = await verifyWith(svc, impostor, me, auth.credId)
    expect(r.status).toBe(401)
    expect(store.verified).toHaveLength(0)
  })
})

describe('補助', () => {
  it('UUID を16バイトにする', () => {
    expect(Array.from(uuidToBytes('5a000000-0000-0000-0000-000000000001')).slice(0, 2)).toEqual([0x5a, 0])
    expect(() => uuidToBytes('x')).toThrow()
  })
  it('設定は RP ID と許可オリジンが必須', () => {
    expect(readConfig({})).toBeNull()
    expect(readConfig({ WEBAUTHN_RP_ID: 'a.example', WEBAUTHN_ORIGINS: 'https://a.example, https://b.example' }))
      .toEqual({ rpId: 'a.example', rpName: 'MAMOR-AI', origins: ['https://a.example', 'https://b.example'] })
  })
  it('回数制限', () => {
    let t = 0
    const allow = createRateLimiter(2, 1000, () => t)
    expect([allow('ip'), allow('ip'), allow('ip')]).toEqual([true, true, false])
    t = 1001
    expect(allow('ip')).toBe(true)
  })
})
