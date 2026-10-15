// 月のタブをシフト表として使う：来月のタブ・スプシで打った予定をアプリに入れる・アプリの予定を月のタブに出す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now = '2026-10-20T10:00:00+09:00') {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  const login = () => call('login', { pin }).mgrToken;
  return { ...env, token, pin, call, login };
}
const plain = v => JSON.parse(JSON.stringify(v));
const grid = (env, name) => env.ss.getSheetByName(name).getRange(1, 1, 33, 20).getValues();
// スプシで打つ：値を入れてから、編集のトリガーを呼ぶ（本物は、打った範囲の e.range が渡る）
function typeCells(env, name, row, col, rows2d) {
  const sh = env.ss.getSheetByName(name);
  const range = sh.getRange(row, col, rows2d.length, rows2d[0].length);
  range.setValues(rows2d);
  env.gas.handleSheetEdit({ range });
}

test('初期設定で自動の動き（トリガー）ができ、何度実行しても1つずつ', () => {
  const env = boot();
  const fns = () => env.triggers.map(t => t.fn).sort();
  assert.deepEqual(fns(), ['createNextMonthTabAuto', 'handleSheetEdit']);
  const time = env.triggers.find(t => t.fn === 'createNextMonthTabAuto');
  assert.deepEqual([time.kind, time.day, time.hour, time.tz], ['time', 20, 9, 'Asia/Tokyo']);
  assert.equal(env.triggers.find(t => t.fn === 'handleSheetEdit').event, 'edit');
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  assert.deepEqual(fns(), ['createNextMonthTabAuto', 'handleSheetEdit']);
});

test('来月のタブ：日付・曜日・シフトの予定・ラスト・店休日・予定のイベントの名前が入り、金額は空', () => {
  const env = boot();
  const mgrToken = env.login();
  const sync = (table, id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id, table, id, data }] });
  sync('staff', 's1', { name: '加奈', wage: 2000, active: true });
  sync('days', '2026-11-03', { bizDate: '2026-11-03', shiftPlan: '加奈、岡本', lastPlan: '加奈' });
  sync('days', '2026-11-04', { bizDate: '2026-11-04', closed: true });
  sync('events', 'e1', { date: '2026-11-03', type: '団体', title: '日本酒の会', status: '有効' });
  // 20日：来月（11月）のタブを作る
  assert.equal(env.gas.createNextMonthTab_(), '11月');
  assert.equal(env.sheets.filter(s => s.name === '11月').length, 1);
  const g = grid(env, '11月');
  assert.deepEqual(g[0].slice(0, 2), ['11月', '列 1']);
  assert.equal(g[0][19], 'ラスト');
  assert.equal(g[0][7], '見込み');
  assert.deepEqual(g[1].slice(0, 2), [1, '日']); // 11/1（日曜）
  assert.deepEqual(g[3].slice(0, 7), [3, '火', '岡本', '加奈', '', '', '日本酒の会']); // 店長が先
  assert.equal(g[3][19], '加奈'); // ラスト
  assert.deepEqual(g[4].slice(0, 3), [4, '水', '店休日']);
  assert.equal(g[3][7], ''); // 金額の列は空
  assert.deepEqual(g[3].slice(7, 19), new Array(12).fill('')); // 見込み・金額の列
  assert.deepEqual(g[2].slice(7, 19), new Array(12).fill(''));
  assert.equal(g[32][0], '合計');
  // タブの並び
  // 2回作っても1つ（中身だけ書き換える）
  const same = env.ss.getSheetByName('11月');
  env.gas.createNextMonthTab_();
  assert.equal(env.ss.getSheetByName('11月'), same);
});

test('来月のタブ：運用開始日より前の月・管理シートの月は作らない', () => {
  const env = boot('2026-09-20T10:00:00+09:00'); // 来月は10月（管理シートの月）
  assert.equal(env.gas.createNextMonthTab_(), null);
  assert.ok(!env.sheets.some(s => s.name === '10月'));
  const env2 = boot('2026-08-20T10:00:00+09:00'); // 来月は9月
  assert.equal(env2.gas.createNextMonthTab_(), null);
});

