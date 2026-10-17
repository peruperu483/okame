// 月の売上目標・減算カウンター・イベントの売上見込み（アプリとスプシの月のタブ）・シフト表のひな形
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

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
  const sync = (mgrToken, ops) => call('sync', { mgrToken, ops: ops.map(([table, id, data]) => ({ opId: 'o-' + id + Math.random(), table, id, data })) });
  return { ...env, token, pin, call, login, sync };
}
const plain = v => JSON.parse(JSON.stringify(v));
const cd = (env, month = '2026-11', body = {}) => env.call('countdown', { month, ...body });

test('減算カウンター：あと ＝ 目標 − 確定 − まだ来ていない日のイベントの見込み。閉店したら見込みが外れて実際の売上に入れ替わる', () => {
  const env = boot('2026-11-05T15:00:00+09:00'); // 11/5の昼：営業日は11/4（0:00〜11:59は前日扱い）
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 1000000 } } });
  env.sync(mgrToken, [
    ['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 4, kind: '飲み放題', status: '退店', total: 100000, cash: 100000 }],
    ['visits', 'v2', { bizDate: '2026-11-03', no: 1, people: 2, kind: '単品', status: '店内', total: 30000 }], // 店内：確定に入れない
    ['visits', 'v3', { bizDate: '2026-11-03', no: 2, people: 1, kind: '単品', status: '削除', total: 9999 }],
    ['events', 'e-past', { date: '2026-11-03', type: '団体', title: '終わった会', expectedAmount: 50000, status: '有効' }], // 閉店していない過去の日は数えない
    ['events', 'e1', { date: '2026-11-10', type: '団体', title: '日本酒の会', expectedAmount: 180000, status: '有効' }],
    ['events', 'e2', { date: '2026-11-20', type: '貸切', title: '貸切', expectedAmount: 70000, status: '有効' }],
    ['events', 'e3', { date: '2026-11-25', type: '団体', title: '消した会', expectedAmount: 99999, status: '削除' }],
    ['events', 'e4', { date: '2026-11-26', type: '団体', title: '見込みなし', status: '有効' }]
  ]);
  let r = cd(env);
  assert.deepEqual([r.hasTarget, r.target, r.confirmed, r.expected, r.remaining], [true, 1000000, 100000, 250000, 650000]);
  // 11/10のイベントが入店して退店した（まだ閉店していない）：実際の売上に入れ替わる。見込みは外れる
  env.sync(mgrToken, [['visits', 'v4', { bizDate: '2026-11-10', no: 1, people: 12, kind: 'イベント', name: '日本酒の会', eventId: 'e1', status: '退店', total: 200000, cash: 200000 }]]);
  env.setNow('2026-11-10T23:00:00+09:00');
  r = cd(env);
  assert.deepEqual([r.confirmed, r.expected, r.remaining], [300000, 70000, 630000]);
  // 11/20のイベント当日に、予定の見込みのまま閉店した：その日の見込みは外れる（実際の売上は0）
  env.sync(mgrToken, [['closings', '2026-11-20', { bizDate: '2026-11-20', countedCash: 1 }]]);
  r = cd(env);
  assert.deepEqual([r.confirmed, r.expected, r.remaining], [300000, 0, 700000]);
});

