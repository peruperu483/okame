// 総点検（2026-10-15）で見つかったものの直し：2台で同じ卓／遅れて届いた送信／定義の統一／スプシの書き戻し／月のタブの更新 ほか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { memoryStore } from '../v2/js/store.js';
import { createSync } from '../v2/js/sync.js';
import { ApiError, NetworkError } from '../v2/js/api.js';
import { total, paidTotal, livePays, liveExtras, markDeleted, methodSums, markAllDeleted } from '../v2/js/calc.js';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
function boot(now = '2026-11-05T20:00:00+09:00') {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  const login = () => call('login', { pin }).mgrToken;
  const sync = (mgrToken, ops) => call('sync', { mgrToken, ops: ops.map(([table, id, data, at]) => ({ opId: 'o-' + id + Math.random(), table, id, data, at })) });
  return { ...env, token, pin, call, login, sync };
}
const plain = v => JSON.parse(JSON.stringify(v));
const visitRow = env => env.call('fetch', { table: 'visits' }).rows.find(r => r.id === 'v1');

// ===== 高1：2台で同じ卓 =====
test('2台で同じ卓：片方が追加、もう片方が古い写しで会計しても、追加は消えない。合計と受け取りはGASが計算し直す', () => {
  const env = boot();
  env.sync(null, [['visits', 'v1', { bizDate: '2026-11-05', no: 1, people: 2, kind: '飲み放題', base: 6000, status: '店内', extras: [], pays: [], total: 6000, cash: 0, cashless: 0, point: 0, updatedAt: '2026-11-05T19:00:00+09:00' }]]);
  // タブレット：+1,000を追加
  env.sync(null, [['visits', 'v1', { extras: [{ id: 'x1', type: '追加', amount: 1000 }], total: 7000, updatedAt: '2026-11-05T19:30:00+09:00' }]]);
  // スマホ（古い写し・追加を知らない）：現金6,000を受け取って退店。合計は6,000のまま送ってくる
  const r = env.sync(null, [['visits', 'v1', { pays: [{ id: 'p1', method: '現金', amount: 6000 }], status: '退店', total: 6000, cash: 6000, updatedAt: '2026-11-05T19:40:00+09:00' }]]);
  const v = visitRow(env);
  assert.deepEqual([v.extras.length, v.pays.length, v.total, v.cash, v.status], [1, 1, 7000, 6000, '退店']);
  assert.ok(plain(r).results[0].current, '端末に、合わせた結果を返す'); // 端末の合計も7,000に直る
  assert.equal(plain(r).results[0].current.total, 7000);
});

test('2台で同じ卓：遅れて届いた古い操作でも、足した分は合わさる。消した印は、古い写しで復活しない', () => {
  const env = boot();
  env.sync(null, [['visits', 'v1', { bizDate: '2026-11-05', no: 1, people: 2, kind: '飲み放題', base: 6000, status: '店内', extras: [{ id: 'x1', type: '追加', amount: 1000 }], pays: [], total: 7000, cash: 0, cashless: 0, point: 0, updatedAt: '2026-11-05T19:00:00+09:00' }]]);
  // 新しい操作：x1を消す（印を付ける）
  env.sync(null, [['visits', 'v1', { extras: [{ id: 'x1', type: '追加', amount: 1000, del: true }], total: 6000, updatedAt: '2026-11-05T20:00:00+09:00' }]]);
  assert.equal(visitRow(env).total, 6000);
  // 古い写しの端末が、x1を消していない配列と、新しい追加x2を、古い時刻で送る（あとから届いた）
  const r = env.sync(null, [['visits', 'v1', { extras: [{ id: 'x1', type: '追加', amount: 1000 }, { id: 'x2', type: '追加', amount: 500 }], total: 7500, name: '古い名前', updatedAt: '2026-11-05T19:30:00+09:00' }]]);
  const v = visitRow(env);
  assert.deepEqual([v.extras.length, v.extras.find(x => x.id === 'x1').del, v.total], [2, true, 6500]); // x1は消えたまま、x2は残る
  assert.notEqual(v.name, '古い名前'); // 古い操作の、ほかの項目は使わない
  assert.equal(plain(r).results[0].stale, true);
});

