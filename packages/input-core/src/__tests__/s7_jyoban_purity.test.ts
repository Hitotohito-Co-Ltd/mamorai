// [JYB] 純粋性・認可: jyoban配下は UI/DB/外部I/O/非決定API に依存しない。設定は本社(会社)のみ。
// テスト規約: AAA / 「対象_条件_期待」
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { canAccess } from '../index.js'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../jyoban')
const files = readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))

const forbidden = [
  { label: 'react', re: /from\s+['"]react['"]/ },
  { label: '@supabase', re: /from\s+['"]@supabase[^'"]*['"]/ },
  { label: 'window', re: /\bwindow\b/ },
  { label: 'document', re: /\bdocument\b/ },
  { label: 'fetch', re: /\bfetch\s*\(/ },
  { label: 'process.env', re: /process\.env/ },
  { label: 'Date.now', re: /Date\.now\s*\(/ },
  { label: 'Math.random', re: /Math\.random\s*\(/ },
  { label: 'new Date()', re: /new\s+Date\s*\(\s*\)/ },
]

describe('[JYB] 純粋性', () => {
  it('jyobanPurity_ソースが1件以上ある', () => {
    expect(files.length).toBeGreaterThan(0)
  })
  it('jyobanPurity_UI/DB/外部I/O/非決定APIを参照しない', () => {
    for (const f of files) {
      const code = readFileSync(resolve(dir, f), 'utf8')
      for (const p of forbidden) expect({ file: f, hit: p.re.test(code), label: p.label }).toEqual({ file: f, hit: false, label: p.label })
    }
  })
})

describe('[JYB] 認可', () => {
  it('jyobanAuthz_本社(会社)は設定できる', () => {
    expect(canAccess('company_admin', 'jyoban_settings')).toBe(true)
    expect(canAccess('company_manager', 'jyoban_settings')).toBe(true)
  })
  it('jyobanAuthz_現場・運営は設定できない', () => {
    expect(canAccess('site_operator', 'jyoban_settings')).toBe(false)
    expect(canAccess('platform_admin', 'jyoban_settings')).toBe(false)
  })
})
