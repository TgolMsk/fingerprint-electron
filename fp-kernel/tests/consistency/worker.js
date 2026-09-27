/* Dedicated Worker：采集后 postMessage 回主页。 */
importScripts('collect.js');

collectFingerprint().then(function (data) {
  postMessage({ type: 'fp-result', context: 'worker', data: data });
}).catch(function (e) {
  postMessage({ type: 'fp-result', context: 'worker', data: { error: { fatal: String((e && e.message) || e) } } });
});
