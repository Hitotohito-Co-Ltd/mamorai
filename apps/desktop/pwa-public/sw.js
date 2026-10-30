/* MAMOR-AI 勤務員PWA サービスワーカー（app-shellキャッシュ）。
   ネットワーク優先＋オフライン時キャッシュフォールバック。バージョンでキャッシュ更新。 */
const CACHE = 'mamorai-worker-v2'
const SHELL = ['/app/', '/app/index.html', '/app/manifest.webmanifest', '/app/jyoban.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  // ナビゲーションは network-first（更新を優先）→ 失敗時 index.html
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/app/index.html')))
    return
  }
  // 静的資産は cache-first
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone()
      if (res.ok && req.url.startsWith(self.location.origin)) {
        caches.open(CACHE).then((c) => c.put(req, copy))
      }
      return res
    }).catch(() => caches.match('/app/index.html')))
  )
})
