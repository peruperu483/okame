// 過ぎた日の売上を、店長があとから足す・直す・取り消す：保存内容の作り方・締めの計算し直し・直せる範囲
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import {
  lateEditStart, inLateRange, lateVisitPatch, lateClosingPatch, lateSnap, daySummary, livePays, total, extrasTotal
} from '../v2/js/calc.js';

const S = { nomiPrice: 3000, pointCountsAsSales: true };
let seq = 0;
const mk = () => 'id' + (++seq);
const NOW = '2026-11-01T14:00:00+09:00';

test('直せる範囲：今月と先月の1日から、昨日まで（今日と先月より前は直せない）', () => {
  assert.equal(lateEditStart('2026-11-01'), '2026-10-01');
  assert.equal(lateEditStart('2026-01-15'), '2025-12-01');
  assert.equal(lateEditStart('2026-12-31'), '2026-11-01');
  assert.equal(inLateRange('2026-10-31', '2026-11-01'), true);
  assert.equal(inLateRange('2026-10-01', '2026-11-01'), true);
  assert.equal(inLateRange('2026-09-30', '2026-11-01'), false);
  assert.equal(inLateRange('2026-11-01', '2026-11-01'), false);
  assert.equal(inLateRange('2026-11-02', '2026-11-01'), false);
});

test('足す：イベントの打ち忘れ（34名×5,000円、現金とキャッシュレスの併用）', () => {
  const r = lateVisitPatch(null, {
    kind: 'イベント', name: 'シムラ病院', people: 34, unit: 5000, total: 170000, inAt: '2026-10-23T21:00:00+09:00',
    pays: [{ method: '現金', amount: 100000 }, { method: 'キャッシュレス', amount: 70000 }]
  }, S, mk, NOW);
  assert.equal(r.ok, true);
  const p = r.patch;
  assert.deepEqual([p.people, p.base, p.total, p.unitPrice, p.basePeople, p.cash, p.cashless, p.point], [34, 170000, 170000, 5000, 34, 100000, 70000, 0]);
  assert.equal(p.pays.length, 2);
  assert.ok(p.pays.every(x => x.id && !x.del && x.at === '2026-10-23T21:00:00+09:00'));
});

test('足す：入力の間違いは断る（受け取りが合わない・合計が空・イベントの単価なし）', () => {
  const base = { kind: '飲み放題', name: '', people: 2, unit: 3000, total: 6000, pays: [{ method: '現金', amount: 6000 }] };
  assert.equal(lateVisitPatch(null, base, S, mk, NOW).ok, true);
  assert.match(lateVisitPatch(null, { ...base, pays: [{ method: '現金', amount: 5000 }] }, S, mk, NOW).error, /あと ¥1,000 足りません/);
  assert.match(lateVisitPatch(null, { ...base, pays: [{ method: '現金', amount: 7000 }] }, S, mk, NOW).error, /¥1,000 多いです/);
  assert.match(lateVisitPatch(null, { ...base, total: '' }, S, mk, NOW).error, /合計金額/);
  assert.match(lateVisitPatch(null, { ...base, kind: 'イベント', unit: '' }, S, mk, NOW).error, /単価/);
  assert.match(lateVisitPatch(null, { ...base, kind: '常連', unit: '' }, S, mk, NOW).error, /料金/);
  assert.match(lateVisitPatch(null, { ...base, pays: [{ method: '小切手', amount: 6000 }] }, S, mk, NOW).error, /支払い方法/);
});

test('足す：人数×料金と違う合計は、単価を持たない（常連・イベント）。単品は合計がそのまま基本の金額', () => {
  const pay = n => [{ method: '現金', amount: n }];
  const reg = lateVisitPatch(null, { kind: '常連', people: 3, unit: 2000, total: 6000, pays: pay(6000) }, S, mk, NOW).patch;
  assert.deepEqual([reg.unitPrice, reg.base], [2000, 6000]);
  const regOdd = lateVisitPatch(null, { kind: '常連', people: 3, unit: 2000, total: 5500, pays: pay(5500) }, S, mk, NOW).patch;
  assert.deepEqual([regOdd.unitPrice, regOdd.base], ['', 5500]);
  const ev = lateVisitPatch(null, { kind: 'イベント', people: 10, unit: 5000, total: 48000, pays: pay(48000) }, S, mk, NOW).patch;
  assert.deepEqual([ev.unitPrice, ev.basePeople, ev.base], ['', '', 48000]);
  const one = lateVisitPatch(null, { kind: '単品', people: 2, total: 4300, pays: pay(4300) }, S, mk, NOW).patch;
  assert.equal(one.base, 4300);
});

