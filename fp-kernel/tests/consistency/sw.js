/* Service Worker：收到 fp-collect 后采集，通过 MessageChannel 的 port 回传结果。 */
importScripts('collect.js');

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(clients.claim()); });

self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'fp-collect') return;
  var port = e.ports && e.ports[0];
  if (!port) return;
  collectFingerprint().then(function (data) {
    port.postMessage({ type: 'fp-result', context: 'service-worker', data: data });
  }).catch(function (err) {
    port.postMessage({ type: 'fp-result', context: 'service-worker', data: { error: { fatal: String((err && err.message) || err) } } });
  });
});
