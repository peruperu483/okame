// イベントの金額＝人数×1人の単価。2台で同時に −／＋ を押しても狂わない。予定の見込みも人数×単価
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
function boot(now = '2026-11-05T20:00:00+09:00') {
  const env = loadGas(CODE);
  env.setNow(now);
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}, dev = 'dev1') => env.post({ token, deviceId: dev, action, ...body });
  return { ...env, call, login: () => call('login', { pin }).mgrToken };
}
const plus = (id, d) => ({ id, type: '人数', delta: d, amount: 0, at: '2026-11-05T21:00:00+09:00' });

test('GAS：2台で同時に＋を押しても、両方の分だけ人数と金額が増える', () => {
  const env = boot();
  const base = { bizDate: '2026-11-05', kind: 'イベント', status: '店内', people: 20, basePeople: 20, unitPrice: 5000, base: 100000, extras: [], pays: [], total: 100000, updatedAt: '2026-11-05T20:00:00+09:00' };
  env.call('sync', { ops: [{ opId: 'v', table: 'visits', id: 'e1', data: base }] });
  // 2台とも 20人の画面から ＋ を押した（それぞれ21人として送る）
  const r1 = env.call('sync', { ops: [{ opId: 'a', table: 'visits', id: 'e1', data: { extras: [plus('p1', 1)], people: 21, base: 105000, total: 105000, updatedAt: '2026-11-05T21:00:01+09:00' } }] }, 'dev1');
  const r2 = env.call('sync', { ops: [{ opId: 'b', table: 'visits', id: 'e1', data: { extras: [plus('p2', 1)], people: 21, base: 105000, total: 105000, updatedAt: '2026-11-05T21:00:01+09:00' } }] }, 'dev2');
  assert.equal(r1.results[0].ok && r2.results[0].ok, true);
  const row = env.ss.getSheetByName('来客').dump()[0];
  assert.deepEqual([row['人数'], row['基本の金額'], row['合計'], row['1人の単価'], row['入店時の人数']], [22, 110000, 110000, 5000, 20]);
  assert.equal(r2.results[0].current.people, 22); // 2台目には合わせた結果が返る
});

test('予定：取り込んだ合計の金額は、人数と単価を入れたら上書きしない。スプシで見込みを打ったら金額のまま', () => {
  const env = boot('2026-10-16T14:00:00+09:00');
  const head10 = ['10月', '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上'];
  const src = () => makeSpreadsheet({ '9月': [head10, ['合計']], '10月': [head10, [31, '土', '岡本', '', '', '', '日本酒の会', '', '', '', 210000], ['合計']] });
  env.gas.importLegacyPlans_(src(), '2026-10-16');
  const ev = () => env.ss.getSheetByName('予定').dump().find(e => e['ID'] === 'lg-2026-10-31-日本酒の会');
  assert.equal(ev()['見込みの金額'], 210000);
  const mgrToken = env.login();
  env.call('sync', { mgrToken, ops: [{ opId: 'x', table: 'events', id: 'lg-2026-10-31-日本酒の会', data: { people: 30, unitPrice: 5000, expectedAmount: 150000 } }] });
  env.gas.importLegacyPlans_(src(), '2026-10-16');
  assert.deepEqual([ev()['見込みの金額'], ev()['1人の単価'], ev()['人数']], [150000, 5000, 30]);
});
