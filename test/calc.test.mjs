import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextNo, label, baseAmount, total, paidTotal, remaining, methodSums, receive, payLabel,
  timeState, timeText, countedAmount, daySummary, pct, moveLabel, purchaseLabel, validateMove, registerCalc, closingIsStale
} from '../v2/js/calc.js';

const S = { nomiPrice: 3000, nomiMinutes: 120, lastOrderMinutes: 30, pointCountsAsSales: true };
const at = s => new Date(s);
const inAt = '2026-11-01T19:00:00+09:00';

test('通し番号は削除した組も数える。名前が空なら「○組目」', () => {
  assert.equal(nextNo([]), 1);
  assert.equal(nextNo([{ no: 1 }, { no: 3, status: '削除' }]), 4);
  assert.equal(label({ no: 2, name: '' }), '2組目');
  assert.equal(label({ no: 2, name: '佐藤' }), '佐藤');
});

test('基本の金額：飲み放題は人数×料金、イベントは団体の合計、単品は0円', () => {
  assert.equal(baseAmount('飲み放題', 3, S), 9000);
  assert.equal(baseAmount('イベント', 8, S, 54000), 54000);
  assert.equal(baseAmount('単品', 2, S), 0);
});

test('合計 = 基本＋追加。受け取りと残り', () => {
  const v = { base: 9000, extras: [{ amount: 800 }, { amount: 500 }], pays: [{ method: '現金', amount: 3000 }] };
  assert.equal(total(v), 10300);
  assert.equal(paidTotal(v), 3000);
  assert.equal(remaining(v), 7300);
  assert.deepEqual(methodSums([{ method: 'キャッシュレス', amount: 7000 }, { method: '現金', amount: 3500 }]), { cash: 3500, cashless: 7000, point: 0 });
});

test('受け取り：空欄なら残りの全額で退店。分けて受け取れる', () => {
  const v = { base: 10500, extras: [], pays: [] };
  assert.deepEqual(receive(v, 'キャッシュレス', '7000'), { ok: true, pay: { method: 'キャッシュレス', amount: 7000 }, change: 0, finished: false });
  const v2 = { ...v, pays: [{ method: 'キャッシュレス', amount: 7000 }] };
  assert.deepEqual(receive(v2, '現金', ''), { ok: true, pay: { method: '現金', amount: 3500 }, change: 0, finished: true });
});

test('受け取り：現金で多ければお釣り。キャッシュレス・ポイントで多い金額は受け付けない', () => {
  const v = { base: 6000, extras: [], pays: [{ method: '現金', amount: 3000 }] };
  assert.deepEqual(receive(v, '現金', 5000), { ok: true, pay: { method: '現金', amount: 3000 }, change: 2000, finished: true });
  assert.equal(receive(v, 'キャッシュレス', 5000).ok, false);
  assert.match(receive(v, 'ポイント', 5000).error, /残り（¥3,000）より多い/);
  for (const x of ['0', -1, 1.5, 'abc']) assert.equal(receive(v, '現金', x).ok, false, String(x));
});

test('受け取り：0円の組はそのまま退店。追加を消して受け取りすぎになったら止める', () => {
  assert.deepEqual(receive({ base: 0, extras: [], pays: [] }, '現金', ''), { ok: true, pay: null, change: 0, finished: true });
  const over = { base: 0, extras: [], pays: [{ method: '現金', amount: 1200 }] };
  assert.equal(receive(over, '現金', '').ok, false);
  assert.match(receive(over, '現金', '').error, /¥1,200 多く/);
});

test('支払いの表示は併用を「＋」でつなぐ。受け取りなしは0円', () => {
  assert.equal(payLabel({ pays: [{ method: 'キャッシュレス', amount: 7000 }, { method: '現金', amount: 3500 }] }), 'キャッシュレス ¥7,000 ＋ 現金 ¥3,500');
  assert.equal(payLabel({ pays: [] }), '0円');
});

