// [勤務員アプリ・設定] 個人情報（基本情報・顔写真・資格／教育／健診の記録）とログアウト。
// 見られる人: 本人・本社PC／管理者・自現場の現場PC（本人以外が見ると記録が残る）。マイナンバーは扱わない。
import { useEffect, useRef, useState } from 'react'
import type { Staff } from '../staff.js'
import {
  loadProfile, saveProfile, saveCredential, deleteCredential, saveImage, loadImage, deleteImage, fileToJpeg,
  type Profile, type Credential,
} from '../profileApi.js'
import { CREDENTIAL_KINDS, expiryStatus, kindLabel, type CredentialKind } from '../profileLogic.js'

const today = (): string => new Date().toLocaleDateString('sv-SE')
const msg = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback)

function ImageThumb({ kind, id, version, alt }: { kind: 'face' | 'credential'; id: string | null; version: number; alt: string }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void loadImage(kind, id).then((d) => { if (live) setSrc(d ? `data:${d.mime};base64,${d.base64}` : null) }).catch(() => { if (live) setSrc(null) })
    return () => { live = false }
  }, [kind, id, version])
  return src ? <img className="set-thumb" src={src} alt={alt} /> : <div className="set-thumb set-thumb-empty" aria-hidden="true">未登録</div>
}

function PhotoButtons({ has, onPick, onRemove, label }: { has: boolean; onPick: (f: File) => void; onRemove: () => void; label: string }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="set-photo-actions">
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
      <button type="button" className="pwa-btn pwa-btn-sm" onClick={() => ref.current?.click()}>{has ? `${label}を撮り直す` : `${label}を撮る・選ぶ`}</button>
      {has && <button type="button" className="pwa-btn pwa-btn-sm pwa-btn-line" onClick={onRemove}>削除</button>}
    </div>
  )
}

