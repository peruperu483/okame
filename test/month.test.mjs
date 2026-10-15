// 月ごとのタブ（9月・10月）・突き合わせ・運用開始日が月の途中のとき
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now) {
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

// 管理シートのまね（金額はテスト用）
function legacyEnv(now = '2026-10-14T20:00:00+09:00') {
  const env = boot(now);
  const sep = [
    ['8月', '列 1', '列 2', '列 3', '列 ４', '列 ', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', 'ポイント\n売上', '食品\n支出', 'その他\n支出', 'キャッシュ\nレス\n売上', '家賃', 'ガス\n電気\nカラオケ'],
    [1, '火', '加奈', '', '', '', '', 12000, 0, 8000, 0, 0, 0, 0, 0, 200000, 30000],
    [2, '水', '岡本', '', '', '', '', 0, 0, 10000, 0, 0, 1000, 0, 2000, 0, 0],
    [3, '木', '店休日', '', '', '', '', 0, 0, 0, 0, 0, 0, 500, 0, 0, 0],
    [4, '金', '岡本', '加奈', '', '', '6名団体', 13000, 5000, 20000, 30000, 1000, 2000, 0, 0, 0, 1000],
  ];
  while (sep.length < 32) sep.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  sep.push(['合計', '', '', '', '', '', '', ...'HIJKLMNOPQ'.split('').map(c => '=SUM(' + c + '2:' + c + '32)')]); // 33行目：合計の式
  sep.push(['', '', '売上目標等', '売上目標']);
  const oct = [
    ['10月', '列 1', '1', '2', '3', '3 2', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'],
    [1, '木', '岡本', '', '', '', '', 0, 0, 0, 0, 0, 0, 500, 100, 250000, 30000, 8000],
    [2, '金', '岡本', '加奈', '優輝', '', 'おかめでナイト', 15000, 0, 100000, 0, 5000, 0, 800, 0, 0, 4900, 0],
    [10, '土', '岡本', '', '', '', '1日ママ', 10000, 0, 25000, 0, 0, 0, 3000, 0, 0, 0, 0],
    [14, '水', '岡本', '', '', '', '', 0, 0, 25000, 0, 0, 0, 0, 0, 0, 0, 0],
    [20, '火', '岡本', '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 先の日付：タブには曜日だけ
    ['合計']
  ];
  // 塗り：C3（9月・10月）と10月のG4は黄色。10月のC5は1行おきの色（写さない）
  const fills = { '9月': { C3: '#ffff00' }, '10月': { C3: '#ffff00', G4: '#ffff00', C5: '#f6f8f9' } };
  const source = () => makeSpreadsheet({ '9月': sep, '10月': oct }, fills);
  return { env, source };
}
const plain = v => JSON.parse(JSON.stringify(v));

test('月のタブ：9月・10月が管理シートの9月と同じ形で先頭に並び、何度やっても二重にならない', () => {
  const { env, source } = legacyEnv();
  env.gas.importLegacy_(source(), '2026-10-14');
  const res = plain(env.gas.importLegacy_(source(), '2026-10-14'));
  assert.equal(res[0].tabs, 'copy');
  const names = env.sheets.map(s => s.name);
  assert.deepEqual(names.slice(0, 3), ['9月', '10月', '突き合わせ']);
  for (const n of ['9月', '10月', '月のひな形', '突き合わせ']) assert.equal(names.filter(x => x === n).length, 1, n);
  assert.ok(!names.some(n => n.includes('のコピー')));
  assert.ok(env.ss.getSheetByName('過去の日別').hidden && env.ss.getSheetByName('過去の月次').hidden && env.ss.getSheetByName('月のひな形').hidden);
  assert.ok(!env.ss.getSheetByName('9月').hidden && !env.ss.getSheetByName('10月').hidden);

  const grid = n => env.ss.getSheetByName(n).getRange(1, 1, 33, 18).getValues();
  const sep = grid('9月');
  assert.deepEqual(sep[0].slice(0, 3), ['9月', '列 1', '列 2']); // 元の「8月」の書き間違いは直す
  assert.equal(sep[0][17], '保険');
  assert.deepEqual(sep[1].slice(0, 8), [1, '火', '加奈', '', '', '', '', 12000]);
  assert.deepEqual([sep[1][9], sep[1][15], sep[1][16], sep[1][17]], [8000, 200000, 30000, 0]); // 9月の家賃→家賃電気、ガス電気カラオケ→ガス…
  assert.equal(sep[3][2], '店休日');
  assert.deepEqual([sep[4][6], sep[4][3]], ['6名団体', '加奈']);
  assert.deepEqual(sep[5].slice(0, 2), [5, '土']); // 管理シートに行がない日は、日付と曜日だけ
  assert.equal(sep[30][0], 30); // 9月は30日まで
  assert.equal(sep[31][0], ''); // 31日の行は空
  assert.equal(sep[32][0], '合計');
  assert.equal(sep[32][7], '=SUM(H2:H32)');
  assert.equal(sep[32][17], '=SUM(R2:R32)');

  const oct = grid('10月');
  assert.equal(oct[0][0], '10月');
  assert.deepEqual([oct[2][9], oct[2][14]], [100000, 5000]); // 10月の「売上」は現金売上の列へ、キャッシュレスはO列へ
  assert.deepEqual([oct[2][15], oct[2][16], oct[2][17]], [0, 4900, 0]);
  assert.deepEqual([oct[1][15], oct[1][17]], [250000, 8000]);
  assert.equal(oct[2][4], '優輝');
  assert.equal(oct[31][0], 31); // 10月は31日まで
  assert.deepEqual(oct[20].slice(0, 3), [20, '火', '']); // 20日：先の日付は日付と曜日だけ
  assert.equal(oct[20][9], '');
  // 黄色は元のとおりに写し、1行おきの色は写さない
  const bg = (n, r, c) => env.ss.getSheetByName(n).bgs.get(r + ':' + c);
  assert.equal(bg('9月', 3, 3), '#ffff00');
  assert.equal(bg('10月', 3, 3), '#ffff00');
  assert.equal(bg('10月', 11, 7), '#ffff00'); // 10日の「1日ママ」
  assert.equal(bg('10月', 15, 3), undefined); // 14日の行の1行おきの色は写さない
  for (const n of ['9月', '10月', '突き合わせ', '月のひな形']) assert.ok(env.ss.getSheetByName(n).protection, n + 'の保護');
  assert.ok(env.ss.getSheetByName('10月').bandings.length >= 1);
  assert.equal(env.ss.getSheetByName('過去の日別').dump().length, 4 + 4); // 取り込みの数字は二重にならない
});

test('月のタブ：見本をコピーできなくても、同じ並びで自前で作る', () => {
  const { env, source } = legacyEnv();
  const src = source();
  src.getSheetByName('9月').copyTo = () => { throw new Error('コピーできません'); };
  const res = plain(env.gas.importLegacy_(src, '2026-10-14'));
  assert.equal(res[0].tabs, 'plain');
  const names = env.sheets.map(s => s.name);
  assert.deepEqual(names.slice(0, 3), ['9月', '10月', '突き合わせ']);
  assert.ok(!names.some(n => n.includes('のコピー')));
  const sh = env.ss.getSheetByName('9月');
  const v = sh.getRange(1, 1, 33, 18).getValues();
  assert.equal(v[0][0], '9月');
  assert.equal(v[0][16], 'ガス・カラオケ\nWi-Fi・電話');
  assert.equal(v[2][2], '岡本');
  assert.equal(v[32][7], '=SUM(H2:H32)');
  assert.ok(sh.bgs.get('3:3')); // チップの代わりの色
  assert.ok(sh.bgs.get('2:2')); // 曜日
  assert.equal(env.ss.getSheetByName('10月').bgs.get('3:3'), '#ffff00'); // 黄色はそのまま
});

test('突き合わせ：試運転の日ごとに、アプリと管理シートの数字を並べ、ずれの日が分かる', () => {
  const { env, source } = legacyEnv();
  const mgrToken = env.login();
  const sync = (table, id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id, table, id, data }] });
  // 10/02：管理シートと同じ数字（現金100000・キャッシュレス5000・食品800・人件費15000）
  sync('visits', 'v1', { bizDate: '2026-10-02', no: 1, people: 4, kind: '飲み放題', status: '退店', total: 105000, cash: 100000, cashless: 5000, point: 0 });
  sync('purchases', 'p1', { date: '2026-10-02', category: '飲食物', amount: 800, status: '有効' });
  sync('attendance', 'a1', { bizDate: '2026-10-02', name: '加奈', kind: '固定', hours: 6, cost: 15000, status: '有効' });
  // 10/10：ずれあり（現金が3000多い・イベントは団体売上へ・人件費と食品が入っていない）
  sync('visits', 'v2', { bizDate: '2026-10-10', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 28000, cash: 28000 });
  sync('visits', 'v3', { bizDate: '2026-10-10', no: 2, people: 10, kind: 'イベント', status: '退店', total: 50000, cash: 50000 });
  sync('visits', 'v4', { bizDate: '2026-10-10', no: 3, people: 1, kind: '単品', status: '店内', total: 0 }); // 店内：数えない
  // 10/15：管理シートに行がない日
  sync('visits', 'v5', { bizDate: '2026-10-15', no: 1, people: 1, kind: '単品', status: '退店', total: 1000, cash: 1000 });
  // 運用開始日以降（11/02）は試運転ではない
  sync('visits', 'v6', { bizDate: '2026-11-02', no: 1, people: 1, kind: '単品', status: '退店', total: 500, cash: 500 });
  env.gas.importLegacy_(source(), '2026-10-14');

  const sh = env.ss.getSheetByName('突き合わせ');
  const rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  assert.match(rows[0][0], /ずれのある日：1日 ／ 比べた日：2日/);
  const byDate = Object.fromEntries(rows.slice(2).map(r => [r[0], r]));
  assert.deepEqual(Object.keys(byDate), ['2026-10-02', '2026-10-10', '2026-10-15', '合計']);
  const d2 = byDate['2026-10-02'];
  assert.equal(d2[2], '一致');
  assert.deepEqual(d2.slice(4, 7), [100000, 100000, 0]); // 現金：アプリ・管理シート・差
  assert.deepEqual(d2.slice(7, 10), [5000, 5000, 0]); // キャッシュレス
  assert.deepEqual(d2.slice(16, 19), [15000, 15000, 0]); // 人件費
  assert.deepEqual(d2.slice(19, 22), [800, 800, 0]); // 仕入れ（食品）
  const d10 = byDate['2026-10-10'];
  assert.equal(d10[2], 'ずれあり');
  assert.deepEqual(d10.slice(4, 7), [28000, 25000, 3000]); // 現金
  assert.deepEqual(d10.slice(13, 16), [50000, 0, 50000]); // 団体（イベント）売上
  assert.deepEqual(d10.slice(16, 19), [0, 10000, -10000]); // 人件費
  assert.deepEqual(d10.slice(19, 22), [0, 3000, -3000]); // 食品
  assert.equal(d10[3], 3000 + 50000 + 10000 + 3000);
  assert.equal(sh.bgs.get('4:3'), '#f4c7c3'); // 10/10の「結果」が赤
  assert.equal(sh.bgs.get('4:7'), '#f4c7c3'); // 現金の差
  assert.equal(sh.bgs.get('3:3'), '#d9ead3'); // 10/02は緑
  assert.equal(byDate['2026-10-15'][2], '管理シートに行なし');
  assert.deepEqual(byDate['合計'].slice(4, 7), [128000, 125000, 3000]);

  env.gas.buildReconcileSheet_(); // もう一度作っても1つのまま
  assert.equal(env.sheets.filter(s => s.name === '突き合わせ').length, 1);
});

test('突き合わせ：試運転の記録がまだないときは、そのことを書く', () => {
  const { env, source } = legacyEnv();
  env.gas.importLegacy_(source(), '2026-10-14');
  const sh = env.ss.getSheetByName('突き合わせ');
  assert.match(sh.getRange(1, 1).getValues()[0][0], /試運転の記録がまだありません/);
});

test('運用開始日が月の途中のとき、その月は「運用開始日より前＝管理シート、以降＝アプリ」で数える', () => {
  const { env, source } = legacyEnv();
  env.gas.importLegacy_(source(), '2026-10-14');
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { goLiveDate: '2026-10-11' } });
  const sync = (table, id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id, table, id, data }] });
  sync('visits', 'v1', { bizDate: '2026-10-12', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000 });
  sync('visits', 'v0', { bizDate: '2026-10-10', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 99999, cash: 99999 }); // 運用開始日より前：試運転
  const s = env.call('monthly', { mgrToken, month: '2026-10' }).summary;
  // 管理シートの10/1〜10/10（現金100000+25000、キャッシュレス5000）＋アプリの10/12（6000）
  assert.deepEqual([s.legacy, s.sales, s.cash, s.cashless], [false, 100000 + 25000 + 5000 + 6000, 100000 + 25000 + 6000, 5000]);
  assert.equal(s.purchases['飲食物'], 500 + 800 + 3000);
  assert.equal(s.fixed['家賃電気'], 250000);
  assert.equal(s.laborTotal, 15000 + 10000);
  assert.equal(s.openDays, 3 + 1);
  // 運用開始日が月の初日なら、これまでどおり（管理シートの月として読む）
  env.call('saveSettings', { mgrToken, settings: { goLiveDate: '2026-11-01' } });
  assert.equal(env.call('monthly', { mgrToken, month: '2026-10' }).summary.legacy, true);
});
