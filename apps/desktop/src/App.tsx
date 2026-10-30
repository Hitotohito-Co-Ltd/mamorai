import { useMemo, useState } from 'react'
import { Dashboard } from './features/dashboard/Dashboard.js'
import { QuickDailyReport } from './features/report/QuickDailyReport.js'
import { StructuredReport } from './features/report/StructuredReport.js'
import { MonthlyReport } from './features/month/MonthlyReport.js'
import { ReportList } from './features/report/ReportList.js'
import { ImportReports } from './features/report/ImportReports.js'
import { RiskRanking } from './features/risk/RiskRanking.js'
import { ShiftMonth } from './features/shift/ShiftMonth.js'
import { DailyAssignment } from './features/shift/DailyAssignment.js'
import { Placement } from './features/placement/Placement.js'
import { ConstraintEditor } from './features/shift/ConstraintEditor.js'
import { AiOptimizer } from './features/shift/AiOptimizer.js'
import { LaborAlerts } from './features/shift/LaborAlerts.js'
import { Notifications } from './features/notify/Notifications.js'
import { Education } from './features/training/Education.js'
import { EducationForms } from './features/training/EducationForms.js'
import { TemplateSettings } from './features/template/TemplateSettings.js'
import { OutputCenter } from './features/output/OutputCenter.js'
import { LeaveSiteApproval } from './features/leave/LeaveSiteApproval.js'
import { LeaveApproval } from './features/leave/LeaveApproval.js'
import { StaffRegister } from './features/staff/StaffRegister.js'
import { TrainingSiteApproval } from './features/training/TrainingSiteApproval.js'
import { TrainingManage } from './features/training/TrainingManage.js'
import { CompanyManagement } from './features/platform/CompanyManagement.js'
import { ContractStatus } from './features/platform/ContractStatus.js'
import { OpsDashboard } from './features/platform/OpsDashboard.js'
import { SecurityCheck } from './features/platform/SecurityCheck.js'
import { PlatformNotice } from './features/platform/PlatformNotice.js'
import { JyobanSettings } from './features/jyoban/JyobanSettings.js'
import { demoConstraints } from './features/shift/demoShift.js'
import { capabilitiesForRole, type Capability, type ConstraintDef } from '@mamorai/input-core'
import { setSiteCodes } from './shared/runtimeCtx.js'
import { isSupabaseConfigured } from './lib/supabaseClient.js'
import { APP_VERSION } from './version.js'
import type { Session } from './features/auth/authTypes.js'

// MAMOR-AI デスクトップ MVP のシェル。
// WebView2 前提の PC 専用アプリ（Tauri v2 で dist/ をラップして配布）。
// 各画面の集計・ワークフロー・リスク・シフト最適化は @mamorai/input-core に委譲（層分離厳守）。

type Tab =
  | 'opsdash' | 'companies' | 'contracts' | 'seccheck' | 'platnotice'
  | 'dashboard' | 'staffreg'
  | 'leaveapprove' | 'trmanage' | 'jyoban'
  | 'sreport' | 'report' | 'output' | 'month' | 'list' | 'import' | 'risk'
  | 'shift' | 'assign' | 'placement' | 'ai' | 'labor' | 'leave' | 'trapply'
  | 'constraint' | 'template' | 'education' | 'edudocs' | 'notify'

// 各タブは capability に紐づく。ログインロールが持つ capability のタブだけ表示する（コンソール別）。
const TABS: { key: Tab; label: string; cap: Capability }[] = [
  // 運営(TRYANGROW)
  { key: 'opsdash', label: 'ダッシュボード', cap: 'ops_dashboard' },
  { key: 'companies', label: '会社管理', cap: 'company_management' },
  { key: 'contracts', label: '契約状況', cap: 'contract_status' },
  { key: 'seccheck', label: 'セキュリティチェック', cap: 'security_check' },
  { key: 'platnotice', label: 'お知らせ', cap: 'platform_notice' },
  // 会社
  { key: 'leaveapprove', label: '有給確認', cap: 'leave_approval' },
  { key: 'trmanage', label: '講習会管理', cap: 'training_manage' },
  { key: 'jyoban', label: '上番報告設定', cap: 'jyoban_settings' },
  // 現場
  { key: 'dashboard', label: 'ダッシュボード', cap: 'dashboard' },
  { key: 'staffreg', label: '勤務員登録', cap: 'staff_register' },
  { key: 'sreport', label: '日報入力', cap: 'daily_report' },
  { key: 'report', label: '日報入力(簡易)', cap: 'daily_report' },
  { key: 'output', label: '出力センター', cap: 'output' },
  { key: 'month', label: '月報', cap: 'monthly' },
  { key: 'list', label: '日報一覧', cap: 'report_list' },
  { key: 'import', label: '日報取込', cap: 'report_import' },
  { key: 'risk', label: 'リスク', cap: 'risk' },
  { key: 'shift', label: 'シフト', cap: 'shift' },
  { key: 'assign', label: '配置(日次)', cap: 'assignment' },
  { key: 'placement', label: '配置予定・実績', cap: 'placement' },
  { key: 'ai', label: 'AIシフト', cap: 'ai_shift' },
  { key: 'labor', label: '労務', cap: 'labor' },
  { key: 'leave', label: '有給承認', cap: 'leave_site_approval' },
  { key: 'trapply', label: '講習会承認', cap: 'training_site_approval' },
  // 共通/会社設定
  { key: 'constraint', label: '労務ルール', cap: 'constraint' },
  { key: 'template', label: 'テンプレ設定', cap: 'template' },
  { key: 'edudocs', label: '教育指導簿', cap: 'edu_docs' },
  { key: 'education', label: '教育', cap: 'education' },
  { key: 'notify', label: '通知', cap: 'notify' },
]

