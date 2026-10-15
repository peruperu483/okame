// 月ごとのタブ（9月・10月）・運用開始日が月の途中のとき
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
  assert.deepEqual(names.slice(0, 2), ['9月', '10月']);
  assert.ok(!names.includes('突き合わせ')); // 突き合わせのタブは、やめた
  for (const n of ['9月', '10月', '月のひな形']) assert.equal(names.filter(x => x === n).length, 1, n);
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
  for (const n of ['9月', '10月', '月のひな形']) assert.ok(env.ss.getSheetByName(n).protection, n + 'の保護');
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
  assert.deepEqual(names.slice(0, 2), ['9月', '10月']);
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

test('取り込み直し：10月の続きが打たれても、何度実行しても金額は二重にならず、10月のタブと月次が上書きされる', () => {
  const { env, source } = legacyEnv();
  const mgrToken = env.login();
  const daily = () => env.ss.getSheetByName('過去の日別').dump();
  const octSales = () => env.call('monthly', { mgrToken, month: '2026-10' }).summary.sales;
  // 10/14：1回目と2回目（同じ内容）
  const r1 = plain(env.gas.reimportLegacy_(source(), '2026-10-14'));
  const oct1 = r1.money.find(x => x.tab === '10月');
  assert.equal(oct1.sales, 100000 + 5000 + 25000 + 25000); // 10/2 現金・キャッシュレス、10/10、10/14
  assert.equal(octSales(), oct1.sales);
  const rows1 = daily().length, events1 = env.ss.getSheetByName('予定').dump().length, days1 = env.ss.getSheetByName('営業日').dump().length;
  const r2 = plain(env.gas.reimportLegacy_(source(), '2026-10-14'));
  assert.equal(r2.money.find(x => x.tab === '10月').sales, oct1.sales);
  assert.equal(octSales(), oct1.sales);
  assert.equal(daily().length, rows1);
  assert.equal(env.ss.getSheetByName('予定').dump().length, events1);
  assert.equal(env.ss.getSheetByName('営業日').dump().length, days1);
  // 管理シートに10月の続きが打たれた：10/14 を直し（25000 → 27000）、10/20 に売上とイベント
  const src = source();
  const oct = src.getSheetByName('10月');
  oct.getRange(5, 10).setValue(27000);
  oct.getRange(6, 10).setValue(18000);
  oct.getRange(6, 7).setValue('歓送会');
  env.setNow('2026-10-20T20:00:00+09:00');
  const r3 = plain(env.gas.reimportLegacy_(src, '2026-10-20'));
  const oct3 = r3.money.find(x => x.tab === '10月');
  assert.equal(oct3.sales, oct1.sales + 2000 + 18000);
  assert.equal(oct3.until, '2026-10-01〜2026-10-20');
  assert.equal(octSales(), oct3.sales);
  assert.equal(env.call('monthly', { mgrToken, month: '2026-09' }).summary.sales, r1.money.find(x => x.tab === '9月').sales); // 9月は変わらない
  // 過去の日別：10月は5日分（1・2・10・14・20日）。同じ日は1行だけ
  const octRows = daily().filter(r => String(r['日付']).startsWith('2026-10'));
  assert.deepEqual(octRows.map(r => String(r['日付'])), ['2026-10-01', '2026-10-02', '2026-10-10', '2026-10-14', '2026-10-20']);
  assert.equal(octRows.find(r => r['日付'] === '2026-10-14')['現金売上'], 27000);
  // 10月のタブ：上書きされる（1つのまま）
  assert.equal(env.sheets.filter(x => x.name === '10月').length, 1);
  const tab = env.ss.getSheetByName('10月');
  assert.equal(tab.getRange(15, 10).getValue(), 27000); // 14日の現金売上
  assert.equal(tab.getRange(21, 10).getValue(), 18000); // 20日の現金売上
  assert.equal(tab.getRange(21, 7).getValue(), '歓送会');
  // 予定：10/20 のイベントが増える（二重にはならない）
  assert.equal(env.ss.getSheetByName('予定').dump().filter(e => e['内容'] === '歓送会').length, 1);
  // 表示：日数・件数・10月の売上の合計
  const msg = env.gas.reimportMessage_(r3);
  assert.match(msg, /■ 10月\n　金額：5日分（2026-10-01〜2026-10-20）・売上の合計 ¥175,000/);
  assert.match(msg, /　予定：シフトのある日 \d+日（うち店休日 \d+日）・シフトの人数 のべ\d+人・イベント \d+件/);
  assert.match(msg, /10月の売上の合計：¥175,000（2026-10-01〜2026-10-20）/);
});