export function Settings({ staff, onBack, onLogout }: { staff: Staff; onBack: () => void; onLogout: () => void }): JSX.Element {
  const [p, setP] = useState<Profile | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [form, setForm] = useState({ furigana: '', postalCode: '', address: '', phone: '' })
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [imgVer, setImgVer] = useState(0)
  const [editing, setEditing] = useState<{ id: string | null; kind: CredentialKind; label: string; obtainedOn: string; expiresOn: string } | null>(null)

  const reload = (): Promise<void> => loadProfile().then((r) => {
    setP(r); setLoadErr(null)
    setForm({ furigana: r.furigana ?? '', postalCode: r.postal_code ?? '', address: r.address ?? '', phone: r.phone ?? '' })
  }).catch((e: unknown) => setLoadErr(msg(e, '読み込めませんでした')))
  useEffect(() => { void reload() }, [])

  const run = async (okText: string, fn: () => Promise<void>): Promise<void> => {
    setNotice(null)
    try { await fn(); setNotice({ ok: true, text: okText }) } catch (e) { setNotice({ ok: false, text: msg(e, '保存できませんでした') }) }
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }): void => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="pwa-page set-page">
      <button type="button" className="set-back" onClick={onBack}>← 戻る</button>
      <h1 className="pwa-title">設定</h1>
      <p className="pwa-lead">{staff.name}（No.{staff.no}）</p>

      <p className="set-privacy">登録した情報は、警備員名簿・教育記録など、業務に必要な管理のために使います。見られるのは、あなた・本社・管理者・配置されている現場の担当者だけで、本人以外が見ると記録が残ります。マイナンバーは登録しません。</p>

      {loadErr && <p className="pwa-err" role="alert">{loadErr}</p>}
      {notice && <p className={notice.ok ? 'set-ok' : 'pwa-err'} role="status">{notice.text}</p>}

      {p && (<>
        <section className="pwa-card">
          <h2 className="set-h">基本情報</h2>
          <dl className="set-fixed">
            <dt>氏名</dt><dd>{staff.name}</dd>
            <dt>生年月日</dt><dd>{p.dob ?? '未登録（本社に確認してください）'}</dd>
          </dl>
          <label className="pwa-field">ふりがな<input className="pwa-input" value={form.furigana} onChange={set('furigana')} /></label>
          <label className="pwa-field">電話番号<input className="pwa-input" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="09012345678" /></label>
          <label className="pwa-field">郵便番号<input className="pwa-input" inputMode="numeric" value={form.postalCode} onChange={set('postalCode')} placeholder="100-0001" /></label>
          <label className="pwa-field">現住所<input className="pwa-input" value={form.address} onChange={set('address')} /></label>
          <button type="button" className="pwa-btn pwa-btn-primary pwa-btn-block" onClick={() => void run('基本情報を保存しました', () => saveProfile(form).then(reload))}>保存する</button>
        </section>

        <section className="pwa-card">
          <h2 className="set-h">顔写真</h2>
          <div className="set-face">
            <ImageThumb kind="face" id={null} version={imgVer} alt="顔写真" />
            <PhotoButtons has={p.has_face} label="顔写真"
              onPick={(f) => void run('顔写真を保存しました', async () => { await saveImage('face', null, await fileToJpeg(f)); await reload(); setImgVer((v) => v + 1) })}
              onRemove={() => { if (globalThis.confirm('顔写真を削除しますか？')) void run('削除しました', async () => { await deleteImage('face', null); await reload(); setImgVer((v) => v + 1) }) }} />
          </div>
          <p className="pwa-note" style={{ textAlign: 'left' }}>正面・無帽・背景は無地がめやすです。</p>
        </section>

        <section className="pwa-card">
          <h2 className="set-h">資格・教育・健康診断</h2>
          {p.credentials.length === 0 && <p className="pwa-note" style={{ textAlign: 'left' }}>まだ登録がありません。</p>}
          <ul className="set-cred-list">
            {p.credentials.map((c: Credential) => {
              const st = expiryStatus(c.expires_on, today())
              return (
                <li key={c.id} className="set-cred">
                  <div className="set-cred-main">
                    <strong>{kindLabel(c.kind)}</strong>{c.label ? `　${c.label}` : ''}
                    <div className="set-cred-sub">
                      {c.obtained_on ? `取得 ${c.obtained_on}` : '取得日 未入力'}　{c.expires_on ? `期限 ${c.expires_on}` : '期限なし'}
                      {st === '期限切れ' && <span className="chip h-off">期限切れ</span>}
                      {st === '更新間近' && <span className="chip h-night">更新間近</span>}
                    </div>
                  </div>
                  <ImageThumb kind="credential" id={c.has_image ? c.id : null} version={imgVer} alt={`${kindLabel(c.kind)}の証書`} />
                  <div className="set-cred-actions">
                    <button type="button" className="pwa-btn pwa-btn-sm" onClick={() => setEditing({ id: c.id, kind: c.kind, label: c.label ?? '', obtainedOn: c.obtained_on ?? '', expiresOn: c.expires_on ?? '' })}>編集</button>
                    <PhotoButtons has={c.has_image} label="証書"
                      onPick={(f) => void run('証書の写真を保存しました', async () => { await saveImage('credential', c.id, await fileToJpeg(f, 1400)); await reload(); setImgVer((v) => v + 1) })}
                      onRemove={() => void run('削除しました', async () => { await deleteImage('credential', c.id); await reload(); setImgVer((v) => v + 1) })} />
                    <button type="button" className="pwa-btn pwa-btn-sm pwa-btn-line" onClick={() => { if (globalThis.confirm('この記録を削除しますか？')) void run('削除しました', () => deleteCredential(c.id).then(reload)) }}>記録を削除</button>
                  </div>
                </li>
              )
            })}
          </ul>
          {editing === null
            ? <button type="button" className="pwa-btn pwa-btn-block" onClick={() => setEditing({ id: null, kind: 'shinnin', label: '', obtainedOn: '', expiresOn: '' })}>＋ 記録を追加</button>
            : (
              <div className="set-edit">
                <label className="pwa-field">種類
                  <select className="pwa-input" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as CredentialKind })}>
                    {CREDENTIAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </label>
                <label className="pwa-field">名称・メモ（例: 2号 交通誘導）<input className="pwa-input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></label>
                <label className="pwa-field">取得日・受診日<input className="pwa-input" type="date" value={editing.obtainedOn} onChange={(e) => setEditing({ ...editing, obtainedOn: e.target.value })} /></label>
                <label className="pwa-field">有効期限（ないものは空欄）<input className="pwa-input" type="date" value={editing.expiresOn} onChange={(e) => setEditing({ ...editing, expiresOn: e.target.value })} /></label>
                <div className="set-edit-actions">
                  <button type="button" className="pwa-btn pwa-btn-primary" onClick={() => void run('記録を保存しました', async () => { await saveCredential(editing); setEditing(null); await reload() })}>保存する</button>
                  <button type="button" className="pwa-btn" onClick={() => setEditing(null)}>やめる</button>
                </div>
              </div>
            )}
        </section>
      </>)}

      <section className="pwa-card">
        <h2 className="set-h">アカウント</h2>
        <button type="button" className="pwa-btn pwa-btn-block" onClick={onLogout}>ログアウト</button>
      </section>
    </div>
  )
}
