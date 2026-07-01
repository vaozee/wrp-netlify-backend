/**
 * ============================================================================
 *  WAR ROOM PLANTATION — SERVICE WORKER
 *  Fungsi: menyimpan "tampilan" aplikasi (HTML/CSS/JS/font/library) di cache
 *  browser supaya halaman tetap bisa dibuka walau TANPA internet sama sekali,
 *  setelah minimal 1x dibuka online.
 *
 *  PENTING: Ini hanya meng-cache APP SHELL (tampilan), BUKAN data produksi.
 *  Data (Produksi/PKS/Blok/dll) disimpan terpisah di SQLite (sql.js) melalui
 *  IndexedDB — lihat blok <script> "OFFLINE DB (SQLite/sql.js)" di index.html.
 *
 *  Setiap kali index.html/isi app diubah signifikan, naikkan CACHE_VERSION
 *  supaya pengguna lama otomatis mendapat versi baru.
 * ============================================================================
 */

const CACHE_VERSION = 'wrp-shell-v1';
const SHELL_CACHE = CACHE_VERSION;

// Aset dari domain sendiri (GitHub Pages) — WAJIB berhasil di-cache saat install
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// Aset dari CDN pihak ketiga — dicoba di-cache saat install, tapi kalau gagal
// (mis. jaringan lambat) TIDAK membatalkan instalasi SW, akan di-cache
// belakangan lewat strategi runtime caching di bawah.
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Poppins:wght@400;500;600&family=Roboto:wght@400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/apexcharts/3.45.1/apexcharts.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm'
];

// Host yang boleh di-runtime-cache (app shell only, BUKAN endpoint backend data)
const RUNTIME_CACHE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Core assets: harus berhasil (same-origin, tidak ada masalah CORS)
    await cache.addAll(CORE_ASSETS);
    // CDN assets: best-effort, jangan sampai gagal semua install gara-gara 1 CDN lambat/offline
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (e) {
        // Coba mode no-cors sebagai fallback (untuk resource yang tidak kirim header CORS)
        try {
          const res2 = await fetch(url, { mode: 'no-cors' });
          await cache.put(url, res2);
        } catch (e2) { /* biarkan, akan di-cache saat runtime nanti */ }
      }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isRuntimeCacheable(url) {
  try {
    const u = new URL(url);
    return RUNTIME_CACHE_HOSTS.includes(u.hostname);
  } catch (e) { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST (panggilan API backend) tidak disentuh SW

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Halaman utama (navigasi) & aset sendiri → cache-first, update di background
  if (req.mode === 'navigate' || sameOrigin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Font/CDN library app-shell → cache-first, update di background
  if (isRuntimeCacheable(req.url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Selain itu (mis. endpoint backend Apps Script/Netlify) → biarkan lewat
  // ke jaringan apa adanya, JANGAN di-cache oleh Service Worker.
  // Kalau offline, request ini akan gagal secara alami dan ditangani oleh
  // fallback cache SQLite di level aplikasi (bukan di level SW).
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: false });

  const networkFetch = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
    }
    return res;
  }).catch(() => null);

  if (cached) {
    // Punya cache: langsung kembalikan, sekalian refresh cache di belakang layar
    networkFetch;
    return cached;
  }

  // Tidak ada cache: tunggu jaringan; kalau gagal (offline & belum pernah cache), fallback ke index.html untuk navigasi
  const netRes = await networkFetch;
  if (netRes) return netRes;
  if (req.mode === 'navigate') {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
  }
  return new Response('Offline dan aset belum tersimpan di cache.', { status: 503, statusText: 'Offline' });
}