test('端末は、変えた項目だけをGASに送る。画面の消す操作は、印を付ける', async () => {
  const env = boot();
  const sent = [];
  const device = id => {
    const store = memoryStore();
    const post = async (action, body = {}) => {
      if (action === 'sync') sent.push(plain(body.ops));
      const r = env.post({ token: env.token, deviceId: id, ...body, action });
      if (r.status !== 'ok') throw new ApiError(r.code, r.message);
      return r;
    };
    return { store, post, sync: createSync({ store, post, getDeviceId: () => id, getMgrToken: () => null }) };
  };
  const A = device('tab'), B = device('phone');
  await A.sync.save('visits', 'v1', { bizDate: '2026-11-05', no: 1, people: 2, kind: '飲み放題', base: 6000, status: '店内', extras: [], pays: [], total: 6000, cash: 0, cashless: 0, point: 0 });
  await A.sync.flush();
  await B.sync.pull('visits', '2026-11-05', '2026-11-05'); // スマホが写しを持つ
  // タブレット：追加を足す → 送る
  const cur = await A.store.getRow('visits', 'v1');
  const extras = [...cur.extras, { id: 'x1', type: '追加', amount: 1000 }];
  await A.sync.save('visits', 'v1', { extras, total: total({ ...cur, extras }), ...methodSums(cur.pays) });
  await A.sync.flush();
  // 送ったのは、変えた項目（と、id・updatedAt・deviceId）だけ
  const last = sent[sent.length - 1][0];
  assert.deepEqual(Object.keys(last.data).sort(), ['cash', 'cashless', 'deviceId', 'extras', 'id', 'point', 'total', 'updatedAt']);
  assert.equal('status' in last.data || 'name' in last.data || 'people' in last.data, false);
  assert.equal(typeof last.at, 'string'); // 操作を保存した時刻も送る
  // スマホ（追加を知らない）：受け取って退店 → 追加は消えない
  const b = await B.store.getRow('visits', 'v1');
  const pays = [{ id: 'p1', method: '現金', amount: 6000 }];
  await B.sync.save('visits', 'v1', { pays, status: '退店', total: total({ ...b, pays }), ...methodSums(pays) });
  await B.sync.flush();
  assert.equal(visitRow(env).total, 7000);
  assert.equal((await B.store.getRow('visits', 'v1')).total, 7000); // スマホの写しも、合わせた結果に直った
  // 画面の消す操作：配列から外さず、印を付ける。合計・受け取りの計算は、印の付いたものを数えない
  const row = await B.store.getRow('visits', 'v1');
  const p2 = markAllDeleted(row.pays);
  assert.equal(paidTotal({ ...row, pays: p2 }), 0);
  assert.equal(livePays({ ...row, pays: p2 }).length, 0);
  assert.equal(total({ ...row, extras: markDeleted(row.extras, 'x1') }), 6000);
  assert.deepEqual(liveExtras({ extras: [{ id: 'a', amount: 1 }, { id: 'b', amount: 2, del: true }] }).map(x => x.id), ['a']);
});

// ===== 高2：遅れて届いた送信を、バイトでも断らない =====
test('送信が遅れて、翌営業日に届いても、操作を保存した時刻の営業日で判定する（バイト）', () => {
  const env = boot('2026-11-06T13:00:00+09:00'); // もう11/6の営業日（切り替えは12時）
  const visit = { bizDate: '2026-11-05', no: 1, people: 2, kind: '単品', status: '退店', base: 0, total: 0, cash: 0, cashless: 0, point: 0 };
  const code = r => plain(r).results[0].ok ? 'ok' : plain(r).results[0].code;
  assert.equal(code(env.sync(null, [['visits', 'a', visit]])), 'forbidden'); // 保存した時刻を知らない（古い版）→ これまでどおり断る
  assert.equal(code(env.sync(null, [['visits', 'b', visit, '2026-11-05T23:50:00+09:00']])), 'ok'); // 前日の夜に保存した操作
  assert.equal(code(env.sync(null, [['closings', '2026-11-05', { bizDate: '2026-11-05', countedCash: 1 }, '2026-11-06T01:10:00+09:00']])), 'ok'); // 閉店（0時を過ぎた）
  // 3日前の時刻・未来の時刻・形が違う時刻は信じない
  assert.equal(code(env.sync(null, [['visits', 'c', { ...visit, bizDate: '2026-11-02' }, '2026-11-02T20:00:00+09:00']])), 'forbidden');
  assert.equal(code(env.sync(null, [['visits', 'd', visit, '2030-01-01T00:00:00+09:00']])), 'forbidden');
  assert.equal(code(env.sync(null, [['visits', 'e', visit, 'きのう']])), 'forbidden');
});

