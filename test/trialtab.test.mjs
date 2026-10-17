// 「10月（アプリ）」：試運転を始めた日（10/16）から運用開始日の前日までのアプリの記録を、11月（アプリ）と同じ形で出す（見るだけ）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
function boot(now = '2026-10-18T14:00:00+09:00') {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}
const plain = v => JSON.parse(JSON.stringify(v));
const head10 = ['10月', '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'];
const src = () => makeSpreadsheet({
  '9月': [head10, ['合計']],
  '10月': [head10,
    [15, '木', '岡本', '', '', '', '', 0, 0, 30000, 0, 0, 0, 0, 0, 0, 0, 0],
    [16, '金', '岡本', '優輝', '', '', '', 0, 0, 40000, 0, 5000, 0, 1000, 0, 0, 0, 0],
    [17, '土', '岡本', '', '', '', '', 0, 0, 20000, 0, 0, 0, 0, 0, 0, 0, 0], ['合計']]
});

test('10/16からのアプリの記録（試運転の印つき）が「10月（アプリ）」に入る。閉店のたびに書き換え、「10月」の一番下に差の行。月次・カウンターは変わらない', () => {
  const env = boot();
  const mgrToken = env.login();
  env.gas.reimportLegacy_(src(), '2026-10-18');
  const before = plain(env.call('monthly', { mgrToken, month: '2026-10' }).summary);
  const cdBefore = plain(env.call('countdown', { mgrToken, month: '2026-10' }));
  const tab = () => env.ss.getSheetByName('10月（アプリ）');
  assert.ok(tab(), '取り込み直しで作る');
  const sync = ops => env.call('sync', { mgrToken, ops: ops.map(([table, id, data]) => ({ opId: 'o-' + id + Math.random(), table, id, data })) });
  sync([
    ['visits', 'v0', { bizDate: '2026-10-15', no: 1, people: 2, kind: '飲み放題', status: '退店', total: 6000, cash: 6000, trial: true }], // 試運転の前の日：入れない
    ['visits', 'v1', { bizDate: '2026-10-16', no: 1, people: 3, kind: '飲み放題', status: '退店', total: 39000, cash: 39000, trial: true }],
    ['visits', 'v2', { bizDate: '2026-10-16', no: 2, people: 2, kind: '単品', status: '退店', total: 5000, cashless: 5000, trial: true }],
    ['cashMoves', 'm1', { bizDate: '2026-10-16', at: '2026-10-16T19:00:00+09:00', type: '出金', amount: 1000, lines: [{ id: 'a', kind: '仕入れ', category: '飲食物', amount: 1000 }], status: '有効' }],
    ['closings', '2026-10-16', { bizDate: '2026-10-16', countedCash: 50000, trial: true }]
  ]);
  const g = tab().getRange(1, 1, 33, 19).getValues();
  assert.equal(g[0][0], '10月（アプリ）');
  assert.equal(g[0][7], '見込み'); // 11月（アプリ）と同じ形
  assert.deepEqual(g[15].slice(0, 2), [15, '木']);
  assert.equal(g[15][10], ''); // 10/15 は入れない（試運転の前）
  assert.deepEqual([g[16][0], g[16][2], g[16][3]], [16, '岡本', '優輝']);
  assert.deepEqual([g[16][10], g[16][13], g[16][15]], [39000, 1000, 5000]); // 現金（K）・食品（N）・キャッシュレス（P）
  assert.equal(tab().protection.getUnprotectedRanges().length, 0); // 見るだけ
  // 「10月」の一番下：10/16〜の合計どうしの差
  const legacy = env.ss.getSheetByName('10月');
  assert.match(String(legacy.getRange(34, 1).getValue()), /アプリとの差（10\/16〜/);
  assert.equal(legacy.getRange(34, 10).getValue(), `=IFERROR(SUM(INDIRECT("'10月（アプリ）'!K17:K32"))-SUM(J17:J32),"")`);
  assert.equal(legacy.getRange(34, 15).getValue(), `=IFERROR(SUM(INDIRECT("'10月（アプリ）'!P17:P32"))-SUM(O17:O32),"")`);
  // 並び：10月の隣
  const names = env.sheets.map(s => s.name).filter(n => /^\d+月/.test(n));
  assert.deepEqual(names.slice(0, 3), ['9月', '10月', '10月（アプリ）']);
  // 月次・カウンターの数字は変わらない
  const after = plain(env.call('monthly', { mgrToken, month: '2026-10' }).summary);
  for (const k of ['sales', 'cash', 'cashless', 'purchaseTotal', 'laborTotal', 'profit']) assert.equal(after[k], before[k], k);
  assert.equal(plain(env.call('countdown', { mgrToken, month: '2026-10' })).confirmed, cdBefore.confirmed);
  // もう一度取り込み直しても、差の行は残り、タブは1つ
  env.gas.reimportLegacy_(src(), '2026-10-18');
  assert.match(String(env.ss.getSheetByName('10月').getRange(34, 1).getValue()), /アプリとの差/);
  assert.equal(env.sheets.filter(s => s.name === '10月（アプリ）').length, 1);
  assert.equal(tab().getRange(17, 11).getValue(), 39000);
});
