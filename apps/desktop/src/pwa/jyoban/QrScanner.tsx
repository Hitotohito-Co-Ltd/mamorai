// [勤務員PWA・上番報告] 現場QRの読み取り。カメラで連続読み取り（iPhone/Android のブラウザ両対応のため jsQR で解析）。
//   カメラが使えない・許可されない場合は、QRを撮った写真から読み取る。
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { tokenFromScan } from './reportApi.js'

const MAX_SIDE = 1280

function decode(source: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return null
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

export function QrScanner({ onToken, onCancel }: { onToken: (token: string) => void; onCancel: () => void }): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const done = useRef(false)

  const found = (text: string | null): boolean => {
    if (text === null) return false
    const token = tokenFromScan(text)
    if (token === null) { setHint('上番報告用のQRではありません。現場に掲示されたMAMOR-AIのQRを読み取ってください'); return false }
    done.current = true
    onToken(token)
    return true
  }

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const md = globalThis.navigator?.mediaDevices
    if (md?.getUserMedia === undefined) { setCamError('このブラウザではカメラを使えません。下の「写真から読み取る」をお使いください'); return }
    md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        stream = s
        const v = video.current
        if (v === null) return
        v.srcObject = s
        v.setAttribute('playsinline', 'true')
        void v.play()
        const tick = (): void => {
          if (done.current) return
          if (v.readyState >= 2 && canvas.current !== null && found(decode(v, v.videoWidth, v.videoHeight, canvas.current))) return
          timer = setTimeout(tick, 250)
        }
        tick()
      })
      .catch((e: Error) => {
        setCamError(e.name === 'NotAllowedError'
          ? 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可するか、下の「写真から読み取る」をお使いください'
          : 'カメラを起動できませんでした。下の「写真から読み取る」をお使いください')
      })
    return () => {
      done.current = true
      if (timer !== null) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fromPhoto = (file: File | undefined): void => {
    if (file === undefined || canvas.current === null) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const text = decode(img, img.naturalWidth, img.naturalHeight, canvas.current!)
      URL.revokeObjectURL(url)
      if (text === null) setHint('写真からQRを読み取れませんでした。QR全体が写るように撮り直してください')
      else found(text)
    }
    img.onerror = () => { URL.revokeObjectURL(url); setHint('写真を読み込めませんでした') }
    img.src = url
  }

  return (
    <div className="jy-scan">
      <h2 className="jy-h2">現場のQRを読み取る</h2>
      <p className="jy-lead">現場に掲示された「MAMOR-AI 上番報告」のQRを、枠の中に写してください。</p>
      {camError === null ? (
        <div className="jy-scan-view">
          <video ref={video} className="jy-scan-video" muted playsInline aria-label="カメラの映像" />
          <span className="jy-scan-frame" aria-hidden="true" />
        </div>
      ) : <p className="jy-warn" role="alert">{camError}</p>}
      {hint && <p className="jy-err" role="status">{hint}</p>}
      <label className="jy-btn jy-btn-outline jy-file">
        写真から読み取る
        <input type="file" accept="image/*" capture="environment" onChange={(e) => fromPhoto(e.target.files?.[0])} />
      </label>
      <button type="button" className="jy-btn jy-btn-outline" onClick={onCancel}>やめる</button>
      <canvas ref={canvas} hidden />
    </div>
  )
}