export function App({ session, onLogout }: { session?: Session; onLogout?: () => void } = {}): JSX.Element {
  // ロール未指定（直接起動）は本社管理者相当で全機能表示（開発時の後方互換）。
  const role = session?.role ?? 'company_admin'
  // 現場ログインの実コードを各API(staff/leave)のRPCスコープに反映。
  useMemo(() => setSiteCodes(session?.companyCode, session?.siteCode), [session?.companyCode, session?.siteCode])
  const caps = useMemo(() => new Set(capabilitiesForRole(role)), [role])
  const tabs = useMemo(() => TABS.filter((t) => caps.has(t.cap)), [caps])

  const [tab, setTab] = useState<Tab>(() => tabs[0]?.key ?? 'sreport')
  // 複数現場を担当する社員/役員向け: ログイン後に担当現場を切替（担当外は表示しない）。
  const assignedSites = session?.assignedSites ?? (role === 'site_operator' ? ['ブルガリホテル東京', '立川立飛', 'ららテラス立川'] : [])
  const [currentSite, setCurrentSite] = useState<string>(() => assignedSites[0] ?? '')
  // 制約は「制約」タブと「AIシフト」タブで共有する（NL構造化→エディタ反映を体現）。
  const [constraints, setConstraints] = useState<ConstraintDef[]>(() => demoConstraints())

  const roleLabel: Record<string, string> = {
    site_operator: '施設（現場）', company_manager: '会社（権限者）',
    company_admin: '会社（本社管理者）', platform_admin: '運営（TRYANGROW）',
  }
  const allow = (t: Tab): boolean => tabs.some((x) => x.key === t)

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="サイドナビ">
        <img src="/logo-full.png" alt="MAMOR-AI" className="app-logo-img" />
        {session && (
          <div className="nav-session">
            <span className="nav-role">{roleLabel[role] ?? role}</span>
            {assignedSites.length > 1 && (
              <select className="nav-siteswitch" aria-label="担当現場を切替" value={currentSite} onChange={(e) => setCurrentSite(e.target.value)}>
                {assignedSites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {session.siteCode && <span className="nav-scope">現場 {session.siteCode}</span>}
            {session.email && <span className="nav-scope">{session.email}</span>}
            {onLogout && <button type="button" className="nav-logout" onClick={onLogout}>ログアウト</button>}
          </div>
        )}
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`nav-item${tab === t.key ? ' active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <span className="nav-note">MAMOR-AI / {APP_VERSION} / DB接続: <b>{isSupabaseConfigured() ? 'ON（本番DB）' : 'OFF（デモ）'}</b> / {tabs.length}機能</span>
      </nav>
      <main className="app-main" id="main">
        {tab === 'opsdash' && allow('opsdash') && <OpsDashboard />}
        {tab === 'companies' && allow('companies') && <CompanyManagement />}
        {tab === 'contracts' && allow('contracts') && <ContractStatus />}
        {tab === 'seccheck' && allow('seccheck') && <SecurityCheck />}
        {tab === 'platnotice' && allow('platnotice') && <PlatformNotice />}
        {tab === 'leaveapprove' && allow('leaveapprove') && <LeaveApproval />}
        {tab === 'trmanage' && allow('trmanage') && <TrainingManage />}
        {tab === 'jyoban' && allow('jyoban') && <JyobanSettings />}
        {tab === 'dashboard' && allow('dashboard') && <Dashboard onNavigate={setTab} />}
        {tab === 'staffreg' && allow('staffreg') && <StaffRegister />}
        {tab === 'sreport' && allow('sreport') && <StructuredReport />}
        {tab === 'report' && allow('report') && <QuickDailyReport />}
        {tab === 'output' && allow('output') && <OutputCenter />}
        {tab === 'month' && allow('month') && <MonthlyReport />}
        {tab === 'list' && allow('list') && <ReportList />}
        {tab === 'import' && allow('import') && <ImportReports />}
        {tab === 'risk' && allow('risk') && <RiskRanking />}
        {tab === 'shift' && allow('shift') && <ShiftMonth />}
        {tab === 'assign' && allow('assign') && <DailyAssignment />}
        {tab === 'placement' && allow('placement') && <Placement />}
        {tab === 'ai' && allow('ai') && <AiOptimizer constraints={constraints} onChange={setConstraints} />}
        {tab === 'labor' && allow('labor') && <LaborAlerts constraints={constraints} />}
        {tab === 'leave' && allow('leave') && <LeaveSiteApproval />}
        {tab === 'trapply' && allow('trapply') && <TrainingSiteApproval />}
        {tab === 'constraint' && allow('constraint') && <ConstraintEditor constraints={constraints} onChange={setConstraints} />}
        {tab === 'template' && allow('template') && <TemplateSettings />}
        {tab === 'edudocs' && allow('edudocs') && <EducationForms />}
        {tab === 'education' && allow('education') && <Education />}
        {tab === 'notify' && allow('notify') && <Notifications />}
      </main>
    </div>
  )
}
