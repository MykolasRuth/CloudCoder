// CloudCoder service worker — network-first for the HTML shell, cache-first
// for hashed assets, NEVER intercepts live data (/_cc/api, /_cc/ws) or
// preview-proxied paths (everything outside the app namespaces).
const CACHE = 'cloudcoder-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// app shell paths only; anything else may belong to a previewed dev server
function isShellPath(pathname) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico' ||
    pathname === '/_cc/manifest.webmanifest' ||
    pathname.startsWith('/_cc/assets/') ||
    pathname.startsWith('/_cc/icons/') ||
    pathname.startsWith('/icons/')
  );
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (!isShellPath(url.pathname)) return; // /_cc/api, /_cc/ws, /p, /_preview, proxied dev-server paths

  // network-first for navigations so updates land immediately
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put('/', cp));
          return r;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // cache-first for hashed static assets
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((r) => {
          if (r.ok) {
            const cp = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, cp));
          }
          return r;
        }),
    ),
  );
});

// iOS requires every push to show a notification
self.addEventListener('push', (e) => {
  let payload = { title: 'CloudCoder', body: '', data: {} };
  try {
    payload = { ...payload, ...e.data.json() };
  } catch {}
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const sessionId = e.notification.data && e.notification.data.sessionId;
  const target = '/' + (sessionId ? '#session=' + sessionId : '');
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
