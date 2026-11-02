// BRIDGE 앱 — 아주 얇은 서비스 워커.
//
// 언제나 **서버에서 먼저** 받아 온다. 새로 올린 index.html 이 바로 보여야 하므로
// 화면을 미리 저장해 두고 그걸 먼저 보여주는 일은 하지 않는다.
// 인터넷이 끊겼을 때만, 마지막으로 받아 둔 화면을 대신 띄운다.
// 데이터(Firebase)와 다른 사이트로 가는 요청은 손대지 않는다.

const CACHE = 'bridge-shell-v1'
const KEEP = [CACHE, 'bridge-push']

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
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

// ---------------------------------------------------------------- 앱 알림
//
// 알림 서버는 내용 없이 "새 알림 있음" 신호만 보낸다. 신호를 받으면 서버에
// 무슨 내용인지 물어서(/inbox) 화면에 띄운다. 서버 주소는 알림을 켤 때 사이트가
// 여기(Cache)에 적어 둔다.

const PUSH = 'bridge-push'

async function readJSON(key) {
  try {
    const hit = await (await caches.open(PUSH)).match(key)
    return hit ? await hit.json() : null
  } catch {
    return null
  }
}
async function writeJSON(key, value) {
  await (await caches.open(PUSH)).put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }))
}

async function onPush(data) {
  // 점검용 기록 — 폰 화면의 "알림 점검"에서 보인다 (알림이 폰까지 왔는지, 띄웠는지)
  const log = { at: Date.now(), hadData: !!(data && data.text && data.text().length), items: 0, shown: false, error: '' }
  try {
    await showItems(data, log)
  } catch (e) {
    log.error = String((e && e.message) || e)
    // 무슨 일이 있어도 한 장은 띄운다
    try {
      await self.registration.showNotification('BRIDGE', { body: '새 알림이 있어요. 눌러서 확인해 주세요.' })
      log.shown = true
    } catch (e2) {
      log.error += ` / ${String((e2 && e2.message) || e2)}`
    }
  }
  await writeJSON('last', log).catch(() => {})
}

async function showItems(data, log) {
  let items = []
  // 요즘 서버는 내용을 알림에 실어 보낸다 — 그대로 띄운다.
  try {
    const j = data ? data.json() : null
    if (j && Array.isArray(j.items) && j.items.length) items = j.items.slice().reverse()
  } catch {
    /* 내용 없음 — 아래에서 서버에 물어본다 */
  }
  if (!items.length) try {
    const cfg = await readJSON('cfg')
    const sub = await self.registration.pushManager.getSubscription()
    const seen = await readJSON('seen')
    const since = seen?.ts ?? Date.now() - 6 * 3600 * 1000
    const endpoint = sub?.endpoint || cfg?.endpoint
    if (cfg?.url && endpoint) {
      const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/inbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, since }),
      })
      items = (await res.json()).items || []
    }
  } catch {
    // 못 가져와도 알림은 꼭 띄운다 (아이폰은 신호를 받고 알림을 안 띄우면 알림을 끊어 버린다)
  }

  const icon = new URL('icons/icon-192.png', self.registration.scope).href
  log.items = items.length
  if (!items.length) {
    await self.registration.showNotification('BRIDGE', { body: '새 알림이 있어요. 눌러서 확인해 주세요.', icon, tag: 'bridge' })
    log.shown = true
    return
  }
  await writeJSON('seen', { ts: Math.max(...items.map((i) => i.ts)) })

  // 같은 종류는 한 장으로 묶는다 — 피드백 세 개면 "… (외 2개)"
  const byKind = new Map()
  for (const it of items) (byKind.get(it.kind) || byKind.set(it.kind, []).get(it.kind)).push(it)
  await Promise.all(
    [...byKind.values()].map((list) => {
      const top = list[0]
      const more = list.length > 1 ? ` (외 ${list.length - 1}개)` : ''
      return self.registration.showNotification(top.title, {
        body: `${top.body}${more}`,
        icon,
        tag: top.kind,
        data: { url: top.url },
      })
    }),
  )
  log.shown = true
}

self.addEventListener('push', (e) => e.waitUntil(onPush(e.data)))

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '', self.registration.scope).href
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = wins.find((w) => w.url.startsWith(self.registration.scope))
      if (mine) {
        await mine.navigate(url).catch(() => {})
        return mine.focus()
      }
      return self.clients.openWindow(url)
    })(),
  )
})
