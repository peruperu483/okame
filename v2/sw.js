// 通信が切れてもアプリを開けるように、画面のファイルを端末に置いておく。
// 画面のファイルを変えたら VERSION を上げる（上げないと古い画面が出続ける）。
// GAS（script.google.com）への通信はここでは扱わない。
const VERSION = 'v0.23.0';
const CACHE = 'okame-' + VERSION;
const FILES = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/update.js', './js/util.js', './js/bizday.js', './js/store.js', './js/api.js', './js/sync.js', './js/auth.js',
  './js/calc.js', './js/ui.js',
  './js/screens/settings.js', './js/screens/pin.js', './js/screens/more.js', './js/screens/common.js',
  './js/screens/store.js', './js/screens/today.js', './js/screens/plan.js', './js/screens/ana.js',
  './js/screens/kintai.js', './js/screens/shiire.js', './js/screens/kotei.js', './js/screens/cashout.js', './js/screens/lateedit.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

// ブラウザの控え（HTTPのキャッシュ）を通さずに取る。通すと、新しい版のなかに古いファイルが混ざることがある
const fresh = () => FILES.map(f => new Request(f, { cache: 'reload' }));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(fresh())).then(() => self.skipWaiting()));
});

// 画面から聞かれたら答える（js/update.js）：version＝この Service Worker の版／refetch＝画面のファイルを取り直す
self.addEventListener('message', e => {
  const port = e.ports && e.ports[0];
  const type = e.data && e.data.type;
  if (type === 'version') port?.postMessage(VERSION);
  else if (type === 'refetch') {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(fresh())).then(() => port?.postMessage(true), () => port?.postMessage(false)));
  }
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
