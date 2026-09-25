// Оболочка приложения кэшируется, чтобы открывалось мгновенно и без сети.
// Данные и фото из Supabase не кэшируются никогда: ссылки подписаны на час, а строки меняются.
const CACHE = 'wardrobe-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'lib.js',
  'pick.js',
  'wardrobe.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  const isShell = url.origin === location.origin;
  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  if (!isShell && !isCdn) return; // Supabase — всегда напрямую

  // Свежее важнее быстрого: сеть, а кэш — запасной аэродром.
  e.respondWith(
    fetch(request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
  );
});
