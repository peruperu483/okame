// レジの出金の2つの理由：買い出し（仕入れに入る）と、オーナーが回収（仕入れ・支出に入らない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { registerCalc, moveLabel, validateMove } from '../v2/js/calc.js';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
const mv = (bizDate, type, amount, at, extra = {}) => ({ bizDate, type, amount, at, status: '有効', ...extra });

test('レジ：回収はあるはずの現金からだけ引く。出金（買い出し）とは分けて数える', () => {
  const moves = [
    mv('2026-11-01', '出金', 3200, '2026-11-01T17:00:00+09:00', { category: '飲食物' }),
    mv('2026-11-01', '回収', 20000, '2026-11-01T22:00:00+09:00', { note: 'オーナー' }),
    mv('2026-11-01', '入金', 10000, '2026-11-01T18:00:00+09:00', { reason: 'オーナーの補充' }),
    mv('2026-11-01', '回収', 1000, '2026-11-01T23:00:00+09:00', { status: '削除' })
  ];
  const r = registerCalc({ day: '2026-11-01', closings: [], moves, dayRow: { openCash: 50000 }, cashSales: 30000 });
  assert.deepEqual([r.cashIn, r.cashOut, r.collected, r.expected], [10000, 3200, 20000, 50000 + 30000 + 10000 - 3200 - 20000]);
});

test('レジ：閉店のあと・休みの日に回収した分は、次の営業日の開店時の現金から引かれる', () => {
  const closings = [{ bizDate: '2026-11-01', closedAt: '2026-11-02T01:00:00+09:00', countedCash: 60000 }];
  const moves = [
    mv('2026-11-01', '回収', 15000, '2026-11-02T02:00:00+09:00'), // 閉店のあとに、11/1の分として店長が入れた
    mv('2026-11-02', '回収', 5000, '2026-11-02T15:00:00+09:00') // 休みの日
  ];
  assert.equal(registerCalc({ day: '2026-11-03', closings, moves, cashSales: 0 }).openCash, 60000 - 15000 - 5000);
  // 締めた日を見直すときは、閉店のあとの分を除く
  assert.equal(registerCalc({ day: '2026-11-01', closings, moves, cashSales: 0, until: '2026-11-02T01:00:00+09:00', dayRow: { openCash: 1 } }).collected, 0);
});

test('回収の表示と入力の確認：金額だけ。メモは任意', () => {
  assert.equal(moveLabel({ type: '回収' }), 'オーナーが回収');
  assert.equal(moveLabel({ type: '回収', note: '月末の精算' }), 'オーナーが回収（月末の精算）');
  assert.equal(validateMove({ type: '回収', amount: 20000 }), '');
  assert.equal(validateMove({ type: '回収', amount: '' }), '金額を入れてください。');
});

function boot() {
  const env = loadGas(CODE);
  env.setNow('2026-11-05T20:00:00+09:00');
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}
const move = (id, data) => ({ opId: 'o-' + id + Math.random(), table: 'cashMoves', id, data: { bizDate: '2026-11-05', at: '2026-11-05T22:00:00+09:00', status: '有効', ...data } });

test('GAS：回収は仕入れに入らない。出金（買い出し）は入る。入金→回収に変えても仕入れは残らない', () => {
  const env = boot();
  env.call('sync', { ops: [move('m1', { type: '出金', amount: 3200, category: '飲食物', purchaseId: 'cm-m1' })] });
  env.call('sync', { ops: [move('m2', { type: '回収', amount: 20000, note: 'オーナー' })] });
  env.call('sync', { ops: [move('m3', { type: '入金', amount: 5000, reason: 'オーナーの補充' })] });
  const mgrToken = env.login();
  const purchases = env.call('fetch', { table: 'purchases', mgrToken }).rows;
  assert.deepEqual(purchases.map(p => p.id), ['cm-m1']);
  const moves = env.ss.getSheetByName('レジの出し入れ').dump();
  assert.deepEqual(moves.map(m => [m['ID'], m['入金・出金']]), [['m1', '出金'], ['m2', '回収'], ['m3', '入金']]); // スプシでは区別できる
  assert.equal(moves[1]['内容'], 'オーナー');
  // 出金を回収に直すと、仕入れは削除になる
  env.call('sync', { ops: [{ opId: 'x', table: 'cashMoves', id: 'm1', data: { type: '回収', category: '' } }] });
  assert.equal(env.call('fetch', { table: 'purchases', mgrToken }).rows.find(p => p.id === 'cm-m1').status, '削除');
  // 月次には回収が出ない（支出にも数えない）
  const s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.equal(s.purchaseTotal, 0);
  assert.equal(s.expenses, 200000); // 店長報酬だけ
});

test('GAS：閉店の締めに回収が残る（「回収」の列）', () => {
  const env = boot();
  env.call('sync', { ops: [{ opId: 'c', table: 'closings', id: '2026-11-05', data: { bizDate: '2026-11-05', cashIn: 5000, cashOut: 3200, collected: 20000, expectedCash: 1000, countedCash: 1000, diff: 0 } }] });
  const row = env.ss.getSheetByName('締め').dump()[0];
  assert.deepEqual([row['入金'], row['出金'], row['回収']], [5000, 3200, 20000]);
});

test('GAS：バイトが回収を入れられるかは設定で切り替える（初期はバイトも可）', () => {
  const env = boot();
  const coll = (id, extra = {}) => env.call('sync', { ops: [move(id, { type: '回収', amount: 1000, ...extra })] }).results[0];
  assert.equal(coll('a').ok, true); // 初期：バイトも可
  const mgrToken = env.login();
  env.call('saveSettings', { mgrToken, settings: { staffCanCollect: false } });
  assert.equal(coll('b').code, 'forbidden'); // バイトは入れられない
  assert.equal(env.call('sync', { ops: [{ opId: 'd', table: 'cashMoves', id: 'a', data: { status: '削除' } }] }).results[0].code, 'forbidden'); // 消すのも店長だけ
  assert.equal(env.call('sync', { ops: [move('c', { type: '出金', amount: 500, category: '備品', purchaseId: 'cm-c' })] }).results[0].ok, true); // 買い出しは今までどおり
  assert.equal(env.call('sync', { mgrToken, ops: [move('e', { type: '回収', amount: 1000 })] }).results[0].ok, true); // 店長はいつでも
  assert.equal(env.call('bootstrap').settings.staffCanCollect, false);
  assert.equal(env.call('saveSettings', { mgrToken, settings: { staffCanCollect: 'はい' } }).code, 'bad_setting');
});
