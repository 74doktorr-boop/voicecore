// public/sw.js — NodeFlow Portal Service Worker
'use strict';

const CACHE = 'nf-portal-v8';
const PRECACHE = [
  '/portal/',
  '/portal/index.html',
  '/portal/portal.js',
  '/favicon.svg',
];

// ── Install: pre-cache shell ──────────────────────────────────
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(PRECACHE);
    })
  );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: network-first for API; cache-first for assets ──────
self.addEventListener('fetch', function(e) {
  // Never intercept non-GET or API calls — always go to the network.
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) {
        // Serve from cache, refresh in background (stale-while-revalidate).
        fetch(e.request).then(function(res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function(c) { c.put(e.request, res); });
          }
        }).catch(function() {});
        return cached;
      }
      return fetch(e.request).then(function(res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  var title = data.title || 'NodeFlow';
  var opts  = {
    body:  data.body  || 'Nueva actividad en tu portal',
    icon:  '/favicon.svg',
    badge: '/favicon.svg',
    tag:   data.tag   || 'nf-notification',
    data:  { url: data.url || '/portal/' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// ── Notification click: focus portal tab or open new one ──────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/portal/';
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(list) {
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c.url.includes('/portal/') && 'focus' in c) return c.focus();
        }
        return self.clients.openWindow(target);
      })
  );
});
