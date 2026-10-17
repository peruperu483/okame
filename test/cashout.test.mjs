// レジから出すときは「出した額 → 内訳」（仕入れ・スタッフへの支払い・小口へ・レジに戻す）。小口現金はレジとは別に数える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { registerCalc, moveLabel, checkLines, pettyBalance, lineLabel } from '../v2/js/calc.js';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
const mv = (bizDate, type, amount, at, extra = {}) => ({ bizDate, type, amount, at, status: '有効', ...extra });
const L = (id, kind, amount, extra = {}) => ({ id, kind, amount, ...extra });

test('内訳の確かめ：合計が出した額と合ったら決定できる。合わないうちは差額を出す', () => {
  const lines = [L('a', '仕入れ', 1978, { category: '飲食物', note: '酒屋' })];
  assert.equal(checkLines(2000, lines).error, '内訳があと ¥22 足りません。');
  assert.equal(checkLines(2000, lines).diff, 22);
  assert.equal(checkLines(2000, [...lines, L('b', '小口', 22)]).ok, true);
  assert.equal(checkLines(2000, [...lines, L('b', '小口', 30)]).error, '内訳が ¥8 多いです。');
  assert.equal(checkLines('', lines).error, '出した額を入れてください。');
  assert.equal(checkLines(2000, []).error, '内訳を足してください。');
  assert.equal(checkLines(1000, [L('a', '仕入れ', 1000, { category: 'その他' })]).error, '仕入れ（その他）の内容を入れてください。');
  assert.equal(checkLines(1000, [L('a', 'スタッフ', 1000, { name: ' ' })]).error, 'スタッフへの支払いの名前を入れてください。');
  assert.equal(lineLabel(lines[0]), '仕入れ（飲食物・酒屋）');
  assert.equal(lineLabel(L('x', 'スタッフ', 1, { name: '一日ママ' })), 'スタッフへの支払い（一日ママ）');
});

test('レジ：出した額だけ減る（レジに戻した分は減らない）。小口から払うはレジが変わらない。小口からレジへは増える', () => {
  const moves = [
    mv('2026-11-01', '出金', 10000, '2026-11-01T17:00:00+09:00', { lines: [L('a', '仕入れ', 6000, { category: '飲食物' }), L('b', 'スタッフ', 3000, { name: '一日ママ' }), L('c', '戻す', 1000)] }),
    mv('2026-11-01', '出金', 2000, '2026-11-01T18:00:00+09:00', { lines: [L('d', '仕入れ', 1978, { category: '飲食物' }), L('e', '小口', 22)] }),
    mv('2026-11-01', '小口から払う', 500, '2026-11-01T19:00:00+09:00', { lines: [L('f', '仕入れ', 500, { category: '備品' })] }),
    mv('2026-11-01', '小口からレジへ', 300, '2026-11-01T20:00:00+09:00'),
    mv('2026-11-01', '出金', 3200, '2026-11-01T21:00:00+09:00', { category: '飲食物' }) // 前の版（内訳なし）
  ];
  const r = registerCalc({ day: '2026-11-01', closings: [], moves, dayRow: { openCash: 50000 }, cashSales: 30000 });
  assert.deepEqual([r.cashIn, r.cashOut], [300, 9000 + 2000 + 3200]);
  assert.equal(r.expected, 50000 + 30000 + 300 - 14200);
  // 小口：22 入って、500 払って、300 レジへ。最初の残高（設定）を足す
  assert.equal(pettyBalance(moves), 22 - 500 - 300);
  assert.equal(pettyBalance(moves, 5000), 5000 + 22 - 500 - 300);
  assert.equal(pettyBalance([...moves.slice(0, 1), { ...moves[1], status: '削除' }]), 0);
  assert.equal(moveLabel(moves[1]), 'レジから出した：仕入れ（飲食物）・小口へ');
  assert.equal(moveLabel(moves[4]), '出金・飲食物');
});