test('打てる範囲：シフト・団体及びイベント・ラストだけ保護を外し、金額と合計は保護のまま。プルダウンにスタッフの名前と店休日', () => {
  const env = boot();
  const mgrToken = env.login();
  env.call('sync', { mgrToken, ops: [{ opId: 's', table: 'staff', id: 's1', data: { name: '加奈', wage: 2000, active: true } },
    { opId: 's2', table: 'staff', id: 's2', data: { name: '辞めた人', wage: 2000, active: false } }] });
  env.gas.createNextMonthTab_();
  const sh = env.ss.getSheetByName('11月');
  assert.ok(sh.protection);
  const un = sh.protection.getUnprotectedRanges().map(r => [r.r, r.c, r.nr, r.nc]);
  assert.deepEqual(plain(un), [[2, 3, 31, 6], [2, 20, 31, 1]]); // C〜H（シフト・団体及びイベント・見込み）と T（ラスト）。2〜32行目
  // 金額の列（H〜R）と合計の行は、打てる範囲に入っていない
  assert.ok(un.every(([r, c, nr, nc]) => !(c <= 9 && c + nc - 1 >= 9) && r + nr - 1 < 33)); // 加奈の列（I）などの金額と、合計の行は入らない
  // プルダウン：列2・3・4は設定どおり、列5は店長とスタッフと店休日、ラストは店長とスタッフ（在籍していない人は出ない）
  const list = k => plain(env.ss.getSheetByName('シフト表のひな形').validations.get(k).list);
  assert.deepEqual([list('2:3'), list('2:4'), list('2:5')], [['店休日', '岡本', '加奈'], ['加奈', '優輝'], ['優輝']]);
  assert.deepEqual(list('2:6'), ['岡本', '加奈', '店休日']);
  assert.deepEqual(list('2:20'), ['岡本', '加奈']);
  assert.equal(env.ss.getSheetByName('シフト表のひな形').validations.get('2:3').dropdown, true);
  // 月のタブにも写っていて、条件つき書式の背景色は使わない
  assert.deepEqual(plain(sh.validations.get('2:3').list), ['店休日', '岡本', '加奈']);
  assert.equal(sh.condRules.length, 0);
});

test('スプシで打ったシフト・店休日・ラスト・イベントが、アプリの予定に入る', () => {
  const env = boot();
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  // 11/5：シフト（岡本・加奈）。C=岡本 D=加奈
  typeCells(env, '11月', 6, 3, [['岡本', '加奈', '', '']]);
  // ラスト
  typeCells(env, '11月', 6, 20, [['加奈']]);
  // 団体及びイベント
  typeCells(env, '11月', 6, 7, [['日本酒の会、貸切']]);
  // 11/6：店休日
  typeCells(env, '11月', 7, 3, [['店休日', '', '', '']]);
  const days = env.call('fetch', { table: 'days' }).rows;
  const d5 = days.find(r => r.bizDate === '2026-11-05'), d6 = days.find(r => r.bizDate === '2026-11-06');
  assert.deepEqual([d5.shiftPlan, d5.lastPlan, d5.closed], ['岡本、加奈', '加奈', false]);
  assert.deepEqual([d6.closed, d6.shiftPlan], [true, '']);
  assert.ok(d5.updatedAt); // アプリが新しい内容として取り込める
  const events = env.call('fetch', { table: 'events' }).rows.filter(e => e.date === '2026-11-05');
  assert.deepEqual(events.map(e => [e.title, e.type, e.status]).sort(), [['日本酒の会', '団体', '有効'], ['貸切', '団体', '有効']]);
  assert.ok(events.every(e => e.people == null && e.expectedAmount == null && !e.startTime));
  // 操作履歴に残る
  assert.ok(env.call('fetch', { table: 'log', mgrToken }).rows.some(r => r.type === 'スプシから予定を直す' && r.by === 'スプシ'));
  // 名前を消すと、その予定は削除になる（同じ名前はそのまま）
  typeCells(env, '11月', 6, 7, [['日本酒の会']]);
  const after = env.call('fetch', { table: 'events' }).rows.filter(e => e.date === '2026-11-05');
  assert.deepEqual(after.map(e => [e.title, e.status]).sort(), [['日本酒の会', '有効'], ['貸切', '削除']]);
  // 店休日をやめる（シフトを入れ直す）と、店休日ではなくなる
  typeCells(env, '11月', 7, 3, [['岡本', '', '', '']]);
  const d6b = env.call('fetch', { table: 'days' }).rows.find(r => r.bizDate === '2026-11-06');
  assert.deepEqual([d6b.closed, d6b.shiftPlan], [false, '岡本']);
  // 同じ内容を何度打っても、予定は増えない
  typeCells(env, '11月', 6, 7, [['日本酒の会']]);
  assert.equal(env.call('fetch', { table: 'events' }).rows.filter(e => e.date === '2026-11-05' && e.status !== '削除').length, 1);
});

