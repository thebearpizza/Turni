// ── inTurno Service Worker ────────────────────────────────────────
// Handles: push notifications, offline caching, App Badging

const STATIC_CACHE = 'inturno-static-v2'
const PAGES_CACHE  = 'inturno-pages-v2'

// Assets to pre-cache on install (offline shell)
const PRECACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-branding.png',
]

// ── Install ───────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

// ── Activate: prune stale caches ─────────────────────────────────
self.addEventListener('activate', event => {
  const keep = new Set([STATIC_CACHE, PAGES_CACHE])
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// ── Fetch ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin GETs
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Skip API and Next.js data routes — always network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return

  // App Router client-side navigations & prefetches request RSC payloads
  // (accept: text/x-component / RSC header), NOT text/html. These carry
  // user-specific, time-sensitive data (the shift list, open timbratura),
  // so they must never be served cache-first — otherwise a newly added
  // split shift stays hidden until a hard reload. NetworkFirst, with the
  // cache used only as an offline fallback.
  const isRSC =
    request.headers.get('RSC') === '1' ||
    url.searchParams.has('_rsc') ||
    request.headers.get('accept')?.includes('text/x-component')
  if (isRSC) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(PAGES_CACHE).then(cache => cache.put(request, copy))
          }
          return res
        })
        .catch(() => caches.open(PAGES_CACHE).then(cache => cache.match(request))),
    )
    return
  }

  // CacheFirst for immutable hashed bundles
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(request).then(hit => hit || fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })),
      ),
    )
    return
  }

  // NetworkFirst for HTML pages — authenticated pages render time-sensitive,
  // user-specific state (open shift / timbratura status), so they must always
  // reflect fresh server data when online.  StaleWhileRevalidate served a
  // pre-check-in cached page for hours, making an open shift "disappear".
  // Cache is used only as an offline fallback.
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(PAGES_CACHE).then(cache => cache.put(request, copy))
          }
          return res
        })
        .catch(() => caches.open(PAGES_CACHE).then(cache => cache.match(request))),
    )
    return
  }

  // CacheFirst for other public assets
  event.respondWith(
    caches.open(STATIC_CACHE).then(cache =>
      cache.match(request).then(hit => hit || fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone())
        return res
      })),
    ),
  )
})

// ── Push notifications ────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    }),
  )
})
