// 卓の追加の種類（キャストドリンク・ビール・日本酒・その他飲食・その他）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import {
  ORDER_KINDS, orderKind, orderPrices, orderExtra, orderSums, extraLabel, markDeleted, total, EXTRA_ADD, EXTRA_EXT
} from '../v2/js/calc.js';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
const plain = v => JSON.parse(JSON.stringify(v));

test('追加の記録に種類を残す。「その他」だけ名前を持つ（空なら名前なし）', () => {
  assert.deepEqual(orderExtra('ビール', 600), { type: EXTRA_ADD, cat: 'ビール', amount: 600 });
  assert.deepEqual(orderExtra('ビール', 600, '生'), { type: EXTRA_ADD, cat: 'ビール', amount: 600 }, '名前はその他のときだけ');
  assert.deepEqual(orderExtra('その他', 1500, '  花束 '), { type: EXTRA_ADD, cat: 'その他', name: '花束', amount: 1500 });
  assert.deepEqual(orderExtra('その他', 1500, '  '), { type: EXTRA_ADD, cat: 'その他', amount: 1500 });
  assert.equal(orderExtra('なにか', 100).cat, 'その他', '知らない種類はその他');
});

test('明細の名前：「ビール ¥600」。前の版の追加（種類なし）は「その他」', () => {
  assert.equal(extraLabel(orderExtra('ビール', 600)), 'ビール');
  assert.equal(extraLabel(orderExtra('キャストドリンク', 1000)), 'キャストドリンク');
  assert.equal(extraLabel(orderExtra('その他', 1500, '花束')), '花束');
  assert.equal(extraLabel(orderExtra('その他', 1500)), 'その他');
  assert.equal(extraLabel({ type: EXTRA_ADD, amount: 500 }), 'その他');
  assert.equal(orderKind({ type: EXTRA_ADD, amount: 500 }), 'その他');
  assert.equal(extraLabel({ type: EXTRA_EXT, label: '延長1時間', count: 2, amount: 2000 }), '延長1時間 ×2人', '延長は今までどおり');
});

test('金額のボタン：種類ごとの設定。GASが古くて設定がないときは、前の追加のボタン', () => {
  const s = { quickAdds: [500, 700], orderPrices: { 'ビール': [600, 900], '日本酒': [] } };
  assert.deepEqual(orderPrices(s, 'ビール'), [600, 900]);
  assert.deepEqual(orderPrices(s, '日本酒'), [], '全部消したら手打ちだけ');
  assert.deepEqual(orderPrices(s, 'キャストドリンク'), [500, 700]);
  assert.deepEqual(orderPrices({}, 'ビール'), [500, 800, 1000]);
});

test('種類ごとの売上と件数：精算済みの組の、消していない追加だけ。合計は今までどおり', () => {
  const beer = { id: 'a', ...orderExtra('ビール', 600) };
  const cast = { id: 'b', ...orderExtra('キャストドリンク', 1000) };
  const old = { id: 'c', type: EXTRA_ADD, amount: 500 };
  const ext = { id: 'd', type: EXTRA_EXT, label: '延長', count: 1, unit: 1000, amount: 1000, minutes: 60 };
  const v1 = { status: '退店', base: 3000, extras: [beer, cast, old, ext] };
  const v2 = { status: '退店', base: 0, extras: markDeleted([{ id: 'e', ...orderExtra('ビール', 600) }, { id: 'f', ...orderExtra('ビール', 800) }], 'e') };
  const v3 = { status: '店内', base: 0, extras: [{ id: 'g', ...orderExtra('日本酒', 900) }] };
  assert.equal(total(v1), 6100);
  const o = orderSums([v1, v2, v3]);
  assert.deepEqual(Object.keys(o), ORDER_KINDS);
  assert.deepEqual(o['ビール'], { amount: 1400, count: 2 });
  assert.deepEqual(o['キャストドリンク'], { amount: 1000, count: 1 });
  assert.deepEqual(o['その他'], { amount: 500, count: 1 });
  assert.deepEqual(o['日本酒'], { amount: 0, count: 0 }, '店内の組は数えない');
});

function boot(now) {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1], pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}

