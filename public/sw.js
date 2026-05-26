// ── inTurno Service Worker ────────────────────────────────────────
// Handles: push notifications, offline caching, App Badging

const STATIC_CACHE = 'inturno-static-v1'
const PAGES_CACHE  = 'inturno-pages-v1'

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

  // StaleWhileRevalidate for HTML pages
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.open(PAGES_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fresh = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone())
            return res
          }).catch(() => cached)
          return cached || fresh
        }),
      ),
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
