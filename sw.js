// ============================================================
//  SONIQ — Service Worker v1.1.0
//  DAVIESLAY studio — Background audio support
// ============================================================

const CACHE_NAME    = 'soniq-v1.1.0';
const FONT_CACHE    = 'soniq-fonts-v1';
const DYNAMIC_CACHE = 'soniq-dynamic-v1';

const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './icon.svg',
  './sw.js',
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install error:', err))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== FONT_CACHE && k !== DYNAMIC_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API serveur → réseau uniquement
  if (url.hostname.includes('onrender.com') || url.hostname === 'api.audd.io') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ status:'error', error:{ error_message:'Hors ligne' } }),
          { headers:{ 'Content-Type':'application/json' } })
      )
    );
    return;
  }

  // YouTube → réseau uniquement (streaming)
  if (url.hostname.includes('youtube.com') || url.hostname.includes('ytimg.com') || url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Polices → Cache First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(resp => { cache.put(request, resp.clone()); return resp; });
        })
      )
    );
    return;
  }

  // Assets statiques → Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      });
    })
  );
});

// ── MESSAGE ───────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'KEEP_ALIVE')   event.ports[0]?.postMessage({ alive: true });
  if (event.data?.type === 'GET_VERSION')  event.ports[0]?.postMessage({ version:'1.1.0', cache:CACHE_NAME });
});

// ── PUSH ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'SONIQ', {
      body:  data.body || 'Nouvelle activité SONIQ',
      icon:  './icon.svg',
      badge: './icon.svg',
      tag:   'soniq-notification',
      data:  data.url || './',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || './'));
});

console.log('[SW] SONIQ v1.1.0 — Background audio ready · DAVIESLAY 💥');
