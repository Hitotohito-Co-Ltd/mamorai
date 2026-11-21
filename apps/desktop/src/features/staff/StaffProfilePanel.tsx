// [個人情報の閲覧] 勤務員1人分の基本情報・顔写真・資格／教育／健診の記録。
// 開いた時点で「基本情報」と「顔写真」を見たことが記録される。証書の写真は「見る」を押したときだけ読み込む（記録も1件ずつ）。
import { useEffect, useState } from 'react'
import { fetchStaffProfile, fetchStaffImage, fetchViewLog, type ProfileRealm, type ViewLogItem } from './staffProfileApi.js'
import type { Profile } from '../../pwa/profileApi.js'
import { expiryStatus, kindLabel } from '../../pwa/profileLogic.js'

const today = (): string => new Date().toLocaleDateString('sv-SE')
const WHAT: Record<ViewLogItem['what'], string> = { profile: '基本情報', face: '顔写真', credential: '証書の写真' }
const fmt = (iso: string): string => new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })

export function StaffProfilePanel({ realm, staffNo, staffName, isAdmin, onClose }: {
  realm: ProfileRealm; staffNo: string; staffName: string; isAdmin: boolean; onClose: () => void
}): JSX.Element {
  const [p, setP] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [face, setFace] = useState<string | null>(null)
  const [shown, setShown] = useState<Record<string, string | null>>({})
  const [log, setLog] = useState<ViewLogItem[] | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const prof = await fetchStaffProfile(realm, staffNo)
        if (!live) return
        setP(prof)
        if (prof.has_face) {
          const f = await fetchStaffImage(realm, staffNo, 'face', null)
          if (live && f) setFace(`data:${f.mime};base64,${f.base64}`)
        }
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : '読み込めませんでした') }
    })()
    return () => { live = false }
  }, [realm, staffNo])

  const showCred = (id: string): void => {
    void fetchStaffImage(realm, staffNo, 'credential', id)
      .then((d) => setShown((s) => ({ ...s, [id]: d ? `data:${d.mime};base64,${d.base64}` : null })))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '読み込めませんでした'))
  }
  const openLog = (): void => { void fetchViewLog(staffNo).then(setLog).catch((e: unknown) => setErr(e instanceof Error ? e.message : '読み込めませんでした')) }

  return (
    <div className="sp-back" role="dialog" aria-modal="true" aria-label={`${staffName}の個人情報`} onClick={onClose}>
      <div className="sp-box" onClick={(e) => e.stopPropagation()}>
        <div className="sp-head">
          <h2>{staffName}（No.{staffNo}）</h2>
          <button type="button" className="btn-sm" onClick={onClose}>閉じる</button>
        </div>
        <p className="muted sp-note">この画面を開くと、あなたが見たことが記録されます（誰が・何を・いつ）。印刷・転記は業務に必要な範囲にとどめてください。</p>
        {err && <p className="sp-err" role="alert">{err}</p>}
        {p === null && err === null && <p className="muted">読み込み中…</p>}
        {p && (<>
          <div className="sp-top">
            {face ? <img className="sp-face" src={face} alt="顔写真" /> : <div className="sp-face sp-face-empty">{p.has_face ? '読み込み中' : '顔写真 未登録'}</div>}
            <dl className="sp-dl">
              <dt>氏名</dt><dd>{p.name}</dd>
              <dt>ふりがな</dt><dd>{p.furigana ?? '—'}</dd>
              <dt>生年月日</dt><dd>{p.dob ?? '—'}</dd>
              <dt>電話番号</dt><dd>{p.phone ?? '—'}</dd>
              <dt>郵便番号</dt><dd>{p.postal_code ?? '—'}</dd>
              <dt>現住所</dt><dd>{p.address ?? '—'}</dd>
            </dl>
          </div>
          <h3 className="sp-h">資格・教育・健康診断</h3>
          {p.credentials.length === 0 ? <p className="muted">登録がありません。</p> : (
            <table className="tbl">
              <thead><tr><th>種類</th><th>名称・メモ</th><th>取得日</th><th>有効期限</th><th>証書</th></tr></thead>
              <tbody>
                {p.credentials.map((c) => {
                  const st = expiryStatus(c.expires_on, today())
                  return (
                    <tr key={c.id}>
                      <td>{kindLabel(c.kind)}</td><td>{c.label ?? '—'}</td><td>{c.obtained_on ?? '—'}</td>
                      <td>{c.expires_on ?? 'なし'}{st === '期限切れ' && <span className="status st-reject" style={{ marginLeft: 6 }}>期限切れ</span>}{st === '更新間近' && <span className="status st-warn" style={{ marginLeft: 6 }}>更新間近</span>}</td>
                      <td>
                        {!c.has_image && <span className="muted">未登録</span>}
                        {c.has_image && shown[c.id] === undefined && <button type="button" className="btn-sm" onClick={() => showCred(c.id)}>見る</button>}
                        {c.has_image && shown[c.id] && <img className="sp-cred" src={shown[c.id] ?? ''} alt={`${kindLabel(c.kind)}の証書`} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {isAdmin && (
            <div className="sp-log">
              {log === null
                ? <button type="button" className="btn-sm" onClick={openLog}>閲覧記録を見る（管理者）</button>
                : (<>
                  <h3 className="sp-h">閲覧記録（直近50件）</h3>
                  {log.length === 0 ? <p className="muted">まだありません。</p> : (
                    <table className="tbl"><thead><tr><th>日時</th><th>見た人</th><th>内容</th></tr></thead>
                      <tbody>{log.map((l, i) => <tr key={i}><td>{fmt(l.viewed_at)}</td><td>{l.viewer_kind === 'site' ? `現場PC ${l.viewer ?? ''}` : `本社 ${l.viewer ?? ''}`}</td><td>{WHAT[l.what]}</td></tr>)}</tbody>
                    </table>
                  )}
                </>)}
            </div>
          )}
        </>)}
      </div>
    </div>
  )
}