test('スプシの編集：複数の行をまとめて貼っても、打っていない列は触らない。ほかのタブ・金額の列は無視', () => {
  const env = boot();
  env.gas.createNextMonthTab_();
  env.call('sync', { mgrToken: env.login(), ops: [{ opId: 'p', table: 'days', id: '2026-11-02', data: { bizDate: '2026-11-02', shiftPlan: '加奈', lastPlan: '加奈' } }] });
  typeCells(env, '11月', 3, 3, [['岡本', '', '', ''], ['岡本', '加奈', '', '']]); // 11/2と11/3のシフト
  const days = env.call('fetch', { table: 'days' }).rows;
  const d2 = days.find(r => r.bizDate === '2026-11-02');
  assert.deepEqual([d2.shiftPlan, d2.lastPlan], ['岡本', '加奈']); // ラストは触らない
  assert.equal(days.find(r => r.bizDate === '2026-11-03').shiftPlan, '岡本、加奈');
  // 金額の列・ほかのタブの編集は、アプリに何も入れない
  const before = env.call('fetch', { table: 'days' }).rows.length;
  typeCells(env, '11月', 3, 10, [[12345]]);
  env.ss.insertSheet('設定メモ');
  typeCells(env, '設定メモ', 3, 3, [['岡本']]);
  assert.equal(env.call('fetch', { table: 'days' }).rows.length, before);
  // 打った範囲が月の日数を超える行（31日の月の32行目など）は無視する
  typeCells(env, '11月', 32, 3, [['岡本', '', '', '']]); // 11月は30日まで
  assert.ok(!env.call('fetch', { table: 'days' }).rows.some(r => r.bizDate === '2026-11-31'));
});

test('アプリの予定を直すと、月のタブにも出る（どちらから直しても同じ）', () => {
  const env = boot();
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  const sync = (table, id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id + Math.random(), table, id, data }] });
  // アプリで：シフト・ラスト・店休日・イベント
  sync('days', '2026-11-10', { bizDate: '2026-11-10', shiftPlan: '岡本、加奈', lastPlan: '岡本' });
  sync('days', '2026-11-11', { bizDate: '2026-11-11', closed: true });
  sync('events', 'e1', { date: '2026-11-12', type: '団体', title: '歓迎会', status: '有効' });
  let g = grid(env, '11月');
  assert.deepEqual(g[10].slice(2, 8), ['岡本', '加奈', '', '', '', '']);
  assert.equal(g[10][19], '岡本');
  assert.equal(g[11][2], '店休日');
  assert.equal(g[12][6], '歓迎会');
  // 金額の列は、予定を直しても触らない
  env.ss.getSheetByName('11月').getRange(10, 11).setValue(777);
  sync('days', '2026-11-10', { bizDate: '2026-11-10', shiftPlan: '加奈' });
  g = grid(env, '11月');
  assert.deepEqual(g[10].slice(2, 6), ['加奈', '', '', '']);
  assert.equal(g[9][10], 777);
  // イベントを消す・日付を直す
  sync('events', 'e1', { status: '削除' });
  assert.equal(grid(env, '11月')[12][6], '');
  // スプシで打った内容も、アプリの記録を通して同じ形に戻る
  typeCells(env, '11月', 14, 3, [['岡本', '', '', '']]);
  sync('days', '2026-11-20', { bizDate: '2026-11-20', shiftPlan: '加奈' }); // 別の日を直す → タブ全体が書き換わる
  assert.equal(grid(env, '11月')[13][2], '岡本');
});

