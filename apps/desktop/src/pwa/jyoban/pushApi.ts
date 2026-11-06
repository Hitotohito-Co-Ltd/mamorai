// [JYB] 未報告のお知らせ（Web Push）の受け取り設定。個人スマホ（本人登録済み）だけが対象。
//   iPhone はホーム画面に追加したアプリからのみ通知を受け取れる（Safari のタブでは不可）。
import { getSupabase, isSupabaseConfigured } from '../../lib/supabaseClient.js'
import { loadDevice } from './reportApi.js'

export type PushState = 'unsupported' | 'needInstall' | 'notConfigured' | 'denied' | 'off' | 'on'

const vapidKey = (): string | undefined => {
  const v = (import.meta.env as Record<string, string | undefined>).VITE_VAPID_PUBLIC_KEY
  return v !== undefined && v !== '' ? v : undefined
}

/** base64url → Uint8Array（applicationServerKey 用） */
export function urlB64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}
function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needInstall' : 'unsupported'
  }
  if (vapidKey() === undefined || !isSupabaseConfigured()) return 'notConfigured'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration('/app/')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

/** 通知を許可して購読し、端末シークレットと紐づけて保存する。失敗時はメッセージを返す */
export async function enablePush(): Promise<string | null> {
  const key = vapidKey()
  const device = loadDevice()
  if (key === undefined || !isSupabaseConfigured()) return 'お知らせの設定がまだです（本社にお問い合わせください）'
  if (device === null) return '本人登録をしてから設定してください'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return '通知が許可されませんでした。スマホの設定からMAMOR-AIの通知を許可してください'
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) as BufferSource }))
  const j = sub.toJSON()
  const { error } = await getSupabase()!.rpc('jyoban_save_push_subscription', {
    p_device_secret: device.secret, p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '',
  })
  if (error) return `保存できませんでした: ${error.message}`
  return null
}
