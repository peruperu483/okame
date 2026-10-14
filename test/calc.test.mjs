import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextNo, label, timeState, fmtMin, defaultAmount, validAmount, daySummary, cashDiff, closingIsStale } from '../v2/js/calc.js';

const S = { nomiPrice: 3000, nomiMinutes: 120, lastOrderMinutes: 30, pointCountsAsSales: true };
const at = s => new Date(s);
const inAt = '2026-11-01T19:00:00+09:00';

test('通し番号は削除した組も数える。名前が空なら番号で呼ぶ', () => {
  assert.equal(nextNo([]), 1);
  assert.equal(nextNo([{ no: 1 }, { no: 3, status: '削除' }]), 4);
  assert.equal(label({ no: 2, name: '' }), '2番');
  assert.equal(label({ no: 2, name: '田中' }), '田中');
});

test('残り時間：余裕・ラストオーダー・超過。延長で延びる。単品は経過時間', () => {
  const v = { plan: '飲み放題', inAt, people: 2 };
  assert.deepEqual(timeState(v, S, at('2026-11-01T20:00:00+09:00')), { kind: 'ok', left: 60 });
  assert.deepEqual(timeState(v, S, at('2026-11-01T20:30:00+09:00')), { kind: 'lo', left: 30 });
  assert.deepEqual(timeState(v, S, at('2026-11-01T21:05:00+09:00')), { kind: 'over', left: -5 });
  const ext = { ...v, extensions: [{ minutes: 30, price: 1000 }] };
  assert.deepEqual(timeState(ext, S, at('2026-11-01T21:05:00+09:00')), { kind: 'lo', left: 25 });
  assert.deepEqual(timeState({ plan: '単品', inAt }, S, at('2026-11-01T19:45:00+09:00')), { kind: 'single', elapsed: 45 });
  assert.equal(fmtMin(85), '1:25');
  assert.equal(fmtMin(-5), '0:05');
});

test('会計の初期値：飲み放題は人数×料金（延長の料金も足す）。単品はなし', () => {
  assert.equal(defaultAmount({ plan: '飲み放題', people: 3 }, S), 9000);
  assert.equal(defaultAmount({ plan: '飲み放題', people: 2, extensions: [{ price: 1000 }] }, S), 8000);
  assert.equal(defaultAmount({ plan: '単品', people: 2 }, S), null);
});

test('0円・未入力・小数では会計できない', () => {
  for (const x of ['', null, undefined, 0, '0', -100, 1.5, 'abc']) assert.equal(validAmount(x), false, String(x));
  for (const x of [1, '6000', 3000]) assert.equal(validAmount(x), true, String(x));
});

test('当日の合計：支払い方法と区分を別に数える。ポイントを外す設定もできる', () => {
  const visits = [
    { status: '会計済', people: 2, amount: 6000, pay: '現金', kind: '通常' },
    { status: '会計済', people: 10, amount: 30000, pay: 'キャッシュレス', kind: '団体' },
    { status: '会計済', people: 1, amount: 3000, pay: 'ポイント', kind: '通常' },
    { status: '店内', people: 4 },
    { status: '削除', people: 3, amount: 9000, pay: '現金' }
  ];
  const s = daySummary(visits, S);
  assert.deepEqual(s, { sales: 39000, cash: 6000, cashless: 30000, point: 3000, normal: 9000, group: 30000, guests: 13, groups: 3, inStore: 1, inStorePeople: 4 });
  const noPoint = daySummary(visits, { ...S, pointCountsAsSales: false });
  assert.equal(noPoint.sales, 36000);
  assert.equal(noPoint.normal, 6000);
  assert.equal(noPoint.point, 3000);
});

test('レジの差額は準備金を引いて比べる。締めのあとに会計が変わったら分かる', () => {
  assert.equal(cashDiff(26000, 20000, 6000), 0);
  assert.equal(cashDiff(25500, 20000, 6000), -500);
  const sum = { sales: 9000, cash: 9000, groups: 2, guests: 3 };
  assert.equal(closingIsStale(null, sum), false);
  assert.equal(closingIsStale({ sales: 9000, cash: 9000, groups: 2, guests: 3 }, sum), false);
  assert.equal(closingIsStale({ sales: 6000, cash: 6000, groups: 1, guests: 2 }, sum), true);
});
