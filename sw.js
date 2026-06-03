/**
 * CryptValt Service Worker v6.0
 * Complete cache list — all pages, JS modules, and assets
 */

const CACHE_NAME  = 'cryptvalt-v6';
const OFFLINE_URL = '/CryptValt/offline.html';

const PRECACHE_ASSETS = [
  // ── Root ──────────────────────────────────────────────
  '/CryptValt/',
  '/CryptValt/index.html',
  '/CryptValt/manifest.json',
  '/CryptValt/offline.html',
  '/CryptValt/sw.js',

  // ── JS Modules ────────────────────────────────────────
  '/CryptValt/js/state.js',
  '/CryptValt/js/wallet.js',
  '/CryptValt/js/config.js',
  '/CryptValt/js/chain.js',
  '/CryptValt/js/crypto.js',
  '/CryptValt/js/ipfs.js',
  '/CryptValt/js/scoring.js',
  '/CryptValt/js/fileupload.js',
  '/CryptValt/js/auction.js',
  '/CryptValt/js/submit.js',
  '/CryptValt/js/ui.js',
  '/CryptValt/js/claude.js',
  '/CryptValt/js/investor.js',
  '/CryptValt/js/optout.js',
  '/CryptValt/js/security.js',
  '/CryptValt/js/ams.js',
  '/CryptValt/js/scout.js',
  '/CryptValt/js/app.js',
  '/CryptValt/js/pwa.js',

  // ── Sub Pages ─────────────────────────────────────────
  '/CryptValt/membership/index.html',
  '/CryptValt/founder/index.html',
  '/CryptValt/analytics/index.html',
  '/CryptValt/token/index.html',
  '/CryptValt/investor/index.html',
  '/CryptValt/promo/index.html',
  '/CryptValt/promo/outreach.html',
];

// Always fetch live — never cache
const ALWAYS_LIVE = [
  'api.anthropic.com',
  'api.pinata.cloud',
  'rpc.sepolia.org',
  'crypt-valt-backend-jkak.vercel.app',
  'ethereum-sepolia.publicnode.com',
  'gateway.pinata.cloud',
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always live for API calls
  if (ALWAYS_LIVE.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'Internet connection required.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // App shell — Cache First
  if (
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/CryptValt/')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match(OFFLINE_URL));
      })
    );
    return;
  }

  // Fonts + CDN — Cache First
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Everything else — Network First
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200 && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then(cached =>
        cached || caches.match(OFFLINE_URL)
      )
    )
  );
});

// ── Background Sync ────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-listings') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_LISTINGS' }))
      )
    );
  }
});

// ── Push Notifications ─────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'CryptValt', {
      body:  data.body  || '',
      icon:  '/CryptValt/icon-192.png',
      badge: '/CryptValt/icon-192.png',
      data:  data.url ? { url: data.url } : {},
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});

// ── Message Handler ────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS') {
    caches.open(CACHE_NAME).then(cache => cache.addAll(event.data.urls));
  }
});
