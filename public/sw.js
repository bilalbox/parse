self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// No fetch handler: all content is served from the edge. A passthrough
// (respondWith(fetch(e.request))) would only add an event-loop hop per request,
// so we let the browser handle requests directly.
