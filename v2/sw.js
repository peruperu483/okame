// 通信が切れてもアプリを開けるように、画面のファイルを端末に置いておく。
// 画面のファイルを変えたら VERSION を上げる（上げないと古い画面が出続ける）。
// GAS（script.google.com）への通信はここでは扱わない。
const VERSION = 'v0.12.0';
const CACHE = 'okame-' + VERSION;
const FILES = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/util.js', './js/bizday.js', './js/store.js', './js/api.js', './js/sync.js', './js/auth.js',
  './js/calc.js', './js/ui.js',
  './js/screens/settings.js', './js/screens/pin.js', './js/screens/more.js', './js/screens/common.js',
  './js/screens/store.js', './js/screens/today.js', './js/screens/plan.js', './js/screens/ana.js',
  './js/screens/kintai.js', './js/screens/shiire.js', './js/screens/kotei.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('okame-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 端末にあるものをすぐ出す。つながっていれば裏で新しいものに入れ替える
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || cache.match('./index.html');
  }));
});
