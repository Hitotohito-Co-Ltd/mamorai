// [勤務員アプリ・設定] 個人情報のデータ層。Supabase 構成時は 0414 の RPC（端末シークレットで本人だけ）、未構成時はメモリ上のデモ。
import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import { workerRpc } from '../shared/secureRpc.js'
import { normalizePhone, normalizePostal, type CredentialKind } from './profileLogic.js'

export interface Credential { id: string; kind: CredentialKind; label: string | null; obtained_on: string | null; expires_on: string | null; has_image: boolean }
export interface Profile {
  staff_no: string; name: string; dob: string | null
  phone: string | null; furigana: string | null; postal_code: string | null; address: string | null
  has_face: boolean; credentials: Credential[]
}
export interface ProfileInput { furigana: string; postalCode: string; address: string; phone: string }
export interface CredentialInput { id: string | null; kind: CredentialKind; label: string; obtainedOn: string; expiresOn: string }
export interface ImageData { mime: string; base64: string }

// ── デモ（DB未構成）────────────────────────────────────
const demo: { profile: Profile; images: Map<string, ImageData> } = {
  profile: { staff_no: 'demo', name: 'デモ 太郎', dob: null, phone: null, furigana: null, postal_code: null, address: null, has_face: false, credentials: [] },
  images: new Map(),
}
const imgKey = (kind: string, id: string | null): string => `${kind}:${id ?? ''}`
const blank = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export async function loadProfile(): Promise<Profile> {
  if (!isSupabaseConfigured()) return structuredClone(demo.profile)
  return await workerRpc<Profile>('worker_profile_get')
}

export async function saveProfile(i: ProfileInput): Promise<void> {
  const phone = normalizePhone(i.phone); if (phone.error) throw new Error(phone.error)
  const postal = normalizePostal(i.postalCode); if (postal.error) throw new Error(postal.error)
  if (!isSupabaseConfigured()) {
    Object.assign(demo.profile, { furigana: blank(i.furigana), postal_code: postal.value, address: blank(i.address), phone: phone.value }); return
  }
  await workerRpc('worker_profile_save', { p_furigana: blank(i.furigana), p_postal_code: postal.value, p_address: blank(i.address), p_phone: phone.value })
}

export async function saveCredential(i: CredentialInput): Promise<string> {
  if (i.expiresOn && i.obtainedOn && i.expiresOn < i.obtainedOn) throw new Error('有効期限が取得日より前です')
  if (!isSupabaseConfigured()) {
    const id = i.id ?? `demo-${Date.now()}`
    const row: Credential = { id, kind: i.kind, label: blank(i.label), obtained_on: blank(i.obtainedOn), expires_on: blank(i.expiresOn), has_image: demo.images.has(imgKey('credential', id)) }
    const at = demo.profile.credentials.findIndex((c) => c.id === id)
    if (at >= 0) demo.profile.credentials[at] = row; else demo.profile.credentials.push(row)
    return id
  }
  return await workerRpc<string>('worker_credential_save', { p_id: i.id, p_kind: i.kind, p_label: blank(i.label), p_obtained_on: blank(i.obtainedOn), p_expires_on: blank(i.expiresOn) })
}

export async function deleteCredential(id: string): Promise<void> {
  if (!isSupabaseConfigured()) { demo.profile.credentials = demo.profile.credentials.filter((c) => c.id !== id); demo.images.delete(imgKey('credential', id)); return }
  await workerRpc('worker_credential_delete', { p_id: id })
}

export async function saveImage(kind: 'face' | 'credential', credentialId: string | null, img: ImageData): Promise<void> {
  if (!isSupabaseConfigured()) {
    demo.images.set(imgKey(kind, credentialId), img)
    if (kind === 'face') demo.profile.has_face = true
    else { const c = demo.profile.credentials.find((x) => x.id === credentialId); if (c) c.has_image = true }
    return
  }
  await workerRpc('worker_image_save', { p_kind: kind, p_credential_id: credentialId, p_mime: img.mime, p_base64: img.base64 })
}

export async function loadImage(kind: 'face' | 'credential', credentialId: string | null): Promise<ImageData | null> {
  if (!isSupabaseConfigured()) return demo.images.get(imgKey(kind, credentialId)) ?? null
  return await workerRpc<ImageData | null>('worker_image_get', { p_kind: kind, p_credential_id: credentialId })
}

export async function deleteImage(kind: 'face' | 'credential', credentialId: string | null): Promise<void> {
  if (!isSupabaseConfigured()) {
    demo.images.delete(imgKey(kind, credentialId))
    if (kind === 'face') demo.profile.has_face = false
    else { const c = demo.profile.credentials.find((x) => x.id === credentialId); if (c) c.has_image = false }
    return
  }
  await workerRpc('worker_image_delete', { p_kind: kind, p_credential_id: credentialId })
}

/** 撮影・選択した写真を、長辺 max px の JPEG に縮小して base64 にする（端末内で処理。元画像は送らない）。 */
export async function fileToJpeg(file: File, max = 1024): Promise<ImageData> {
  const { fitSize } = await import('./profileLogic.js')
  const bmp = await createImageBitmap(file)
  const { w, h } = fitSize(bmp.width, bmp.height, max)
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('画像を処理できませんでした')
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
  const url = canvas.toDataURL('image/jpeg', 0.82)
  return { mime: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1) }
}
