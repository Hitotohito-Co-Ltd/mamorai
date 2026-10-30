import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkerApp } from './WorkerApp.js'
import { JyobanApp } from './jyoban/JyobanApp.js'
import './pwa.css'

const el = document.getElementById('root')
if (el === null) throw new Error('#root が見つかりません')
// 現場QR（/app/r/<トークン>）は上番報告画面。ホーム画面に追加したとき報告画面から開くよう専用マニフェストに差し替える。
const path = window.location.pathname
const isJyoban = /^\/app\/r(\/|$)/.test(path)
if (isJyoban) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/app/jyoban.webmanifest')
  document.title = 'MAMOR-AI 上番報告'
}
createRoot(el).render(
  <React.StrictMode>
    {isJyoban ? <JyobanApp pathname={path} /> : <WorkerApp />}
  </React.StrictMode>
)

// service worker 登録（インストール可能PWA）。本番(https)でのみ有効。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => { /* 無視 */ })
  })
}
