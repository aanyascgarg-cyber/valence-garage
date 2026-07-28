/* ============================================================
   VALENCE GARAGE. Service worker. sw.js

   Two jobs:
     1. Make the app genuinely installable. Chrome and Edge only offer a
        real install when a service worker with a fetch handler exists.
     2. Open offline. The shell is cached, so the app starts on a plane
        or in a basement car park, which is exactly where the Clinic gets
        used.

   The danger with a service worker is pinning people to a stale build,
   which would be worse than having none at all. Guarded three ways:

     Navigations are NETWORK FIRST, so a fresh deploy is picked up the
     moment there is a connection; the cache is only the fallback.

     version.json is NEVER cached, so the in-app update check always
     sees the truth.

     Static assets carry ?v= stamps, so a new build requests new URLs
     and old cache entries are dropped on activate.

   The car models are deliberately NOT cached: they run to roughly 200 MB
   and would blow the storage budget.
   ============================================================ */

var VERSION = 'v62';
var SHELL_CACHE = 'valence-shell-' + VERSION;
var RUNTIME_CACHE = 'valence-runtime-' + VERSION;

// Enough to boot and look like itself with no connection.
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/apple-touch-icon-v2.png',
  './assets/logo-v.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll rejects the whole batch if any single file 404s, which would
      // leave the app with no worker at all. Add them individually instead.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isModel(url) {
  return url.pathname.indexOf('/models/') !== -1 || /\.glb$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Same origin only. The AI proxy and fonts must go straight to the network.
  if (url.origin !== self.location.origin) return;

  // The update check must always see the real file.
  if (url.pathname.indexOf('version.json') !== -1) return;

  // Far too large to cache; let the browser handle them normally.
  if (isModel(url)) return;

  // Navigations: network first so a new deploy always wins, cache as the
  // offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL_CACHE).then(function (c) {
          c.put('./index.html', copy).catch(function () { });
        });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // Everything else: serve from cache when present (URLs are version stamped,
  // so a cache hit is always the right build), otherwise fetch and store.
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) {
            c.put(req, copy).catch(function () { });
          });
        }
        return res;
      }).catch(function () {
        return hit;
      });
    })
  );
});
