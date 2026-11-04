// 新しい版の帯と読み込み直し（v2/js/update.js・v2/sw.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canAutoReload, bandText } from '../v2/js/update.js';

const OK = { fresh: true, pending: 0, sending: false, busy: false, touched: false, reloadedOnce: false };

test('勝手に読み込み直すのは、開いた直後・送信待ち0件・入力の途中でないときだけ', () => {
  assert.equal(canAutoReload(OK), true);
  assert.equal(canAutoReload({ ...OK, fresh: false }), false, '開いてしばらくたった・もう画面に触った');
  assert.equal(canAutoReload({ ...OK, pending: 2 }), false, '送信待ちがある');
  assert.equal(canAutoReload({ ...OK, sending: true }), false, '送っている途中');
  assert.equal(canAutoReload({ ...OK, busy: true }), false, 'パネル・広げた卓を開いている');
  assert.equal(canAutoReload({ ...OK, touched: true }), false, '今の画面で入力している');
  assert.equal(canAutoReload({ ...OK, reloadedOnce: true }), false, '同じ版で一度読み込み直した（くり返さない）');
});

test('帯の文字', () => {
  assert.equal(bandText({ waiting: false, pending: 3, online: true }), '新しい版があります。押すと更新します');
  assert.equal(bandText({ waiting: true, pending: 2, online: true }), '送信が終わってから更新します（送信待ち 2件）');
  assert.equal(bandText({ waiting: true, pending: 1, online: false }), '送信が終わってから更新します（オフライン・送信待ち 1件）');
  assert.equal(bandText({ waiting: true, pending: 0, online: true }), '更新しています…');
});

// sw.js を、まねの self の上で動かす
function loadSw() {
  const src = fs.readFileSync(new URL('../v2/sw.js', import.meta.url), 'utf8');
  const handlers = {}, added = [];
  const self = { addEventListener: (t, fn) => { handlers[t] = fn; }, location: { origin: 'https://x' }, skipWaiting: () => {}, clients: { claim: () => {} } };
  const caches = { open: async () => ({ addAll: async reqs => { added.push(...reqs); } }), keys: async () => [] };
  class Request { constructor(url, opt) { this.url = url; this.cache = opt?.cache; } }
  new Function('self', 'caches', 'Request', 'fetch', src)(self, caches, Request, () => Promise.reject(new Error('no net')));
  return { handlers, added, version: src.match(/const VERSION = '([^']+)'/)[1], files: src };
}

test('Service Worker は、聞かれたら版を答える', () => {
  const { handlers, version } = loadSw();
  let got = null;
  handlers.message({ data: { type: 'version' }, ports: [{ postMessage: v => { got = v; } }] });
  assert.equal(got, version);
  const cfg = fs.readFileSync(new URL('../v2/config.js', import.meta.url), 'utf8');
  assert.equal('v' + cfg.match(/APP_VERSION = '([^']+)'/)[1], version, 'config.js の APP_VERSION と sw.js の VERSION をそろえる（ずれると帯が出続ける）');
});

test('Service Worker は、ブラウザの控えを通さずにファイルを取り、取り直しもできる', async () => {
  const { handlers, added } = loadSw();
  let wait = null;
  handlers.install({ waitUntil: p => { wait = p; } });
  await wait;
  assert.ok(added.length > 10);
  assert.ok(added.every(r => r.cache === 'reload'));
  assert.ok(added.some(r => r.url === './js/update.js'), 'update.js を FILES に入れる');
  added.length = 0;
  let ok = null;
  handlers.message({ data: { type: 'refetch' }, ports: [{ postMessage: v => { ok = v; } }], waitUntil: p => { wait = p; } });
  await wait;
  assert.equal(ok, true);
  assert.ok(added.length > 10);
});
