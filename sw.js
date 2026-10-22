// BRIDGE 앱 — 아주 얇은 서비스 워커.
//
// 언제나 **서버에서 먼저** 받아 온다. 새로 올린 index.html 이 바로 보여야 하므로
// 화면을 미리 저장해 두고 그걸 먼저 보여주는 일은 하지 않는다.
// 인터넷이 끊겼을 때만, 마지막으로 받아 둔 화면을 대신 띄운다.
// 데이터(Firebase)와 다른 사이트로 가는 요청은 손대지 않는다.

const CACHE = 'bridge-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || req.mode !== 'navigate') return
  if (new URL(req.url).origin !== self.location.origin) return

  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('shell', copy))
        }
        return res
      })
      .catch(() => caches.open(CACHE).then((c) => c.match('shell')).then((hit) => hit || Response.error())),
  )
})