test('シフトとラストは実績があれば実績。予定のイベントと実際のイベントの組は、名前を1つにまとめる', () => {
  const env = boot('2026-11-05T22:00:00+09:00');
  const mgrToken = env.login();
  const sync = ops => env.call('sync', { mgrToken, ops: ops.map(([table, id, data]) => ({ opId: 'o-' + id, table, id, data })) });
  sync([
    ['days', '2026-11-02', { bizDate: '2026-11-02', shiftPlan: '岡本、加奈', lastPlan: '加奈' }],
    ['events', 'ev1', { date: '2026-11-02', type: '団体', title: 'ユーワード懇親会', status: '有効' }],
    ['events', 'ev2', { date: '2026-11-02', type: '貸切', title: '貸切', status: '有効' }]
  ]);
  // 閉店：実績のシフトとラスト。予定のイベントの組（eventId）と、予定にない当日のイベントの組
  sync([
    ['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 10, kind: 'イベント', name: '懇親会（実際）', eventId: 'ev1', status: '退店', total: 40000, cash: 40000 }],
    ['visits', 'v2', { bizDate: '2026-11-02', no: 2, people: 4, kind: 'イベント', name: '飛び込みの会', status: '退店', total: 10000, cash: 10000 }],
    ['visits', 'v3', { bizDate: '2026-11-02', no: 3, people: 2, kind: 'イベント', name: '貸切', status: '退店', total: 5000, cash: 5000 }], // 予定と同じ名前（eventIdなし）
    ['days', '2026-11-02', { bizDate: '2026-11-02', shiftActual: '岡本、加奈、みか', lastActual: '岡本' }],
    ['closings', '2026-11-02', { bizDate: '2026-11-02', countedCash: 1 }]
  ]);
  const g = grid(env, '11月');
  assert.deepEqual(g[2].slice(2, 6), ['岡本', '加奈', 'みか', '']); // 実績
  assert.equal(g[2][19], '岡本'); // ラストの実績
  assert.equal(g[2][6], 'ユーワード懇親会、貸切、飛び込みの会'); // 予定の名前に1つにまとめる
  assert.equal(g[2][11], 55000); // 団体売上（金額は閉店で入る）
  // 実績がなければ予定
  env.call('sync', { mgrToken, ops: [{ opId: 'x', table: 'days', id: '2026-11-03', data: { bizDate: '2026-11-03', shiftPlan: '加奈', lastPlan: '加奈' } }] });
  assert.deepEqual(grid(env, '11月')[3].slice(2, 6), ['加奈', '', '', '']);
});

test('9月・10月（管理シートから取り込んだ月）は、これまでどおり全部保護で、ラストの列もない', async () => {
  const { makeSpreadsheet } = await import('./gas-mock.mjs');
  const env = boot('2026-10-14T20:00:00+09:00');
  const head = ['8月', '列 1', '列 2', '列 3', '列 ４', '列 ', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', 'ポイント\n売上', '食品\n支出', 'その他\n支出', 'キャッシュ\nレス\n売上', '家賃', 'ガス\n電気\nカラオケ'];
  const sep = [head, [1, '火', '加奈', '', '', '', '', 12000, 0, 8000, 0, 0, 0, 0, 0, 200000, 30000]];
  const oct = [['10月', '列 1', '1', '2', '3', '3 2', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'],
    [1, '木', '岡本', '', '', '', '', 0, 0, 0, 0, 0, 0, 500, 100, 250000, 30000, 8000]];
  env.gas.importLegacy_(makeSpreadsheet({ '9月': sep, '10月': oct }), '2026-10-14');
  for (const n of ['9月', '10月']) {
    const sh = env.ss.getSheetByName(n);
    assert.deepEqual(sh.protection.getUnprotectedRanges(), [], n);
    assert.notEqual(sh.getRange(1, 19).getValue(), 'ラスト', n);
    assert.equal(sh.validations.size, 0, n);
  }
  // 取り込んだあとに来月のタブを作っても、9月・10月は変わらない
  env.gas.createNextMonthTab_();
  assert.deepEqual(env.sheets.map(s => s.name).slice(0, 3), ['9月', '10月', '11月']);
  assert.equal(env.ss.getSheetByName('10月').getRange(2, 16).getValue(), 250000);
});

test('店長の名前は設定で変えられ、列5のプルダウンの先頭に出る', () => {
  const env = boot();
  const mgrToken = env.login();
  assert.equal(env.call('bootstrap').settings.managerName, '岡本'); // バイトにも見える（名前は秘密ではない）
  env.call('saveSettings', { mgrToken, settings: { managerName: '店長さん' } });
  env.gas.createNextMonthTab_();
  assert.deepEqual(plain(env.ss.getSheetByName('11月').validations.get('2:6').list), ['店長さん', '店休日']); // 列5
});
