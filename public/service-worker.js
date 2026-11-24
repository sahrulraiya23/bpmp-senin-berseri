/**
 * Service Worker untuk PWA Senin Berseri - BPMP Prov. Sulawesi Tenggara
 */

const CACHE_NAME = 'senin-berseri-pwa-v3';
const STATIC_ASSETS = [
  '/',
  '/pegawai',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
  '/css/azia.min.css',
  '/azia/css/azia.min.css',
  '/lib/fontawesome-free/css/all.min.css',
  '/azia/lib/fontawesome-free/css/all.min.css',
  '/lib/jquery/jquery.min.js',
  '/azia/lib/jquery/jquery.min.js',
  '/lib/bootstrap/js/bootstrap.bundle.min.js',
  '/azia/lib/bootstrap/js/bootstrap.bundle.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('SW pre-cache notice:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Hanya tangani GET requests dan lewati semua panggilan /api/, /admin, /superadmin agar data selalu live/realtime
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/superadmin')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Offline: Halaman tidak tersedia tanpa koneksi internet.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