test('店長の許可が切れて断られた分は、店長に戻ったとき、送り直せる（失敗の一覧に残る）', async () => {
  const env = boot();
  const mgrToken = env.login();
  env.call('logout', { mgrToken });
  const store = memoryStore();
  let tok = mgrToken;
  const post = async (action, body = {}) => {
    const r = env.post({ token: env.token, deviceId: 'tab', mgrToken: tok, ...body, action });
    if (r.status !== 'ok') throw new ApiError(r.code, r.message);
    return r;
  };
  const sync = createSync({ store, post, getDeviceId: () => 'tab', getMgrToken: () => tok });
  await sync.save('attendance', 'a1', { bizDate: '2026-11-04', name: '加奈', kind: '固定', hours: 5, cost: 10000, status: '有効' });
  await sync.flush();
  assert.equal((await store.failedList()).length, 1); // 許可が切れているので、断られて失敗の一覧へ
  tok = env.login(); // 店長に戻った
  await sync.retryFailed();
  assert.equal((await store.failedList()).length, 0);
  assert.equal(env.call('fetch', { table: 'attendance', mgrToken: tok }).rows.length, 1);
});

// ===== 高3：バイトに時給の初期値を返さない =====
test('バイトの端末には、時給の初期値も店長報酬も返さない。店長には返す', () => {
  const env = boot();
  const staff = env.call('bootstrap').settings;
  assert.equal('defaultWage' in staff, false);
  assert.equal('managerFee' in staff, false);
  const mgr = env.call('bootstrap', { mgrToken: env.login() }).settings;
  assert.deepEqual([mgr.defaultWage, mgr.managerFee], [1500, 180000]);
});

// ===== 中6：現金・キャッシュレス・ポイントは、イベントを除く（月次・月のタブ・突き合わせで同じ）=====
test('月次の現金・ポイントは、イベントを除いて数える（イベントは別に数える）', () => {
  const env = boot('2026-11-06T13:00:00+09:00');
  const mgrToken = env.login();
  env.sync(mgrToken, [
    ['visits', 'v1', { bizDate: '2026-11-05', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 10000, cash: 10000 }],
    ['visits', 'v2', { bizDate: '2026-11-05', no: 2, people: 8, kind: 'イベント', name: '会', status: '退店', total: 40000, cash: 20000, point: 20000 }],
    ['closings', '2026-11-05', { bizDate: '2026-11-05', countedCash: 1 }]
  ]);
  const m = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([m.sales, m.cash, m.point, m.event], [50000, 10000, 0, 40000]);
  // 月のタブも同じ
  const g = env.ss.getSheetByName('11月').getRange(1, 1, 33, 20).getValues();
  assert.deepEqual([g[5][10], g[5][11], g[5][12]], [10000, 40000, 0]); // 現金売上・団体売上・ポイント売上（11/5の行）
  // ポイントを売上に含めない設定でも、月次のイベントと月のタブの団体は同じ（ポイントを引く）
  env.call('saveSettings', { mgrToken, settings: { pointCountsAsSales: false } });
  env.gas.rebuildAppMonthTab_('2026-11');
  const m2 = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.equal(m2.event, 20000);
  assert.equal(env.ss.getSheetByName('11月').getRange(6, 12).getValue(), 20000);
});