test('減算カウンター：月ごとの目標。ない月は設定の「月の売上」。目標を超えたらマイナス。管理シートの月は取り込んだ売上', () => {
  const env = boot('2026-11-05T20:00:00+09:00');
  const mgrToken = env.login();
  // 月ごとの目標がなければ、設定の月の売上（初期値100万円）
  assert.deepEqual([cd(env).target, cd(env, '2026-12').target], [1000000, 1000000]);
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 800000 } } });
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-12': 1500000 } } }); // 月ごとに足していける（前の月は消えない）
  assert.deepEqual([cd(env).target, cd(env, '2026-12').target], [800000, 1500000]);
  assert.deepEqual(plain(env.call('bootstrap').settings.monthlyTargets), { '2026-11': 800000, '2026-12': 1500000 });
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 0 } } }); // 0は「決めていない」
  assert.equal(cd(env).target, 1000000);
  // 超えたら、あとがマイナス
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 100000 } } });
  env.sync(mgrToken, [['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 4, kind: '飲み放題', status: '退店', total: 130000, cash: 130000 }]]);
  assert.equal(cd(env).remaining, -30000);
  // 目標が決まっていなければ hasTarget=false
  env.call('saveSettings', { mgrToken, settings: { targets: { monthlySales: 0 } } });
  assert.equal(cd(env, '2027-01').hasTarget, false); // 月ごとの目標もなければ
  // 管理シートの月（運用開始日より前）は、取り込んだ売上
  const sh = env.ss.insertSheet('過去の月次');
  sh.getRange(1, 1, 2, 2).setNumberFormats([['@', '@'], ['@', '@']]);
  sh.getRange(1, 1, 2, 2).setValues([['項目', '2026-10'], ['売上', 221900]]);
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-10': 1500000 } } });
  const o = cd(env, '2026-10');
  assert.deepEqual([o.target, o.confirmed, o.remaining], [1500000, 221900, 1278100]);
  // 月次（分析）の目標の進みも、月ごとの目標を使う
  assert.equal(env.call('monthly', { mgrToken, month: '2026-10' }).summary.target.monthlySales, 1500000);
});

test('減算カウンター：バイトにも見えるが、設定で見せない（GASが断る）。月の形が違えば断る', () => {
  const env = boot();
  const mgrToken = env.login();
  assert.equal(cd(env).status, 'ok'); // 店長でなくても見える
  assert.equal(cd(env, '2026年11月').code, 'bad_month');
  env.call('saveSettings', { mgrToken, settings: { visibility: { countdown: false } } });
  assert.equal(cd(env).code, 'forbidden');
  assert.equal(cd(env, '2026-11', { mgrToken }).status, 'ok'); // 店長は見える
  assert.equal(env.call('bootstrap').settings.visibility.eventContact, true); // ほかの項目は変わらない
});

test('運用開始日が月の途中のとき、確定した売上には、運用開始日より前の管理シートの売上も入る', async () => {
  const { makeSpreadsheet } = await import('./gas-mock.mjs');
  const env = boot('2026-10-14T20:00:00+09:00');
  const oct = [['10月', '列 1', '1', '2', '3', '3 2', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'],
    [2, '金', '岡本', '', '', '', '', 0, 0, 100000, 0, 5000, 0, 0, 0, 0, 0, 0]];
  env.gas.importLegacy_(makeSpreadsheet({ '9月': [['8月', '列 1']], '10月': oct }), '2026-10-14');
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { goLiveDate: '2026-10-11', monthlyTargets: { '2026-10': 500000 } } });
  env.sync(mgrToken, [['visits', 'v1', { bizDate: '2026-10-12', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 }]]);
  const r = cd(env, '2026-10');
  assert.deepEqual([r.confirmed, r.remaining], [105000 + 6000, 500000 - 111000]);
});

// ===== イベントの売上見込み（アプリ ⇄ スプシの月のタブの「見込み」の列）=====
const typeCells = (env, name, row, col, rows2d) => {
  const range = env.ss.getSheetByName(name).getRange(row, col, rows2d.length, rows2d[0].length);
  range.setValues(rows2d);
  env.gas.handleSheetEdit({ range });
};
const grid = (env, name) => env.ss.getSheetByName(name).getRange(1, 1, 33, 20).getValues();
const events = (env, date) => env.call('fetch', { table: 'events' }).rows.filter(e => e.date === date && e.status !== '削除');

test('見込み：アプリの予定の見込みの金額が、月のタブの団体及びイベントの横に出る（予定が複数なら合計）', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  assert.deepEqual(grid(env, '11月')[0].slice(6, 9), ['団体及びイベント', '見込み', '加奈']); // 見込みの列は、団体及びイベントの隣。金額の列は1つ右へ
  env.sync(mgrToken, [
    ['events', 'e1', { date: '2026-11-12', type: '団体', title: '歓迎会', expectedAmount: 180000, status: '有効' }],
    ['events', 'e2', { date: '2026-11-12', type: '貸切', title: '貸切', expectedAmount: 70000, status: '有効' }],
    ['events', 'e3', { date: '2026-11-13', type: '団体', title: '見込みなし', status: '有効' }]
  ]);
  const g = grid(env, '11月');
  assert.deepEqual([g[12][6], g[12][7]], ['歓迎会、貸切', 250000]);
  assert.deepEqual([g[13][6], g[13][7]], ['見込みなし', '']);
  assert.equal(g[32][7], '=SUM(H2:H32)'); // 見込みの合計
  // 金額を直す・消すと、月のタブも変わる
  env.sync(mgrToken, [['events', 'e1', { expectedAmount: 200000 }], ['events', 'e2', { status: '削除' }]]);
  assert.equal(grid(env, '11月')[12][7], 200000);
});

