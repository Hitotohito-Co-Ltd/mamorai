import { describe, it, expect } from 'vitest'
import { capabilitiesForRole, canAccess, scopeForRole, isAuthRole, ROLE_LABEL, COMPANY_ACCOUNT_ROLES, capabilitiesFor, parseOperationMode } from '../index.js'

describe('[Auth] コンソール別 capability', () => {
  it('現場(site)は運用系＋有給申請/講習会参加が可能・運営系は不可', () => {
    const c = capabilitiesForRole('site_operator')
    for (const x of ['daily_report', 'monthly', 'shift', 'assignment', 'labor', 'notify', 'education', 'leave_site_approval', 'training_site_approval', 'output', 'staff_register'] as const) {
      expect(c).toContain(x)
    }
    expect(c).not.toContain('company_management')
    expect(c).not.toContain('contract_status')
    expect(c).not.toContain('platform_admin')
    expect(c).not.toContain('leave_approval') // 承認は会社側
  })

  it('会社(company)は管理/設定/確認系のみ・日報入力やシフト作成は持たない', () => {
    const c = capabilitiesForRole('company_admin')
    for (const x of ['constraint', 'template', 'notify', 'leave_approval', 'education', 'training_manage'] as const) {
      expect(c).toContain(x)
    }
    expect(c).not.toContain('daily_report')
    expect(c).not.toContain('shift')
    expect(c).not.toContain('platform_admin')
  })

  it('運営(platform)は会社管理・契約・アプリ管理のみ・現場運用は不可', () => {
    const c = capabilitiesForRole('platform_admin')
    for (const x of ['company_management', 'contract_status', 'platform_admin'] as const) {
      expect(c).toContain(x)
    }
    for (const x of ['daily_report', 'shift', 'assignment', 'labor', 'output'] as const) {
      expect(c).not.toContain(x)
    }
  })
})

describe('[Auth] canAccess', () => {
  it('現場はAIシフト可・有給承認は不可', () => {
    expect(canAccess('site_operator', 'ai_shift')).toBe(true)
    expect(canAccess('site_operator', 'leave_approval')).toBe(false)
  })
  it('会社は講習会管理可・日報入力は不可', () => {
    expect(canAccess('company_admin', 'training_manage')).toBe(true)
    expect(canAccess('company_admin', 'daily_report')).toBe(false)
  })
  it('運営は会社管理可・シフト不可', () => {
    expect(canAccess('platform_admin', 'company_management')).toBe(true)
    expect(canAccess('platform_admin', 'shift')).toBe(false)
  })
})

describe('[Auth] 2026-11 ロール（現場PC・本社PC・支店・管理者・教育センター）', () => {
  it('現場PC・本社PC・支店・管理者は上番報告の一覧を見られる。教育センター・運営は見ない', () => {
    for (const r of ['site_operator', 'hq_operator', 'company_manager', 'company_admin'] as const) expect(canAccess(r, 'jyoban_board')).toBe(true)
    for (const r of ['education_center', 'platform_admin'] as const) expect(canAccess(r, 'jyoban_board')).toBe(false)
  })
  it('上番報告の設定は支店・管理者だけ。本社PC・現場PCは変えられない', () => {
    expect(canAccess('company_admin', 'jyoban_settings')).toBe(true)
    expect(canAccess('company_manager', 'jyoban_settings')).toBe(true)
    expect(canAccess('hq_operator', 'jyoban_settings')).toBe(false)
    expect(canAccess('site_operator', 'jyoban_settings')).toBe(false)
  })
  it('アカウントと権限は管理者だけ', () => {
    const who = (['site_operator', 'hq_operator', 'company_manager', 'company_admin', 'education_center', 'platform_admin'] as const)
      .filter((r) => canAccess(r, 'role_management'))
    expect(who).toEqual(['company_admin'])
  })
  it('教育センターは講習会の管理と教育だけ。上番・有給承認・設定は持たない', () => {
    const c = capabilitiesForRole('education_center')
    expect(c).toEqual(expect.arrayContaining(['training_manage', 'education', 'edu_docs']))
    for (const x of ['jyoban_board', 'jyoban_settings', 'leave_approval', 'constraint', 'role_management', 'daily_report'] as const) expect(c).not.toContain(x)
  })
  it('本社PCは一覧とお知らせだけ', () => {
    expect(capabilitiesForRole('hq_operator')).toEqual(['jyoban_board', 'staff_profile', 'notify'])
  })
  it('管理者は支店・権限者の機能をすべて持つ', () => {
    expect(capabilitiesForRole('company_admin')).toEqual(expect.arrayContaining(capabilitiesForRole('company_manager')))
  })
  it('見られる範囲', () => {
    expect(scopeForRole('site_operator')).toBe('site')
    expect(scopeForRole('company_manager')).toBe('assigned')
    expect(scopeForRole('hq_operator')).toBe('company')
    expect(scopeForRole('education_center')).toBe('company')
    expect(scopeForRole('platform_admin')).toBe('platform')
  })
  it('ロール名と会社アカウントに割り当てられるロール', () => {
    expect(ROLE_LABEL.hq_operator).toBe('本社PC')
    expect(ROLE_LABEL.education_center).toBe('教育センター')
    expect(COMPANY_ACCOUNT_ROLES).not.toContain('site_operator')
    expect(COMPANY_ACCOUNT_ROLES).not.toContain('platform_admin')
    expect(isAuthRole('hq_operator')).toBe(true)
    expect(isAuthRole('admin')).toBe(false)
    expect(isAuthRole('toString')).toBe(false)
  })
})

describe('運用モード（上下番だけ）', () => {
  it('既定は上下番だけ。明示的に full のときだけ全機能', () => {
    expect(parseOperationMode(undefined)).toBe('jyoban_only')
    expect(parseOperationMode('')).toBe('jyoban_only')
    expect(parseOperationMode('FULL')).toBe('full')
    expect(parseOperationMode('jyoban_only')).toBe('jyoban_only')
  })
  it('上下番だけの運用では、日報・シフト・有給・教育などが外れる', () => {
    expect(capabilitiesFor('site_operator', 'jyoban_only').sort()).toEqual(['jyoban_board', 'staff_register'])
    expect(capabilitiesFor('hq_operator', 'jyoban_only').sort()).toEqual(['jyoban_board', 'staff_profile'])
    expect(capabilitiesFor('company_manager', 'jyoban_only').sort()).toEqual(['jyoban_board', 'jyoban_settings', 'staff_profile'])
    expect(capabilitiesFor('company_admin', 'jyoban_only').sort()).toEqual(['jyoban_board', 'jyoban_settings', 'role_management', 'staff_profile'])
    expect(capabilitiesFor('education_center', 'jyoban_only')).toEqual([])
    expect(capabilitiesFor('platform_admin', 'jyoban_only')).toEqual(capabilitiesForRole('platform_admin'))
  })
  it('full なら従来どおり', () => {
    expect(capabilitiesFor('site_operator', 'full')).toEqual(capabilitiesForRole('site_operator'))
  })
})
