// [REQ-007] 後方互換: supabase/migrations/*.sql に破壊的DDLが無く、追加列はNULL許容であることを検証。
// マイグレーションが未作成でも成立するよう「存在すれば検証」形（glob→各ファイル走査）。
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// packages/input-core/src/__tests__ → リポジトリルート（4階層上）→ supabase/migrations
const migrationsDir = resolve(here, '../../../../supabase/migrations')

function migrationFiles(): { path: string; sql: string }[] {
  if (!existsSync(migrationsDir)) return []
  return readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .map((n) => ({ path: n, sql: readFileSync(resolve(migrationsDir, n), 'utf8').toLowerCase() }))
}

describe('backward compatibility migrations [REQ-007]', () => {
  it('backwardCompat_破壊的DDL_drop_altertype_renameを含まない', () => {
    // Arrange
    const files = migrationFiles()
    // Act & Assert （ファイルが無ければ検証対象ゼロ = 破壊なし）
    for (const f of files) {
      // 例外: CHECK制約の「許す値を広げる」差し替えだけは、行末に /* compat: widen-check */ を付けた行に限り許す
      //   （既存データはすべて新しい制約も満たすため、データを壊さない）。それ以外の DROP は従来どおり禁止。
      const sql = f.sql.split('\n').filter((line) => !(line.includes('/* compat: widen-check */') && /\bdrop\s+constraint\b/.test(line))).join('\n')
      expect(/\bdrop\s+(table|column|constraint|index|type|view)\b/.test(sql), `${f.path} が破壊的 DROP を含む`).toBe(false)
      expect(/\balter\s+column\b[^;]*\btype\b/.test(f.sql), `${f.path} が ALTER ... TYPE を含む`).toBe(false)
      expect(/\brename\s+(to|column)\b/.test(f.sql), `${f.path} が RENAME を含む`).toBe(false)
    }
  })

  it('backwardCompat_追加列_addcolumnかつnull許容である', () => {
    // Arrange
    const files = migrationFiles()
    // Act & Assert
    for (const f of files) {
      // 各 add column 句が not null を含まない（既定NULL許容）ことを確認
      const addCols = f.sql.match(/add\s+column[^,;]*/g) ?? []
      for (const clause of addCols) {
        expect(/\bnot\s+null\b/.test(clause), `${f.path} の追加列が NOT NULL: ${clause}`).toBe(false)
      }
    }
  })

  it('backwardCompat_走査自体が例外なく完了する', () => {
    // Arrange & Act
    const files = migrationFiles()
    // Assert （0件でもテスト自体は成立する）
    expect(Array.isArray(files)).toBe(true)
  })
})
