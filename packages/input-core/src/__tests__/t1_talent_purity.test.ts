// [TLN] 純粋性: talent配下は UI/DB/外部I/O/非決定APIに依存しない
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../talent')
const files = readdirSync(dir).filter((n) => n.endsWith('.ts'))
const forbidden = [/from\s+['"]react['"]/, /from\s+['"]@supabase/, /\bwindow\b/, /\bdocument\b/, /\bfetch\s*\(/, /process\.env/, /Date\.now\s*\(/, /Math\.random\s*\(/, /new\s+Date\s*\(\s*\)/, /performance\.now/, /crypto\.randomUUID/, /\bIntl\./, /toLocale(String|DateString|TimeString)/, /(^|[^\w.])(?<!new\s)Date\s*\(\s*\)/]

describe('[TLN] 純粋性', () => {
  it('talentPurity_禁止APIを参照しない', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const code = readFileSync(resolve(dir, f), 'utf8')
      for (const re of forbidden) expect({ f, hit: re.test(code) }).toEqual({ f, hit: false })
    }
  })
})