// ===== 中7：カウンターの二重計上 =====
test('カウンター：予定に結びつけずに入店したイベントの実績は、その日の予定の見込みから引く', () => {
  const env = boot('2026-11-05T20:00:00+09:00');
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 1000000 } } });
  env.sync(mgrToken, [
    ['events', 'e1', { date: '2026-11-05', type: '団体', title: '歓迎会', expectedAmount: 100000, status: '有効' }],
    ['events', 'e2', { date: '2026-11-20', type: '団体', title: 'あとの会', expectedAmount: 50000, status: '有効' }],
    // 予定から選ばずに入店して退店した（名前も違う）
    ['visits', 'v1', { bizDate: '2026-11-05', no: 1, people: 5, kind: 'イベント', name: '飛び込み', status: '退店', total: 40000, cash: 40000 }]
  ]);
  const r = env.call('countdown', { month: '2026-11' });
  assert.deepEqual([r.confirmed, r.expected, r.remaining], [40000, 60000 + 50000, 1000000 - 40000 - 110000]); // 歓迎会の見込み10万円から、実績4万円を引く
  // 予定から選んで入店した場合・名前が同じ場合は、これまでどおり（その予定の見込みを外す）
  env.sync(mgrToken, [['visits', 'v2', { bizDate: '2026-11-05', no: 2, people: 5, kind: 'イベント', name: '歓迎会', eventId: 'e1', status: '退店', total: 90000, cash: 90000 }]]);
  const r2 = env.call('countdown', { month: '2026-11' });
  assert.deepEqual([r2.confirmed, r2.expected], [130000, 50000]);
});

// ===== 中8：スプシで打った予定が、書き戻しで消えない =====
const typeCells = (env, name, row, col, rows2d) => {
  const range = env.ss.getSheetByName(name).getRange(row, col, rows2d.length, rows2d[0].length);
  range.setValues(rows2d);
  env.gas.handleSheetEdit({ range });
};
const dayRow = (env, d) => env.call('fetch', { table: 'days' }).rows.find(r => r.bizDate === d);

test('スプシで打ったのに、編集のトリガーが間に合わなかったセルは、次の書き戻しの前にアプリへ取り込む', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  const sh = env.ss.getSheetByName('11月');
  sh.getRange(13, 3).setValue('加奈'); // 11/12：打ったが、トリガーが動かなかった（時間切れ）
  sh.getRange(13, 7).setValue('歓迎会');
  // アプリの別の日の予定が直される → 書き換えが走る
  env.sync(mgrToken, [['days', '2026-11-20', { bizDate: '2026-11-20', shiftPlan: '優輝' }]]);
  assert.equal(dayRow(env, '2026-11-12')?.shiftPlan, '加奈'); // アプリに入った
  assert.equal(sh.getRange(13, 3).getValue(), '加奈'); // セルも消えていない
  assert.deepEqual(env.call('fetch', { table: 'events' }).rows.filter(e => e.date === '2026-11-12').map(e => e.title), ['歓迎会']);
  assert.equal(sh.getRange(21, 3).getValue(), '優輝'); // 書き換えも効いている
  // 閉店（全部の書き換え）でも同じ
  sh.getRange(8, 3).setValue('岡本'); // 11/7：また、取り込まれなかった
  env.setNow('2026-11-02T22:00:00+09:00');
  env.sync(mgrToken, [['closings', '2026-11-02', { bizDate: '2026-11-02', countedCash: 1 }]]);
  assert.equal(dayRow(env, '2026-11-07')?.shiftPlan, '岡本');
  assert.equal(sh.getRange(8, 3).getValue(), '岡本');
});

test('スプシの編集は、端末の時計が進んでいても、アプリの古い記録に勝つ', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  // 時計が進んだ端末の記録（未来の更新時刻）
  env.sync(mgrToken, [['days', '2026-11-12', { bizDate: '2026-11-12', shiftPlan: '加奈', updatedAt: '2030-01-01T00:00:00+09:00' }]]);
  typeCells(env, '11月', 13, 3, [['岡本', '', '', '']]);
  const r = dayRow(env, '2026-11-12');
  assert.equal(r.shiftPlan, '岡本');
  assert.ok(Date.parse(r.updatedAt) > Date.parse('2030-01-01T00:00:00+09:00')); // 端末が新しい記録として受け取れる
});

test('見込みだけ先に打って足した仮の「イベント」は、名前を打ったら、その名前に変わる（金額が残る）', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  env.gas.createNextMonthTab_();
  typeCells(env, '11月', 13, 8, [[90000]]);
  assert.deepEqual(env.call('fetch', { table: 'events' }).rows.map(e => [e.title, e.expectedAmount, e.status]), [['イベント', 90000, '有効']]);
  typeCells(env, '11月', 13, 7, [['歓迎会']]);
  const ev = env.call('fetch', { table: 'events' }).rows;
  assert.deepEqual(ev.map(e => [e.title, e.expectedAmount, e.status]), [['歓迎会', 90000, '有効']]); // 削除して作り直さない
});

