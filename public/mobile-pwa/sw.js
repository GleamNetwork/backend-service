const CACHE_NAME = 'tongpin-pwa-v34';
const APP_SHELL = [
  './',
  './index.html',
  './api.js',
  './app.js',
  './manifest.webmanifest',
  './assets/home-morning-room.png',
  './assets/xiaopin-calm.png',
  './assets/xiaopin-wave.png',
  './assets/xiaopin-curious-v1.png',
  './assets/xiaopin-idle-v1.png',
  './assets/xiaopin-heart-v1.png',
  './assets/xiaopin-cheer-v1.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
