// Service Worker for Code Arena Push Notifications

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();

    const options = {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      vibrate: [100, 50, 100],
      data: data.data || {},
      actions: [
        { action: 'open', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' }
      ],
      tag: data.data?.type || 'notification',
      renotify: true
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Code Arena', options)
    );
  } catch (err) {
    console.error('Push notification error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Open the activity feed or relevant page
  const data = event.notification.data || {};
  let url = '/activity';

  // Navigate to specific pages based on notification type
  if (data.type === 'friend_added' && data.friendId) {
    url = `/profile/${data.friendName || data.friendId}`;
  } else if (data.type === 'badge_earned') {
    url = '/profile';
  } else if (data.type === 'weekly_completed') {
    url = '/challenge';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ============================================================
// Learn mode offline support (additive, strictly scoped).
// Only /learn navigations and GET /api/lessons are handled here; everything
// else falls through to the network untouched (no respondWith), so auth,
// battles, problems, and push are unaffected.
// ============================================================
const LEARN_CACHE = 'learn-v1';

self.addEventListener('install', () => {
  // Activate the updated worker promptly so the scoped fetch logic takes effect.
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POST (tutor, auth, etc.)

  let url;
  try { url = new URL(req.url); } catch { return; }

  // (a) /learn page navigations: network-first, fall back to cached shell.
  if (req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith('/learn')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(LEARN_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/learn')))
    );
    return;
  }

  // (b) GET /api/lessons*: stale-while-revalidate (lesson data + translations).
  if (url.pathname.startsWith('/api/lessons')) {
    event.respondWith(
      caches.open(LEARN_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Everything else: passthrough (do NOT call respondWith).
});

// Handle service worker activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Drop stale learn caches on version bump (kill switch).
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('learn-') && k !== LEARN_CACHE).map((k) => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});
