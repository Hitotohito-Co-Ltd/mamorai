// 下部タブ用の線アイコン（単色・線の太さ統一。色は親の color に従う）
import type { ReactElement } from 'react'

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Svg({ children }: { children: ReactElement | ReactElement[] }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" {...P}>{children}</svg>
}

export type TabIcon = 'jyoban' | 'hope' | 'leave' | 'training' | 'notice'

export function TabIconSvg({ name }: { name: TabIcon }) {
  switch (name) {
    case 'jyoban': // 現場の地点
      return <Svg><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.25" /></Svg>
    case 'hope': // カレンダー
      return <Svg><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></Svg>
    case 'leave': // 有給（日付に確認の印）
      return <Svg><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M9 14.5l2 2 4-4.5M8.5 3.5v4M15.5 3.5v4" /></Svg>
    case 'training': // 講習会（書類）
      return <Svg><path d="M7 3.5h7.5L19 8v12.5H7z" /><path d="M14.5 3.5V8H19M9.5 12.5h6M9.5 16h6" /></Svg>
    case 'notice': // お知らせ（ベル）
      return <Svg><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>
  }
}