test('見込み：スプシで打った見込みが、アプリの予定の見込みの金額に入る（ない日は「イベント」を足す。0で空に）', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  env.gas.createNextMonthTab_();
  // 予定が1つの日：その予定に入る
  typeCells(env, '11月', 14, 7, [['歓迎会', 180000]]); // 11/13：団体及びイベントと見込みを同時に（貼り付け）
  let ev = events(env, '2026-11-13');
  assert.deepEqual(ev.map(e => [e.title, e.expectedAmount]), [['歓迎会', 180000]]);
  typeCells(env, '11月', 14, 8, [[200000]]);
  assert.equal(events(env, '2026-11-13')[0].expectedAmount, 200000);
  // 予定が複数の日：先頭の予定に合わせる
  typeCells(env, '11月', 15, 7, [['A会、B会']]); // 11/14
  typeCells(env, '11月', 15, 8, [[300000]]);
  env.sync(mgrToken, [['events', events(env, '2026-11-14')[1].id, { expectedAmount: 100000 }]]); // B会に10万円
  typeCells(env, '11月', 15, 8, [[250000]]); // 合計25万円 → A会は15万円
  assert.deepEqual(events(env, '2026-11-14').map(e => [e.title, e.expectedAmount]), [['A会', 150000], ['B会', 100000]]);
  // 予定がない日：イベントを足す
  typeCells(env, '11月', 17, 8, [[90000]]); // 11/16
  ev = events(env, '2026-11-16');
  assert.deepEqual(ev.map(e => [e.title, e.type, e.expectedAmount]), [['イベント', '団体', 90000]]);
  // 0・空にすると、見込みが空になる（予定は残る）
  typeCells(env, '11月', 14, 8, [['']]);
  assert.deepEqual(events(env, '2026-11-13').map(e => [e.title, e.expectedAmount]), [['歓迎会', null]]);
  // 負の数・文字は0として扱う
  typeCells(env, '11月', 17, 8, [['たくさん']]);
  assert.equal(events(env, '2026-11-16')[0].expectedAmount, null);
  // 打ったあとのタブをアプリの記録から作り直しても、同じ内容
  typeCells(env, '11月', 14, 8, [[200000]]);
  env.gas.rebuildAppMonthTab_('2026-11');
  const g = grid(env, '11月');
  assert.deepEqual([g[13][6], g[13][7], g[14][6], g[14][7]], ['歓迎会', 200000, 'A会、B会', 250000]);
});

// ===== シフト表のひな形（プルダウンの色を手で付ける）=====
test('シフト表のひな形：隠してあり、最初に1回だけ作る。月のタブはそこからコピーし、あとから色を付けても月のタブに写せる', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  env.gas.createNextMonthTab_();
  const tpl = env.ss.getSheetByName('シフト表のひな形');
  assert.ok(tpl && tpl.hidden && tpl.protection);
  assert.equal(env.sheets.filter(s => s.name === 'シフト表のひな形').length, 1);
  // 林が、ひな形のプルダウンに色を付けた（ここでは、規則の中身を変えて代わりにする）
  const colored = { list: ['店休日', '岡本', '加奈'], dropdown: true, allowInvalid: true, colors: { '店休日': 'red' } };
  tpl.validations.set('2:3', colored);
  // ひな形はGASが書き換えない：来月のタブを作り直しても、取り込みをしても、そのまま
  env.gas.createNextMonthTab_();
  assert.equal(env.ss.getSheetByName('シフト表のひな形'), tpl);
  assert.equal(tpl.validations.get('2:3'), colored);
  // メニュー：今ある月のタブにも色を写す。月のタブの値は変わらない
  env.ss.getSheetByName('11月').getRange(3, 3).setValue('岡本');
  env.gas.syncPlanColors();
  assert.equal(env.ss.getSheetByName('11月').validations.get('2:3'), colored);
  assert.equal(env.ss.getSheetByName('11月').getRange(3, 3).getValue(), '岡本');
  // 月のタブを作り直すたびに、ひな形の色が写る（来月のタブも同じ色になる）
  env.setNow('2026-11-20T10:00:00+09:00');
  env.gas.createNextMonthTab_(); // 12月
  assert.equal(env.ss.getSheetByName('12月').validations.get('2:3'), colored);
});

