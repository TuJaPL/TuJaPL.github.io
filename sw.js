// Service worker: pozwala aplikacji działać bez internetu i szybko się uruchamiać.
// Strategia: pliki aplikacji podajemy od razu z pamięci (szybki start, także przy słabym zasięgu).
// Nowa wersja aplikacji = nowa nazwa CACHE – przeglądarka sama wykryje zmianę tego pliku,
// pobierze komplet nowych plików i podmieni je przy następnym uruchomieniu.
const CACHE = 'kalorie-v14';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './products.js', './health.js', './portions.js', './recipes-db.js', './manifest.webmanifest', './icon.svg',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
// Czytnik kodów (biblioteka + moduł WebAssembly) – wersje przypięte, więc można je trzymać w pamięci na stałe
const SCANNER_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/barcode-detector@',
  'https://fastly.jsdelivr.net/npm/zxing-wasm@',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetworkAndCache(req) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Czytnik kodów (z CDN) – po pierwszym pobraniu trzymany w pamięci
  if (SCANNER_PREFIXES.some((p) => req.url.startsWith(p))) {
    event.respondWith(caches.match(req).then((hit) => hit || fromNetworkAndCache(req)));
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // np. Open Food Facts – zawsze z sieci

  // Otwarcie aplikacji: strona główna z pamięci
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit || fromNetworkAndCache(req))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Pozostałe pliki aplikacji: najpierw pamięć, w razie braku – sieć
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fromNetworkAndCache(req))
  );
});
