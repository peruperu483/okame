// 11月以降の月のタブ（アプリの記録から）と、店長報酬
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now) {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  const login = () => call('login', { pin }).mgrToken;
  return { ...env, token, pin, call, login };
}
const plain = v => JSON.parse(JSON.stringify(v));

test('店長報酬：設定（初期値20万円）を支出に入れ、差し引きは1本。バイトには設定を返さない', () => {
  const env = boot('2026-11-30T20:00:00+09:00');
  // バイト（店長モードでない）には、店長報酬を返さない
  assert.equal('managerFee' in env.call('bootstrap').settings, false);
  const mgrToken = env.login();
  assert.equal(env.call('bootstrap', { mgrToken }).settings.managerFee, 200000);
  const s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([s.mgrFee, s.expenses, s.profit], [200000, 200000, -200000]);
  // 設定から変えられる（店長だけ）
  assert.equal(env.call('saveSettings', { settings: { managerFee: 1 } }).code, 'need_mgr');
  const saved = env.call('saveSettings', { mgrToken, settings: { managerFee: 250000 } });
  assert.equal(saved.settings.managerFee, 250000);
  assert.equal(env.call('monthly', { mgrToken, month: '2026-11' }).summary.profit, -250000);
  assert.equal('managerFee' in env.call('bootstrap').settings, false);
  assert.equal(env.call('saveSettings', { mgrToken, settings: { managerFee: 'たくさん' } }).code, 'bad_setting');
});

test('店長報酬：過去の月次（9月・10月）にも同じく引いて計算する。月次タブは同じ並び', () => {
  const env = boot('2026-11-30T20:00:00+09:00');
  const mgrToken = env.login();
  const sh = env.ss.insertSheet('過去の月次');
  sh.getRange(1, 1, 6, 3).setNumberFormats(Array.from({ length: 6 }, () => ['@', '@', '@']));
  sh.getRange(1, 1, 6, 3).setValues([
    ['項目', '2026-09', '2026-10'], ['売上', 927750, 900000], ['飲食物', 158478, 100000], ['固定費：家賃電気', 220000, 220000],
    ['人件費（加奈）', 100000, 90000], ['人件費（その他）', 69000, 10000]
  ]);
  const s9 = env.call('monthly', { mgrToken, month: '2026-09' }).summary;
  assert.deepEqual([s9.legacy, s9.mgrFee, s9.expenses, s9.profit], [true, 200000, 158478 + 220000 + 169000 + 200000, 927750 - 747478]);
  env.call('buildMonthlySheet', { mgrToken });
  const m = env.ss.getSheetByName('月次');
  const vals = m.getRange(1, 1, m.getLastRow(), m.getLastColumn()).getValues();
  const labels = vals.map(r => r[0]);
  assert.ok(labels.indexOf('店長報酬') > labels.indexOf('人件費') && labels.indexOf('店長報酬') < labels.indexOf('支出'));
  assert.equal(labels[labels.indexOf('支出') + 1], '差し引き');
  assert.equal(vals[labels.indexOf('差し引き')][1], 927750 - 747478);
  assert.equal(vals[labels.indexOf('店長報酬')][1], 200000);
});

