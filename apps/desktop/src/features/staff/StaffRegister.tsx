// [現場] 勤務員登録。ブルガリホテル東京 セキュリティ２グループの勤務員を登録・編集する。
// 登録した勤務員は、講習会申込の自動反映や有給申請書の氏名などに用いられる（本結線時はDB）。
import { useEffect, useState } from 'react'
import { SITE, COMPANY, type PilotStaff } from '../../pilot/bulgari.js'
import { listStaff, upsertStaff, setActive, resetPin, bulkUpsert, subscribe } from './staffApi.js'
import { parseStaffFile, staffTemplateRows } from '../../lib/staffParser.js'
import { downloadCsv } from '../../lib/csv.js'
import { StaffProfilePanel } from './StaffProfilePanel.js'

type Row = PilotStaff
const ROLES: Row['role'][] = ['現場責任者', '副責任者', '隊員']

export function StaffRegister(): JSX.Element {
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Row>({ no: '', name: '', dob: '', dept: SITE.dept, site: SITE.name, role: '隊員', active: true })
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [profileOf, setProfileOf] = useState<Row | null>(null)
  const load = (): void => { void listStaff().then(setRows) }
  useEffect(() => { load(); return subscribe(load) }, [])

  const reset = (): void => { setForm({ no: '', name: '', dob: '', dept: SITE.dept, site: SITE.name, role: '隊員', active: true }); setEditing(null) }

  const save = (): void => {
    if (form.no.trim() === '' || form.name.trim() === '') { setToast('スタッフNoと氏名は必須です'); return }
    void upsertStaff({ ...form, no: form.no.trim() })
      .then(() => { load(); setToast(`${form.name}（No.${form.no}）を${editing !== null ? '更新' : '登録'}しました`); reset() })
      .catch((e: unknown) => setToast(e instanceof Error ? e.message : '登録に失敗しました'))
  }
  const edit = (r: Row): void => { setForm({ ...r }); setEditing(r.no) }
  const toggle = (no: string): void => { const r = rows.find((x) => x.no === no); if (r) void setActive(no, !r.active).then(load) }

  // Excel/CSV 一括取込
  const [preview, setPreview] = useState<Row[] | null>(null)
  const [warn, setWarn] = useState<string[]>([])
  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setPreview(null); setWarn([])
    try {
      const { rows: parsed, warnings } = parseStaffFile(await file.arrayBuffer())
      setPreview(parsed); setWarn(warnings)
      setToast(`${parsed.length} 名を読み込みました。内容を確認して取込してください。`)
    } catch (e) { setToast(e instanceof Error ? e.message : '取込に失敗しました') }
  }
  const commitImport = (): void => {
    if (!preview) return
    const n = preview.length
    void bulkUpsert(preview)
      .then(() => { load(); setToast(`${n} 名を登録しました（初期PINは生年月日）`); setPreview(null); setWarn([]) })
      .catch((e: unknown) => setToast(e instanceof Error ? e.message : '取込に失敗しました'))
  }
  const downloadTemplate = (): void => { downloadCsv('隊員登録テンプレート.csv', staffTemplateRows()) }

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">勤務員登録</h1>
        <span className="muted">{COMPANY.name}／{SITE.name}／{SITE.dept}</span>
      </header>

      <section className="card" aria-label="勤務員の登録・編集">
        <div className="card-h"><h2>{editing !== null ? '勤務員を編集' : '新規登録'}</h2>{editing !== null && <button type="button" className="btn-sm" onClick={reset}>新規に切替</button>}</div>
        <div className="card-b">
          <div className="filters">
            <label className="fl">スタッフNo<input className="input" value={form.no} disabled={editing !== null} onChange={(e) => setForm({ ...form, no: e.target.value })} placeholder="例: 831" /></label>
            <label className="fl">氏名<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="姓 名" /></label>
            <label className="fl">生年月日<input className="input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></label>
            <label className="fl">役割
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Row['role'] })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="fl">所属<input className="input" value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} /></label>
          </div>
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={save}>{editing !== null ? '更新する' : '登録する'}</button></div>
        </div>
      </section>

      <section className="card" aria-label="Excel/CSV一括取込">
        <div className="card-h"><h2>Excel / CSV で一括登録</h2>
          <button type="button" className="btn-sm" style={{ marginLeft: 'auto' }} onClick={downloadTemplate}>テンプレートDL(CSV)</button>
        </div>
        <div className="card-b">
          <div className="filters">
            <label className="fl">ファイル(.xlsx/.xlsm/.csv)
              <input className="input" type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
          </div>
          <p className="muted">列: スタッフNo／氏名／生年月日／部署／役割／所属現場（スタッフNo・氏名は必須。表記ゆれ可）。初期PINは生年月日から自動生成されます。</p>
          {warn.length > 0 && <p className="muted" style={{ color: '#b8860b' }}>注意: {warn.slice(0, 4).join(' / ')}{warn.length > 4 ? ` ほか${warn.length - 4}件` : ''}</p>}
          {preview && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="card-h"><h2>プレビュー（{preview.length} 名）</h2>
                <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={commitImport}>この内容で取込</button>
              </div>
              <div className="card-b" style={{ padding: 0 }}>
                <table className="tbl">
                  <thead><tr><th>No.</th><th>氏名</th><th>生年月日</th><th>役割</th><th>部署</th><th>初期PIN</th></tr></thead>
                  <tbody>
                    {preview.slice(0, 20).map((r) => (
                      <tr key={r.no}><td>{r.no}</td><td>{r.name}</td><td>{r.dob || '—'}</td><td>{r.role}</td><td>{r.dept}</td><td>{r.dob ? `${r.dob.slice(5, 7)}${r.dob.slice(8, 10)}` : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 20 && <p className="muted" style={{ padding: '8px 12px' }}>ほか {preview.length - 20} 名</p>}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card" aria-label="勤務員一覧">
        <div className="card-h"><h2>勤務員一覧</h2><span className="muted">在籍 {rows.filter((r) => r.active).length} 名 / 全 {rows.length} 名 ／ PINは復旧用に表示</span></div>
        <div className="card-b">
          <table className="tbl">
            <thead><tr><th>No.</th><th>氏名</th><th>生年月日</th><th>役割</th><th>PIN</th><th>状態</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.no}</td><td>{r.name}</td><td>{r.dob || '—'}</td>
                  <td><span className={`status ${r.role === '現場責任者' ? 'st-approved' : r.role === '副責任者' ? 'st-submitted' : 'st-draft'}`}>{r.role}</span></td>
                  <td><b>{r.pin ?? '—'}</b>{r.pinMustChange ? <span className="status st-submitted" style={{ marginLeft: 6 }}>要変更</span> : null}</td>
                  <td>{r.active ? '在籍' : '休止'}</td>
                  <td>
                    <span className="row-actions" style={{ gap: 6 }}>
                      <button type="button" className="btn-sm" onClick={() => edit(r)}>編集</button>
                      <button type="button" className="btn-sm" onClick={() => setProfileOf(r)}>個人情報</button>
                      <button type="button" className="btn-sm" onClick={() => { void resetPin(r.no).then((p) => { load(); setToast(`${r.name} のPINを初期値(${p})にリセットしました`) }) }}>PIN初期化</button>
                      <button type="button" className="btn-sm btn-reject" onClick={() => toggle(r.no)}>{r.active ? '休止' : '復帰'}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 8 }}>※ 初期PINは生年月日の月日（MMDD）。勤務員は初回ログイン時に変更します。忘れた場合はここでPINを確認、または初期化できます。</p>
        </div>
      </section>
      {profileOf && <StaffProfilePanel realm="site" staffNo={profileOf.no} staffName={profileOf.name} isAdmin={false} onClose={() => setProfileOf(null)} />}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
