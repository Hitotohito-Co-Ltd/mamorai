// 運用モード（2026-11: まず上下番だけで運用する）。
//   環境変数 VITE_OPERATION_MODE=full のときだけ全機能。未設定なら上下番だけ（日報・シフト・有給・教育などは画面から外す）。
//   データと仕組みは残すので、Vercel の環境変数を full にして公開し直せば元に戻る。
import { parseOperationMode, type OperationMode } from '@mamorai/input-core'

export const OPERATION_MODE: OperationMode = parseOperationMode(import.meta.env.VITE_OPERATION_MODE)
export const JYOBAN_ONLY = OPERATION_MODE === 'jyoban_only'
