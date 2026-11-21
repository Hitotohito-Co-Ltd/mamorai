// [本社PC・管理者・支店] 勤務員の個人情報の一覧。見られるのは自社（支店は担当現場）の勤務員だけ。
import { useEffect, useMemo, useState } from 'react'
import { listCompanyStaff, type StaffListItem } from './staffProfileApi.js'
import { StaffProfilePanel } from './StaffProfilePanel.js'

export function StaffProfiles({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [rows, setRows] = useState<StaffListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<StaffListItem | null>(null)
  useEffect(() => { void listCompanyStaff().then(setRows).catch((e: unknown) => setErr(e instanceof Error ? e.message : '読み込めませんでした')) }, [])
  const shown = useMemo(() => (rows ?? []).filter((r) => q.trim() === '' || r.name.includes(q.trim()) || r.staff_no.includes(q.trim()) || r.sites.some((s) => s.includes(q.trim()))), [rows, q])

  return (
    <div>
      <div className="qdr-head"><h1 className="qdr-title">勤務員の個人情報</h1></div>
      <p className="muted" style={{ marginBottom: 12 }}>勤務員が自分のスマホで登録した情報です。開くと見たことが記録されます。一覧では中身は表示されません。</p>
      {err && <p className="sp-err" role="alert">{err}</p>}
      <section className="card" aria-label="勤務員の一覧">
        <div className="card-h"><h2>勤務員一覧</h2>
          <input className="input" style={{ maxWidth: 260 }} placeholder="氏名・No・現場で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} aria-label="絞り込み" />
        </div>
        <div className="card-b" style={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr><th>No.</th><th>氏名</th><th>現場</th><th>基本情報</th><th>顔写真</th><th>資格・教育・健診</th><th></th></tr></thead>
            <tbody>
              {rows === null && err === null && <tr><td colSpan={7} className="muted">読み込み中…</td></tr>}
              {shown.map((r) => (
                <tr key={r.staff_no} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td>{r.staff_no}</td><td>{r.name}</td><td>{r.sites.join('、') || '—'}</td>
                  <td>{r.has_profile ? '登録済み' : <span className="muted">未登録</span>}</td>
                  <td>{r.has_face ? '登録済み' : <span className="muted">未登録</span>}</td>
                  <td>
                    {r.credential_count}件
                    {r.expired_count > 0 && <span className="status st-reject" style={{ marginLeft: 6 }}>期限切れ {r.expired_count}</span>}
                    {r.soon_count > 0 && <span className="status st-warn" style={{ marginLeft: 6 }}>更新間近 {r.soon_count}</span>}
                  </td>
                  <td><button type="button" className="btn-sm" onClick={() => setOpen(r)}>開く</button></td>
                </tr>
              ))}
              {rows !== null && shown.length === 0 && <tr><td colSpan={7} className="muted">該当する勤務員がいません。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {open && <StaffProfilePanel realm="company" staffNo={open.staff_no} staffName={open.name} isAdmin={isAdmin} onClose={() => setOpen(null)} />}
    </div>
  )
}