function boot() {
  const env = loadGas(CODE);
  env.setNow('2026-11-05T20:00:00+09:00');
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}
const move = (id, data) => ({ opId: 'o-' + id + Math.random(), table: 'cashMoves', id, data: { bizDate: '2026-11-05', at: '2026-11-05T22:00:00+09:00', status: '有効', ...data } });

test('GAS：内訳の仕入れは仕入れ（レジから）、スタッフへの支払いは人件費（スタッフの列）に入る。小口へ・レジに戻すは入らない', () => {
  const env = boot();
  const lines = [L('a', '仕入れ', 6000, { category: '飲食物', note: '酒屋' }), L('b', 'スタッフ', 3000, { name: '一日ママ' }), L('c', '小口', 500), L('d', '戻す', 500)];
  assert.equal(env.call('sync', { ops: [move('m1', { type: '出金', amount: 10000, lines })] }).results[0].ok, true); // バイトでも入れられる
  env.call('sync', { ops: [move('m2', { type: '小口から払う', amount: 800, lines: [L('e', '仕入れ', 800, { category: 'その他', note: '花' })] })] });
  const mgrToken = env.login();
  const p = env.call('fetch', { table: 'purchases', mgrToken }).rows.sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(p.map(x => [x.id, x.category, x.label, x.amount, x.paidFrom, x.status]), [
    ['cm-m1-a', '飲食物', '飲食物（酒屋）', 6000, 'レジから', '有効'],
    ['cm-m2-e', 'その他', 'その他（花）', 800, '小口から', '有効']
  ]);
  const a = env.call('fetch', { table: 'attendance', mgrToken }).rows;
  assert.deepEqual(a.map(x => [x.id, x.name, x.kind, x.cost, x.bizDate]), [['cm-m1-b', '一日ママ', '手打ち', 3000, '2026-11-05']]);
  assert.deepEqual(JSON.parse(env.ss.getSheetByName('レジの出し入れ').dump()[0]['内訳']).map(l => l.kind), ['仕入れ', 'スタッフ', '小口', '戻す']);
  let s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([s.purchaseTotal, s.laborTotal, s.laborOthers.cost], [6800, 3000, 3000]);
  // 店長が内訳を直す（スタッフへの支払いを外して仕入れに）→ 写した人件費は削除
  env.call('sync', { mgrToken, ops: [{ opId: 'x', table: 'cashMoves', id: 'm1', data: { amount: 10000, lines: [L('a', '仕入れ', 9000, { category: '飲食物' }), L('c', '小口', 500), L('d', '戻す', 500)], updatedAt: '2026-11-05T23:00:00+09:00' } }] });
  s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([s.purchaseTotal, s.laborTotal], [9800, 0]);
  // 出し入れを消す → 写した行もすべて削除
  env.call('sync', { mgrToken, ops: [{ opId: 'y', table: 'cashMoves', id: 'm1', data: { status: '削除', updatedAt: '2026-11-05T23:30:00+09:00' } }, { opId: 'z', table: 'cashMoves', id: 'm2', data: { status: '削除', updatedAt: '2026-11-05T23:30:00+09:00' } }] });
  s = env.call('monthly', { mgrToken, month: '2026-11' }).summary;
  assert.deepEqual([s.purchaseTotal, s.laborTotal], [0, 0]);
});

test('GAS：前の版の表（「内訳」の列がない）でも、送られた内訳を捨てずに列を足す。小口の最初の残高は設定で入れられる', () => {
  const env = boot();
  const sh = env.ss.getSheetByName('レジの出し入れ');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.deleteColumn(head.indexOf('内訳') + 1);
  env.call('sync', { ops: [move('m1', { type: '出金', amount: 1000, lines: [L('a', '仕入れ', 1000, { category: '備品' })] })] });
  assert.equal(JSON.parse(sh.dump()[0]['内訳'])[0].amount, 1000);
  const mgrToken = env.login();
  assert.equal(env.call('bootstrap').settings.pettyCashStart, 0);
  env.call('saveSettings', { mgrToken, settings: { pettyCashStart: 12345 } });
  assert.equal(env.call('bootstrap').settings.pettyCashStart, 12345);
  assert.equal(env.call('bootstrap').version, '0.18.0');
});
