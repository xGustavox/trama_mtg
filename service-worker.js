const CACHE_NAME = 'trama-mtg-v5';
const APP_FILES = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './version.json',
  './assets/trama-logo.png',
  './assets/app-icon-180.png',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './assets/confetti.json',
  './assets/lottie.min.js',
  './assets/ficha_burrice.png',
  './assets/medalha.png',
  './assets/poison.svg',
  './assets/rad.svg',
  './assets/soms/morte.mp3',
  './assets/soms/dano_comandante.mp3',
  './assets/soms/botao_aleatorio/1.mp3',
  './assets/soms/botao_aleatorio/3.mp3',
  './assets/soms/botao_aleatorio/4.mp3',
  './assets/soms/botao_aleatorio/5.mp3',
  './assets/soms/botao_aleatorio/6.mp3',
  './assets/soms/botao_aleatorio/7.mp3',
  './assets/soms/botao_aleatorio/8.mp3',
  './assets/soms/botao_aleatorio/9.mp3',
  './assets/soms/burro/1.mp3',
  './assets/soms/burro/2.mp3',
  './assets/soms/burro/3.mp3',
  './assets/soms/burro/4.mp3',
  './assets/soms/burro/5.mp3',
  './assets/soms/burro/6.mp3',
  './assets/soms/burro/7.mp3',
  './assets/soms/burro/8.mp3',
  './assets/soms/burro/9.mp3',
  './assets/soms/vitoria/1.mp3',
  './assets/soms/vitoria/2.mp3',
  './assets/soms/vitoria/3.mp3',
  './assets/soms/vitoria/4.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        throw new Error(`Recurso indisponível offline: ${request.url}`);
      }),
  );
});
