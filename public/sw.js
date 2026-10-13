// FloodGuard final release: never pin old Amplify assets in a service-worker cache.
self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
// No fetch handler. AWS Amplify always serves the current deployment directly.
