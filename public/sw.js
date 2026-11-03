const CACHE = 'shoelogger-v13';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css?v=v13',
  '/js/app.js?v=v13',
  '/manifest.webmanifest?v=v13',
  '/icons/icon-192.png?v=v13',
  '/icons/icon-512.png?v=v13',
  '/icons/icon-192-maskable.png?v=v13',
  '/icons/icon-512-maskable.png?v=v13',
  '/icons/apple-touch-icon.png?v=v13',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Never touch API or uploads — prevents caching admin JSON in the SW.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  if (url.pathname === '/sw.js') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'ShoeLogger', body: 'New signup', url: '/?adminNotif=1', tag: 'shoelogger-new-user' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch (_) { /* ignore */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ShoeLogger', {
      body: data.body || 'New signup',
      icon: '/icons/icon-192.png?v=v13',
      badge: '/icons/icon-192.png?v=v13',
      tag: data.tag || 'shoelogger-new-user',
      data: { url: data.url || '/?adminNotif=1' },
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/?adminNotif=1';
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if (client.url.includes(self.registration.scope.replace(/\/$/, '')) || client.url.startsWith(self.origin)) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(target); } catch (_) { /* ignore */ }
          }
          client.postMessage({ type: 'open-admin-notifications' });
          return;
        }
      }
      await clients.openWindow(target);
    })()
  );
});
