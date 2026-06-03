/**
 * CryptValt Service Worker v1.0
 * Handles offline support, caching, and PWA install
 */

const CACHE_NAME = 'cryptvalt-v1';
const OFFLINE_URL = '/CryptValt/offline.html';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/CryptValt/',
  '/CryptValt/index.html',
  '/CryptValt/manifest.json',
  '/CryptValt/icon-192.png',
  '/CryptValt/icon-512.png',
  '/CryptValt/offline.html',
];

// External assets to cache on first fetch
const CACHE_EXTERNAL = [
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js',
];

// ============================================================
// INSTALL — Cache all critical assets
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — Clean old caches
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — Smart caching strategy per request type
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept these — always need live data
  const alwaysOnline = [
    'api.anthropic.com',
    'api.pinata.cloud',
    'rpc.sepolia.org',
    'ethereum-sepolia.publicnode.com',
  ];

  if (alwaysOnline.some(domain => url.hostname.includes(domain))) {
    // Online only — if offline return a JSON error
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'This feature requires an internet connection.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // App shell — Cache First, fall back to network
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
        }).catch(() => caches.match('/CryptValt/offline.html'));
      })
    );
    return;
  }

  // Google Fonts & CDN — Cache First
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

  // Everything else — Network First, fall back to cache
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200 && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then(cached =>
        cached || caches.match('/CryptValt/offline.html')
      )
    )
  );
});

// ============================================================
// BACKGROUND SYNC — Queue actions when offline
// ============================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-listings') {
    event.waitUntil(syncPendingListings());
  }
  if (event.tag === 'sync-bids') {
    event.waitUntil(syncPendingBids());
  }
});

async function syncPendingListings() {
  // When back online, sync any locally saved listings to chain
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_LISTINGS' });
  });
}

async function syncPendingBids() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_BIDS' });
  });
}

// ============================================================
// PUSH NOTIFICATIONS — Auction alerts
// ============================================================
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'CryptValt', {
      body:  data.body  || '',
      icon:  '/CryptValt/icon-192.png',
      badge: '/CryptValt/icon-192.png',
      data:  data.url ? { url: data.url } : {},
      actions: data.actions || [],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});

// ============================================================
// MESSAGE HANDLER — From main app
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CACHE_URLS') {
    caches.open(CACHE_NAME).then(cache => {
      cache.addAll(event.data.urls);
    });
  }
});