test('時間：飲み放題は残り、延長で延びる。イベントは終了の予定まで。単品は経過', () => {
  const v = { kind: '飲み放題', inAt, extras: [] };
  assert.deepEqual(timeState(v, S, at('2026-11-01T20:00:00+09:00')), { kind: 'ok', left: 60 });
  assert.deepEqual(timeState(v, S, at('2026-11-01T20:30:00+09:00')), { kind: 'lo', left: 30 });
  assert.deepEqual(timeState(v, S, at('2026-11-01T21:05:00+09:00')), { kind: 'over', left: -5 });
  const ext = { ...v, extras: [{ type: '延長', minutes: 30, amount: 2000 }, { type: '追加', amount: 800 }] };
  assert.deepEqual(timeState(ext, S, at('2026-11-01T21:05:00+09:00')), { kind: 'lo', left: 25 });
  const ev = { kind: 'イベント', inAt, endAt: '2026-11-01T21:30:00+09:00' };
  assert.deepEqual(timeState(ev, S, at('2026-11-01T20:00:00+09:00')), { kind: 'ok', left: 90 });
  assert.deepEqual(timeState(ev, S, at('2026-11-01T21:10:00+09:00')), { kind: 'lo', left: 20 });
  assert.equal(timeText(ev, timeState(ev, S, at('2026-11-01T21:10:00+09:00'))), '終了まで20分');
  assert.equal(timeText(ev, timeState(ev, S, at('2026-11-01T21:45:00+09:00'))), '15分超過');
  assert.equal(timeText(v, timeState(v, S, at('2026-11-01T20:00:00+09:00'))), 'あと60分');
  const tp = { kind: '単品', inAt };
  assert.equal(timeText(tp, timeState(tp, S, at('2026-11-01T19:15:00+09:00'))), '経過 15分');
});

test('その日の合計：数えるのは退店した組だけ。店内は見込み。ポイントを外す設定もできる', () => {
  const visits = [
    { status: '退店', kind: '飲み放題', people: 2, base: 6000, extras: [], pays: [{ method: '現金', amount: 6000 }] },
    { status: '退店', kind: '飲み放題', people: 3, base: 9000, extras: [{ amount: 1500 }], pays: [{ method: 'キャッシュレス', amount: 7000 }, { method: '現金', amount: 3500 }] },
    { status: '退店', kind: 'イベント', people: 8, base: 54000, extras: [], pays: [{ method: 'ポイント', amount: 4000 }, { method: '現金', amount: 50000 }] },
    { status: '店内', kind: '単品', people: 1, base: 0, extras: [{ amount: 1200 }], pays: [] },
    { status: '店内', kind: '飲み放題', people: 2, base: 6000, extras: [], pays: [{ method: '現金', amount: 3000 }] },
    { status: '削除', kind: '飲み放題', people: 4, base: 12000, extras: [], pays: [] }
  ];
  assert.deepEqual(daySummary(visits, S), {
    sales: 70500, guests: 13, groups: 3, avg: 5423, cash: 59500, cashless: 7000, point: 4000,
    nomi: 16500, tanpin: 0, event: 54000, inStore: 2, inStorePeople: 3, expected: 7200
  });
  const noPoint = daySummary(visits, { ...S, pointCountsAsSales: false });
  assert.equal(noPoint.sales, 66500);
  assert.equal(noPoint.event, 50000);
  assert.equal(countedAmount(visits[2], { pointCountsAsSales: false }), 50000);
  assert.equal(pct(7000, 70500), 10);
  assert.equal(pct(1, 0), 0);
});

test('出し入れの表示と入力の確認', () => {
  assert.equal(moveLabel({ type: '出金', category: 'その他', note: '花' }), '出金・その他（花）');
  assert.equal(moveLabel({ type: '出金', category: '飲食物' }), '出金・飲食物');
  assert.equal(moveLabel({ type: '入金', reason: 'オーナーの補充' }), '入金・オーナーの補充');
  assert.equal(purchaseLabel('備品', 'x'), '備品');
  assert.equal(validateMove({ type: '出金', amount: '', category: '飲食物' }), '金額を入れてください。');
  assert.equal(validateMove({ type: '出金', amount: 3200, category: 'その他', note: ' ' }), 'その他の内容を入れてください。');
  assert.equal(validateMove({ type: '出金', amount: 3200, category: '飲食物' }), '');
  assert.equal(validateMove({ type: '入金', amount: 10000 }), '');
});

