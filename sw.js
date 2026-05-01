// ============================================================
//  SONIQ — Service Worker
//  v1.0.0 · DAVIESLAY 💥
// ============================================================

const CACHE_NAME    = 'soniq-v1.0.0';
const FONT_CACHE    = 'soniq-fonts-v1';
const DYNAMIC_CACHE = 'soniq-dynamic-v1';

// Fichiers à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  './soniq.html',
  './manifest.json',
  './icon.svg',
  './sw.js',
];

// Polices Google Fonts à mettre en cache
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ============================================================
//  INSTALL — pré-cache des assets statiques
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installation SONIQ v1.0.0');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Mise en cache des assets statiques');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Erreur cache install:', err))
  );
});

// ============================================================
//  ACTIVATE — nettoyage des anciens caches
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activation SONIQ v1.0.0');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== FONT_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
//  FETCH — stratégie de cache intelligente
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. API AudD → réseau uniquement (pas de cache pour les requêtes audio)
  if (url.hostname === 'api.audd.io') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ status: 'error', error: { error_code: 0, error_message: 'Hors ligne — connexion requise pour identifier la musique.' } }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. Polices Google → Cache First avec fallback réseau
  if (FONT_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // 3. Assets statiques → Cache First
  if (STATIC_ASSETS.some(a => request.url.includes(a.replace('./', '')))) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Tout le reste → Network First avec fallback cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && request.method === 'GET') {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ============================================================
//  MESSAGE — communication avec l'app
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: '1.0.0', cache: CACHE_NAME });
  }
});

// ============================================================
//  PUSH NOTIFICATIONS (prêt pour l'avenir)
// ============================================================
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'SONIQ', {
      body: data.body || 'Nouvelle activité SONIQ',
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'soniq-notification',
      data: data.url || './',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || './')
  );
});

console.log('[SW] SONIQ Service Worker chargé — DAVIESLAY 💥');