test('11月以降の月のタブ：閉店のたびに、その月のタブだけを作り直す', () => {
  const env = boot('2026-11-05T22:00:00+09:00');
  const mgrToken = env.login();
  const sync = ops => env.call('sync', { mgrToken, ops: ops.map(([table, id, data]) => ({ opId: 'o-' + id, table, id, data })) });
  // 11/02：通常の会計・イベント・仕入れ・勤怠。閉店（レジ締め）→ タブができる
  sync([
    ['visits', 'v1', { bizDate: '2026-11-02', no: 1, people: 3, kind: '飲み放題', status: '退店', total: 9000, cash: 7000, cashless: 2000 }],
    ['visits', 'v2', { bizDate: '2026-11-02', no: 2, people: 10, kind: 'イベント', name: '日本酒の会', status: '退店', total: 40000, cash: 40000 }],
    ['visits', 'v3', { bizDate: '2026-11-02', no: 3, people: 1, kind: '単品', status: '店内', total: 0 }], // 店内：数えない
    ['purchases', 'p1', { date: '2026-11-02', category: '飲食物', amount: 5000, status: '有効' }],
    ['purchases', 'p2', { date: '2026-11-02', category: '備品', amount: 700, status: '有効' }],
    ['attendance', 'a1', { bizDate: '2026-11-02', name: '加奈', kind: '固定', hours: 5, cost: 10000, status: '有効' }],
    ['attendance', 'a2', { bizDate: '2026-11-02', name: 'みか', kind: '手打ち', cost: 8000, status: '有効' }],
    ['days', '2026-11-02', { bizDate: '2026-11-02', shiftActual: '加奈、岡本' }],
    ['days', '2026-11-04', { bizDate: '2026-11-04', closed: true }],
    ['fixedCosts', '2026-11|家賃電気', { month: '2026-11', item: '家賃電気', amount: 220000 }],
    ['closings', '2026-11-02', { bizDate: '2026-11-02', countedCash: 50000 }]
  ]);
  const names = env.sheets.map(s => s.name);
  assert.equal(names.filter(n => n === '11月').length, 1);
  assert.ok(env.ss.getSheetByName('月のひな形').hidden);
  const sh = env.ss.getSheetByName('11月');
  const grid = () => sh.getRange(1, 1, 33, 20).getValues();
  let g = grid();
  assert.equal(g[0][0], '11月');
  assert.deepEqual(g[1].slice(0, 2), [1, '日']); // 11/1（日曜）：記録はないが、運用開始日以降の今日までの行は0円で出る
  assert.equal(g[1][16], 220000); // 固定費は月の1日の行
  const d2 = g[2];
  assert.deepEqual(d2.slice(0, 7), [2, '月', '岡本', '加奈', '', '', '日本酒の会']); // シフトは岡本が先
  assert.deepEqual(d2.slice(8, 16), [10000, 8000, 7000, 40000, 0, 5000, 700, 2000]); // 加奈・スタッフ・現金・団体・ポイント・食品・その他・キャッシュレス
  assert.equal(g[4][2], '店休日');
  assert.deepEqual(g[5].slice(2, 16), ['', '', '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0]); // 見込みの列は空 // 5日：今日（営業日）までは0円
  assert.deepEqual(g[6].slice(2, 16), new Array(14).fill('')); // 6日：先の日は日付と曜日だけ

  // もう1日閉店 → 同じタブの中身が書き換わる（タブは増えない・作り直さない）
  env.setNow('2026-11-06T22:00:00+09:00');
  const same = sh;
  sync([
    ['visits', 'v4', { bizDate: '2026-11-05', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 }],
    ['closings', '2026-11-05', { bizDate: '2026-11-05', countedCash: 56000 }]
  ]);
  assert.equal(env.sheets.filter(s => s.name === '11月').length, 1);
  assert.equal(env.ss.getSheetByName('11月'), same);
  g = grid();
  assert.equal(g[5][10], 6000);
  assert.equal(g[2][10], 7000);
  assert.equal(g[32][8], '=SUM(I2:I32)'); // 合計の式は残る

  // 月のタブの並び：9月・10月の取り込みがなくても、突き合わせより前に11月が来る
  env.gas.buildReconcileSheet_();
  env.gas.arrangeTabs_(env.ss, env.gas.monthTabNames_(env.ss, env.gas.getSettings_()));
  const order = env.sheets.map(s => s.name);
  assert.ok(order.indexOf('11月') < order.indexOf('突き合わせ'));

  // 試運転の日（運用開始日より前）の閉店では、タブを作らない
  sync([['closings', '2026-10-30', { bizDate: '2026-10-30', countedCash: 1000 }]]);
  assert.ok(!env.sheets.some(s => s.name === '10月'));
  // 閉店でない送信（来客だけ）では作り直さない：先に来客だけ送ってもエラーにならず、タブはそのまま
  sync([['visits', 'v9', { bizDate: '2026-11-06', no: 1, people: 1, kind: '単品', status: '退店', total: 500, cash: 500 }]]);
  assert.equal(grid()[6][10], 0); // 500円は、次の閉店まで反映されない
});

test('11月以降の月のタブ：作り直しに失敗しても、閉店の記録は届く', () => {
  const env = boot('2026-11-05T22:00:00+09:00');
  const mgrToken = env.login();
  env.gas.rebuildAppMonthTab_ = () => { throw new Error('わざと失敗'); };
  const r = env.call('sync', { mgrToken, ops: [{ opId: 'c1', table: 'closings', id: '2026-11-02', data: { bizDate: '2026-11-02', countedCash: 100 } }] });
  assert.equal(plain(r).results[0].ok, true);
  assert.equal(env.ss.getSheetByName('締め').dump().length, 1);
});

test('月のタブを作り直す（メニュー）：運用開始日の前は作らず、以降の月をまとめて作る', () => {
  const env = boot('2026-12-03T20:00:00+09:00');
  const mgrToken = env.login();
  env.call('sync', { mgrToken, ops: [{ opId: 'v', table: 'visits', id: 'v1', data: { bizDate: '2026-11-10', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 } }] });
  env.gas.buildAppMonthTabs = env.gas.buildAppMonthTabs; // （メニューの本体。notify_ は画面がないのでここでは直接作る）
  const labels = plain(env.gas.appMonths_(env.gas.getSettings_())).map(m => env.gas.monthTabLabel_(m));
  assert.deepEqual(labels, ['11月', '12月']);
  labels.forEach((_, i) => env.gas.rebuildAppMonthTab_(['2026-11', '2026-12'][i]));
  assert.deepEqual(env.sheets.map(s => s.name).filter(n => /^1[12]月$/.test(n)), ['11月', '12月']);
  assert.equal(env.ss.getSheetByName('11月').getRange(11, 11).getValues()[0][0], 6000); // 11/10は11行目
  assert.equal(env.gas.monthTabLabel_('2027-01'), '2027年1月');
});