test('古い形の月のタブ（見込みの列がない）は、作り直す。スプシの編集は、作り直すまで何もしない', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  env.gas.createNextMonthTab_();
  const sh = env.ss.getSheetByName('11月');
  sh.getRange(1, 8).setValue('加奈'); // 古い形のまね
  typeCells(env, '11月', 6, 3, [['岡本', '', '', '']]);
  assert.equal(env.call('fetch', { table: 'days' }).rows.length, 0); // 何も入らない
  env.gas.createNextMonthTab_();
  assert.equal(env.sheets.filter(s => s.name === '11月').length, 1);
  assert.equal(env.ss.getSheetByName('11月').getRange(1, 8).getValue(), '見込み');
  typeCells(env, '11月', 6, 3, [['岡本', '', '', '']]);
  assert.equal(env.call('fetch', { table: 'days' }).rows.length, 1);
});

test('月のタブで選べるシフトの選択肢は、設定（shiftColumnChoices）で変えられる', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  const mgrToken = env.login();
  assert.deepEqual(plain(env.call('bootstrap').settings.shiftColumnChoices), [['店休日', '岡本', '加奈'], ['加奈', '優輝'], ['優輝']]);
  env.call('saveSettings', { mgrToken, settings: { shiftColumnChoices: [['店休日', '岡本'], ['加奈'], ['優輝', 'みか']] } });
  env.gas.createNextMonthTab_();
  const tpl = env.ss.getSheetByName('シフト表のひな形');
  assert.deepEqual([plain(tpl.validations.get('2:3').list), plain(tpl.validations.get('2:5').list)], [['店休日', '岡本'], ['優輝', 'みか']]);
});

test('月次（分析）：目標までの材料として、まだ来ていない日のイベントの見込みが付く。バイトに見せる設定とは関係ない', () => {
  const env = boot('2026-11-05T20:00:00+09:00');
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { monthlyTargets: { '2026-11': 1000000 }, visibility: { countdown: false } } });
  env.sync(mgrToken, [
    ['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 4, kind: '飲み放題', status: '退店', total: 400000, cash: 400000 }],
    ['events', 'e1', { date: '2026-11-10', type: '団体', title: '日本酒の会', expectedAmount: 180000, status: '有効' }],
    ['events', 'e2', { date: '2026-11-03', type: '団体', title: '過ぎた会', expectedAmount: 50000, status: '有効' }]
  ]);
  const m = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([m.sales, m.target.monthlySales, m.pendingExpected], [400000, 1000000, 180000]);
  assert.equal(m.target.monthlySales - m.sales - m.pendingExpected, 420000); // 見込みを入れた「あと」
  assert.equal(cd(env).code, 'forbidden'); // バイトの減算カウンターは見せない設定でも、月次には出る
  // 見込みがない月
  assert.equal(env.call('monthly', { mgrToken, month: '2026-12' }).summary.pendingExpected, 0);
});

test('古い形のタブを作り直しても、タブの並び（11月（アプリ）・11月（手打ち））が崩れない', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  env.gas.createNextMonthTab_();
  env.gas.createHandTab_('2026-11');
  env.ss.getSheetByName('11月（アプリ）').getRange(1, 8).setValue('加奈'); // 古い形のまね
  env.gas.createNextMonthTab_(); // 作り直す
  const names = env.sheets.map(s => s.name).filter(n => n.startsWith('11月'));
  assert.deepEqual(names, ['11月（アプリ）', '11月（手打ち）']);
});

test('月次：常連の組数・人数・売上を別に出す（売上は支払い方法の中にも入る）', () => {
  const env = boot('2026-11-05T20:00:00+09:00');
  const mgrToken = env.login();
  env.sync(mgrToken, [
    ['visits', 'r1', { bizDate: '2026-11-02', no: 1, people: 3, kind: '常連', status: '退店', unitPrice: 2000, base: 6000, total: 6800, cash: 6800 }],
    ['visits', 'r2', { bizDate: '2026-11-03', no: 1, people: 2, kind: '常連', status: '退店', unitPrice: 1500, base: 3000, total: 3000, cashless: 3000 }],
    ['visits', 'n1', { bizDate: '2026-11-03', no: 2, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 }]
  ]);
  const s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([s.regular, s.regularGroups, s.regularGuests, s.nomi, s.sales, s.cash, s.cashless], [9800, 2, 5, 6000, 15800, 12800, 3000]);
  assert.deepEqual(env.call('bootstrap').settings.regularPrices, [1500, 2000, 2500]);
});