// ===== 中9：閉店のあとの訂正・仕入れ・勤怠・固定費が、月のタブに出る =====
test('月のタブ：閉店のあとに入れた仕入れ・勤怠・固定費や、閉店後の来客の訂正も、月のタブに出る（日付を送らない更新でも）', () => {
  const env = boot('2026-11-05T22:00:00+09:00');
  const mgrToken = env.login();
  env.sync(mgrToken, [
    ['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 }],
    ['closings', '2026-11-02', { bizDate: '2026-11-02', countedCash: 1 }]
  ]);
  const cell = (r, c) => env.ss.getSheetByName('11月').getRange(r, c).getValue();
  assert.equal(cell(3, 11), 6000); // 11/2の現金売上
  // 閉店のあとに、仕入れ・勤怠・固定費を入れる
  env.sync(mgrToken, [
    ['purchases', 'p1', { date: '2026-11-02', category: '飲食物', amount: 12345, status: '有効' }],
    ['attendance', 'a1', { bizDate: '2026-11-02', name: 'みか', kind: '手打ち', cost: 12000, status: '有効' }],
    ['fixedCosts', '2026-11|保険', { month: '2026-11', item: '保険', amount: 7000, status: '有効' }]
  ]);
  assert.deepEqual([cell(3, 14), cell(3, 10), cell(2, 19)], [12345, 12000, 7000]); // 食品支出・スタッフ・保険（1日の行）
  // 日付を送らない更新（消す）でも、その月だけ書き換わる
  env.sync(mgrToken, [['purchases', 'p1', { status: '削除' }]]);
  assert.equal(cell(3, 14), 0);
  // 閉店のあとの来客の訂正（日付を送らない）
  env.sync(mgrToken, [['visits', 'v1', { status: '削除' }]]);
  assert.equal(cell(3, 11), 0);
  // 閉店前の来客の変更では、書き換えない（閉店のときにまとめて書く）
  env.sync(mgrToken, [['visits', 'v9', { bizDate: '2026-11-05', no: 1, people: 2, kind: '単品', status: '退店', total: 500, cash: 500 }]]);
  assert.equal(cell(6, 11), 0);
});

// ===== 中12：予定の名前の「=」を数式にしない =====
test('月のタブのシフト・団体及びイベントの列は、書式なしテキスト（「=」で始まる名前が数式にならない）', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  const sh = env.ss.getSheetByName('11月');
  for (const [r, c] of [[2, 3], [32, 6], [2, 7], [20, 7]]) assert.equal(sh.formats.get(r + ':' + c), '@', r + ':' + c);
  assert.notEqual(sh.formats.get('2:8'), '@'); // 見込みは数字
  // ひな形のほうも
  assert.equal(env.ss.getSheetByName('シフト表のひな形').formats.get('2:7'), '@');
  env.sync(mgrToken, [['events', 'e1', { date: '2026-11-12', type: '団体', title: '=IMAGE("x")', expectedAmount: 1, status: '有効' }]]);
  assert.equal(sh.formats.get('13:7'), '@');
  assert.equal(sh.getRange(13, 7).getValue(), '=IMAGE("x")'); // 文字のまま（書式なしテキストなので、数式にならない）
});

// ===== 中14：初期値に金額を持たない =====
test('コードの初期値に、店長報酬・時給の金額はない（設定に入れるまで0）', () => {
  const env = loadGas(CODE);
  env.setNow('2026-11-05T20:00:00+09:00');
  env.gas.setup();
  const token = env.logs.join('\n').match(/共有トークン：(\w+)/)[1];
  const pin = env.logs.join('\n').match(/初期の暗証番号：(\d+)/)[1];
  const mgrToken = env.post({ token, action: 'login', pin }).mgrToken;
  const s = env.post({ token, action: 'bootstrap', mgrToken }).settings;
  assert.deepEqual([s.managerFee, s.defaultWage], [0, 0]);
  assert.equal(env.post({ token, action: 'monthly', mgrToken, month: '2026-11' }).summary.mgrFee, 0);
});