test('直す：金額（追加・延長は残す）・人数・支払い方法。前の受け取りには消した印が付く', () => {
  const v = {
    id: 'v1', bizDate: '2026-10-24', name: '武田さん', kind: '飲み放題', status: '退店', people: 3, base: 9000,
    extras: [{ id: 'x1', type: '追加', amount: 1000 }, { id: 'x2', type: '追加', amount: 500, del: true }],
    pays: [{ id: 'p1', method: '現金', amount: 10000, at: '2026-10-24T20:14:28+09:00' }]
  };
  assert.equal(total(v), 10000);
  // 4人に直す：9,000 → 12,000＋追加1,000 ＝ 13,000。支払いをキャッシュレスに
  const r = lateVisitPatch(v, { people: 4, unit: 3000, total: 13000, name: '武田さん', pays: [{ method: 'キャッシュレス', amount: 13000 }] }, S, mk, NOW);
  assert.equal(r.ok, true);
  const p = r.patch;
  assert.deepEqual([p.people, p.base, p.total, p.cash, p.cashless], [4, 12000, 13000, 0, 13000]);
  assert.equal(p.pays.find(x => x.id === 'p1').del, true);
  assert.equal(livePays({ pays: p.pays }).length, 1);
  // 合計が追加・延長より小さいのは断る
  assert.match(lateVisitPatch(v, { people: 3, unit: 3000, total: 900, pays: [{ method: '現金', amount: 900 }] }, S, mk, NOW).error, /追加・延長/);
  // 受け取りを変えなければ、受け取りには触らない
  const same = lateVisitPatch(v, { people: 3, unit: 3000, total: 10000, pays: [{ method: '現金', amount: 10000 }] }, S, mk, NOW).patch;
  assert.equal('pays' in same, false);
  assert.equal(same.cash, 10000);
});

test('直す：人数×単価のイベントは、卓の −／＋ で動かした人数を保ったまま単価と人数を直せる', () => {
  const v = {
    id: 'e1', bizDate: '2026-10-23', kind: 'イベント', status: '退店', people: 34, basePeople: 32, unitPrice: 5000, base: 170000,
    extras: [{ id: 'a', type: '人数', delta: 1, amount: 0 }, { id: 'b', type: '人数', delta: 1, amount: 0 }],
    pays: [{ id: 'p', method: '現金', amount: 170000 }]
  };
  // 36人・4,000円に直す（入店時の人数は 36−2 ＝ 34）
  const r = lateVisitPatch(v, { people: 36, unit: 4000, total: 144000, pays: [{ method: '現金', amount: 144000 }] }, S, mk, NOW).patch;
  assert.deepEqual([r.people, r.basePeople, r.unitPrice, r.base, r.total], [36, 34, 4000, 144000, 144000]);
  // 人数×単価と違う合計にすると、単価は持たない（GASの人数×単価の計算に上書きされないように）
  const odd = lateVisitPatch(v, { people: 34, unit: 5000, total: 160000, pays: [{ method: '現金', amount: 160000 }] }, S, mk, NOW).patch;
  assert.deepEqual([odd.unitPrice, odd.basePeople, odd.base], ['', '', 160000]);
});

test('操作履歴に残す形：日・名前・種類・人数・合計・支払い', () => {
  const v = { bizDate: '2026-10-24', name: '武田さん', kind: '飲み放題', people: 3, base: 9000, extras: [{ id: 'x', type: '追加', amount: 1000 }], pays: [{ id: 'p', method: '現金', amount: 10000 }, { id: 'q', method: 'ポイント', amount: 1, del: true }] };
  assert.deepEqual(lateSnap(v), { bizDate: '2026-10-24', name: '武田さん', kind: '飲み放題', people: 3, total: 10000, pays: [{ method: '現金', amount: 10000 }] });
});

test('締めの計算し直し：売上の内訳が変わり、あるはずの現金と差額が動く。数えた現金は変えない', () => {
  const visit = (id, kind, tot, method) => ({ id, bizDate: '2026-10-23', kind, status: '退店', people: 2, base: tot, extras: [], pays: [{ id: 'p' + id, method, amount: tot }], cash: method === '現金' ? tot : 0, cashless: method === '現金' ? 0 : tot, point: 0 });
  const visits = [visit('a', '飲み放題', 6000, '現金')];
  const closing = { bizDate: '2026-10-23', ...Object.fromEntries(Object.entries(daySummary(visits, S)).filter(([k]) => ['sales', 'guests', 'groups', 'cash', 'cashless', 'point', 'nomi', 'tanpin', 'event', 'regular'].includes(k))), openCash: 50000, expectedCash: 56000, countedCash: 56000, diff: 0 };
  assert.equal(lateClosingPatch(closing, daySummary(visits, S)), null); // 変わらなければ何もしない
  // イベント（現金130,000）を足す
  const more = [...visits, visit('b', 'イベント', 130000, '現金')];
  const p1 = lateClosingPatch(closing, daySummary(more, S));
  assert.deepEqual([p1.sales, p1.cash, p1.event, p1.nomi, p1.groups, p1.guests], [136000, 136000, 130000, 6000, 2, 4]);
  assert.deepEqual([p1.expectedCash, p1.diff, p1.lateAdjust], [186000, -130000, 130000]);
  assert.equal(p1.diff + p1.lateAdjust, 0); // 締めたときの差額 ＝ 差額 ＋ あとから直した分
  assert.equal('countedCash' in p1, false);
  // さらに、そのイベントの支払いをキャッシュレスに直す（現金売上は 136,000 → 6,000）。増減は積み重なる
  const closing2 = { ...closing, ...p1 };
  const fixed = [visits[0], visit('b', 'イベント', 130000, 'キャッシュレス')];
  const p2 = lateClosingPatch(closing2, daySummary(fixed, S));
  assert.deepEqual([p2.cash, p2.cashless, p2.expectedCash, p2.diff, p2.lateAdjust], [6000, 130000, 56000, 0, 0]);
  // 取り消すと売上から外れる
  const gone = lateClosingPatch(closing2, daySummary(visits, S));
  assert.deepEqual([gone.sales, gone.expectedCash, gone.diff, gone.lateAdjust], [6000, 56000, 0, 0]);
  assert.equal(extrasTotal(more[1]), 0);
});