test('GAS：金額のボタンの初期値は、今の追加のボタンと同じ。店長が種類ごとに変えられる', () => {
  const env = boot('2026-11-21T14:00:00+09:00');
  const first = env.call('bootstrap').settings.orderPrices;
  assert.deepEqual(Object.keys(first), ORDER_KINDS);
  ORDER_KINDS.forEach(k => assert.deepEqual(first[k], [500, 800, 1000]));
  // 前の版のスプシ（金額のボタンの行がない）で、店長が前の追加のボタンを変えていたら、それが初期値。初期設定をし直しても同じ
  env.setSetting('quickAdds', [500, 1000]);
  const sh = env.ss.getSheetByName('設定');
  sh.getRange(env.gas.readSettingsRows_(sh).map.orderPrices.row, 1).setValue('');
  assert.deepEqual(env.call('bootstrap').settings.orderPrices['日本酒'], [500, 1000]);
  env.gas.setup();
  assert.deepEqual(JSON.parse(env.gas.readSettingsRows_(sh).map.orderPrices.value)['日本酒'], [500, 1000]);
  const mgrToken = env.login();
  const next = { ...plain(env.call('bootstrap').settings.orderPrices), 'ビール': [600, 800], 'キャストドリンク': [1000] };
  env.call('saveSettings', { mgrToken, settings: { orderPrices: next } });
  const saved = env.call('bootstrap').settings.orderPrices;
  assert.deepEqual(saved['ビール'], [600, 800]);
  assert.deepEqual(saved['キャストドリンク'], [1000]);
  assert.deepEqual(saved['日本酒'], [500, 1000]);
});

test('GAS：月次に種類ごとの売上と件数。試運転・店内・消した追加は数えない。2台で足しても両方残る', () => {
  const env = boot('2026-11-21T23:00:00+09:00');
  const mgrToken = env.login();
  const visit = (id, extra) => ({ bizDate: '2026-11-21', no: 1, people: 2, kind: '飲み放題', status: '店内', base: 6000, pays: [], ...extra });
  const send = (opId, id, data) => env.call('sync', { mgrToken, ops: [{ opId, table: 'visits', id, data }] }).results[0];
  // 2台の端末が、同じ卓に別々に足した
  assert.equal(send('a', 'v1', visit('v1', { extras: [{ id: 'x1', ...orderExtra('ビール', 600) }] })).ok, true);
  send('b', 'v1', { extras: [{ id: 'x2', ...orderExtra('キャストドリンク', 1000) }], updatedAt: '2026-11-21T22:00:00+09:00' });
  send('c', 'v1', { extras: [{ id: 'x3', ...orderExtra('その他', 1500, '花束') }, { id: 'x4', ...orderExtra('ビール', 800), del: true }, { id: 'x5', type: '追加', amount: 500 }] });
  const row = env.call('fetch', { table: 'visits', mgrToken }).rows.find(r => r.id === 'v1');
  assert.deepEqual(row.extras.map(x => x.id).sort(), ['x1', 'x2', 'x3', 'x4', 'x5']);
  assert.equal(row.total, 6000 + 600 + 1000 + 1500 + 500);
  send('d', 'v1', { status: '退店', pays: [{ id: 'p', method: '現金', amount: 9600 }] });
  send('e', 'v2', visit('v2', { status: '退店', trial: true, extras: [{ id: 'y', ...orderExtra('ビール', 600) }] })); // 試運転の印
  send('f', 'v3', visit('v3', { extras: [{ id: 'z', ...orderExtra('日本酒', 900) }] })); // まだ店内
  const s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual(s.orders['ビール'], { amount: 600, count: 1 });
  assert.deepEqual(s.orders['キャストドリンク'], { amount: 1000, count: 1 });
  assert.deepEqual(s.orders['その他'], { amount: 2000, count: 2 }, '花束と、前の版の追加');
  assert.deepEqual(s.orders['日本酒'], { amount: 0, count: 0 });
  assert.equal(s.sales, 9600, '売上は今までどおり');
  // スプシの「月次」タブにも出る
  env.call('buildMonthlySheet', { mgrToken });
  const sh = env.sheets['月次'] || env.ss.getSheetByName('月次');
  const vals = sh.getDataRange().getValues();
  const col = vals[0].indexOf('2026-11');
  const get = label => vals.find(r => r[0] === label)?.[col];
  assert.equal(Number(get('卓の追加（種類ごと）')), 3600);
  assert.equal(Number(get('　ビール')), 600);
  assert.equal(Number(get('　その他の件数')), 2);
});

test('GAS：管理シートの月（過去の月次）は、種類の内訳なし', () => {
  const env = boot('2026-11-21T14:00:00+09:00');
  const mgrToken = env.login();
  const s = env.call('monthly', { mgrToken, month: '2026-10' }).summary;
  assert.ok(s.orders === null || s.orders === undefined || Object.values(s.orders).every(o => o.count === 0));
});