const mv = (bizDate, type, amount, atIso, extra = {}) => ({ bizDate, type, amount, at: atIso, status: '有効', ...extra });

test('レジ：前の締めの数えた現金を引き継ぎ、あるはずの現金を出す', () => {
  const closings = [
    { bizDate: '2026-10-30', closedAt: '2026-10-31T01:00:00+09:00', countedCash: 20000 },
    { bizDate: '2026-10-31', closedAt: '2026-11-01T01:30:00+09:00', countedCash: 45000 }
  ];
  const moves = [
    mv('2026-11-01', '出金', 3200, '2026-11-01T17:00:00+09:00', { category: '飲食物' }),
    mv('2026-11-01', '入金', 10000, '2026-11-01T18:00:00+09:00', { reason: 'オーナーの補充' }),
    mv('2026-11-01', '出金', 500, '2026-11-01T19:00:00+09:00', { status: '削除' })
  ];
  assert.deepEqual(registerCalc({ day: '2026-11-01', closings, moves, cashSales: 30000 }),
    { openCash: 45000, openFrom: 'carry', cashIn: 10000, cashOut: 3200, expected: 81800 });
});

test('レジ：閉店後・休みの日の補充は次の営業日の開店時の現金に入る', () => {
  const closings = [{ bizDate: '2026-11-01', closedAt: '2026-11-02T01:00:00+09:00', countedCash: 40000 }];
  const moves = [
    mv('2026-11-01', '入金', 5000, '2026-11-01T20:00:00+09:00'),  // 閉店前：11/1の分
    mv('2026-11-01', '入金', 3000, '2026-11-02T02:00:00+09:00'),  // 閉店後：次の営業日へ
    mv('2026-11-02', '入金', 20000, '2026-11-02T15:00:00+09:00'), // 休みの日（11/2）の補充
    mv('2026-11-03', '出金', 1000, '2026-11-03T18:00:00+09:00')
  ];
  const d3 = registerCalc({ day: '2026-11-03', closings, moves, cashSales: 0 });
  assert.equal(d3.openCash, 63000);
  assert.equal(d3.cashOut, 1000);
  assert.equal(d3.expected, 62000);
  // 締めた日を見直すときは、閉店のあとに入れた分を除く
  const d1 = registerCalc({ day: '2026-11-01', closings, moves, cashSales: 0, until: '2026-11-02T01:00:00+09:00' });
  assert.equal(d1.cashIn, 5000);
});

test('レジ：その日に手で入れた開店時の現金が優先。前の締めがなければ「まだない」', () => {
  assert.deepEqual(registerCalc({ day: '2026-11-01', closings: [], moves: [], cashSales: 1000 }),
    { openCash: null, openFrom: 'none', cashIn: 0, cashOut: 0, expected: 1000 });
  const r = registerCalc({ day: '2026-11-01', closings: [{ bizDate: '2026-10-31', closedAt: 'x', countedCash: 1 }], moves: [], dayRow: { openCash: 30000 }, cashSales: 0 });
  assert.equal(r.openCash, 30000);
  assert.equal(r.openFrom, 'manual');
});

test('締めのあとに会計が変わったか', () => {
  const sum = { sales: 9000, cash: 9000, groups: 2, guests: 3 };
  assert.equal(closingIsStale(null, sum), false);
  assert.equal(closingIsStale({ sales: 9000, cash: 9000, groups: 2, guests: 3 }, sum), false);
  assert.equal(closingIsStale({ sales: 6000, cash: 6000, groups: 1, guests: 2 }, sum), true);
});