// ===== GAS =====
const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
function boot(now = '2026-11-01T14:00:00+09:00') {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}
const newVisit = (bizDate, extra = {}) => ({ bizDate, kind: '飲み放題', status: '退店', people: 2, base: 6000, extras: [], pays: [{ id: 'p', method: '現金', amount: 6000 }], total: 6000, updatedAt: '2026-11-01T13:00:00+09:00', ...extra });

test('GAS：直せる来客は今月と先月まで。先月より前は店長でも断る（部分の更新でも）', () => {
  const env = boot();
  const mgrToken = env.login();
  const sync = (id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id + Math.random(), table: 'visits', id, data, at: '2026-11-01T14:00:00+09:00' }] }).results[0];
  assert.equal(sync('ok1', newVisit('2026-10-01')).ok, true);          // 先月の1日
  assert.equal(sync('ok2', newVisit('2026-10-31')).ok, true);
  assert.equal(sync('old1', newVisit('2026-09-30')).code, 'too_old');  // 先月より前
  assert.equal(sync('ok1', { name: '直した', updatedAt: '2026-11-01T14:01:00+09:00' }).ok, true); // 先月の記録の部分の更新
  const names = env.ss.getSheetByName('来客').dump().map(r => r['ID']);
  assert.deepEqual(names.sort(), ['ok1', 'ok2']);
});

test('GAS：締めに「あとから直した分」の列。店長が足した過ぎた日の来客と締めの直しが、月次に入る', () => {
  const env = boot('2026-11-05T14:00:00+09:00');
  const mgrToken = env.login();
  const at = '2026-11-05T14:00:00+09:00';
  // 11/2 の締め（売上なし）
  env.call('sync', { mgrToken, ops: [
    { opId: 'c1', table: 'closings', id: '2026-11-02', data: { bizDate: '2026-11-02', closedAt: '2026-11-03T00:42:00+09:00', sales: 0, cash: 0, expectedCash: 56000, countedCash: 56000, diff: 0, lateAdjust: 0, trial: false }, at }
  ] });
  const before = env.call('monthly', { mgrToken, month: '2026-11' }).summary.sales;
  // 店長があとからイベントを足し、締めを計算し直す（画面が送る内容）
  env.call('sync', { mgrToken, ops: [
    { opId: 'v1', table: 'visits', id: 'ev1', data: newVisit('2026-11-02', { kind: 'イベント', people: 34, basePeople: 34, unitPrice: 5000, base: 170000, total: 170000, cash: 170000, cashless: 0, point: 0, pays: [{ id: 'q', method: '現金', amount: 170000 }], trial: false }), at },
    { opId: 'c2', table: 'closings', id: '2026-11-02', data: { sales: 170000, cash: 170000, event: 170000, expectedCash: 226000, diff: -170000, lateAdjust: 170000 }, at }
  ] });
  const row = env.ss.getSheetByName('締め').dump().find(r => r['ID'] === '2026-11-02');
  assert.deepEqual([row['売上'], row['イベント'], row['あるはずの現金'], row['数えた現金'], row['差額'], row['あとから直した分']], [170000, 170000, 226000, 56000, -170000, 170000]);
  const v = env.ss.getSheetByName('来客').dump().find(r => r['ID'] === 'ev1');
  assert.deepEqual([v['合計'], v['現金'], v['状態']], [170000, 170000, '退店']);
  assert.equal(env.call('monthly', { mgrToken, month: '2026-11' }).summary.sales - before, 170000); // 月次にも入る
  // 取り消す（削除）と月次から外れる
  env.call('sync', { mgrToken, ops: [{ opId: 'v2', table: 'visits', id: 'ev1', data: { status: '削除', updatedAt: '2026-11-05T14:05:00+09:00' }, at }] });
  assert.equal(env.call('monthly', { mgrToken, month: '2026-11' }).summary.sales, before);
});
