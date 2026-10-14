import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { bizDateOf, nowIso, fmtDay, fmtTime, isTrial, minutesLeft, addDays } from '../v2/js/bizday.js';
import { memoryStore } from '../v2/js/store.js';
import { createSync } from '../v2/js/sync.js';
import { ApiError, NetworkError } from '../v2/js/api.js';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));
const at = s => new Date(s);

test('営業日：正午より前は前日。端末のタイムゾーンに関係なく日本時間', () => {
  assert.equal(bizDateOf(at('2026-11-01T18:00:00+09:00')), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-01T23:59:00+09:00')), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-02T00:30:00+09:00')), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-02T01:30:00+09:00')), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-02T11:59:00+09:00')), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-02T12:00:00+09:00')), '2026-11-02');
  assert.equal(bizDateOf(at('2026-12-01T02:00:00+09:00')), '2026-11-30');
  assert.equal(bizDateOf(at('2027-01-01T03:00:00+09:00')), '2026-12-31');
  assert.equal(bizDateOf(at('2026-11-02T05:00:00+09:00'), 6), '2026-11-01');
  assert.equal(bizDateOf(at('2026-11-02T06:00:00+09:00'), 6), '2026-11-02');
});

test('日付の表示と計算', () => {
  assert.equal(nowIso(at('2026-11-01T10:05:09Z')), '2026-11-01T19:05:09+09:00');
  assert.equal(fmtDay('2026-11-01'), '11/1(日)');
  assert.equal(fmtTime('2026-11-02T00:30:00+09:00'), '0:30');
  assert.equal(isTrial('2026-10-31', '2026-11-01'), true);
  assert.equal(isTrial('2026-11-01', '2026-11-01'), false);
  assert.equal(minutesLeft('2026-11-01T19:00:00+09:00', 120, at('2026-11-01T20:30:00+09:00')), 30);
  assert.equal(minutesLeft('2026-11-01T19:00:00+09:00', 120, at('2026-11-01T21:10:00+09:00')), -10);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

function wire({ offline = () => false } = {}) {
  const env = loadGas(CODE);
  env.setNow('2026-10-20T20:00:00+09:00');
  env.gas.setup();
  const token = env.logs.join('\n').match(/共有トークン：(\w+)/)[1];
  const pin = env.logs.join('\n').match(/初期の暗証番号：(\d+)/)[1];
  let mgrToken = null;
  const post = async (action, body = {}) => {
    if (offline()) throw new NetworkError('通信できませんでした');
    const r = env.post({ token, deviceId: 'tab1', mgrToken, ...body, action });
    if (r.status !== 'ok') throw new ApiError(r.code, r.message);
    return r;
  };
  const store = memoryStore();
  const sync = createSync({ store, post, getDeviceId: () => 'tab1', getMgrToken: () => mgrToken });
  return { env, store, sync, post, login: async () => { mgrToken = (await post('login', { pin })).mgrToken; }, logout: () => { mgrToken = null; } };
}

test('通信が切れても端末に残り、つながったら1件ずつ届く', async () => {
  let off = true;
  const w = wire({ offline: () => off });
  await w.sync.save('visits', 'v1', { bizDate: '2026-11-01', people: 2, status: '店内' });
  await w.sync.save('visits', 'v1', { status: '会計済', amount: 6000, pay: '現金' }, { log: { type: 'テスト', reason: '' } });
  await w.sync.flush();
  assert.equal(w.sync.state.pending, 3);
  assert.equal(w.sync.state.online, false);
  assert.equal((await w.store.getRow('visits', 'v1')).status, '会計済');

  off = false;
  await w.sync.flush();
  w.sync.stop();
  assert.equal(w.sync.state.pending, 0);
  const rows = w.env.ss.getSheetByName('来客').dump();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['状態'], '会計済');
  assert.equal(rows[0]['人数'], 2);
  assert.equal(w.env.ss.getSheetByName('操作履歴').dump().length, 1);
});

test('送信の途中で切れても、送り直して二重にならない', async () => {
  const w = wire();
  await w.sync.save('visits', 'v1', { bizDate: '2026-11-01', people: 3, status: '店内' });
  // GASには届いたが返事が来なかった、という状況をまねる
  const ops = await w.store.outboxPeek(10);
  await w.post('sync', { ops: ops.map(({ opId, table, id, data }) => ({ opId, table, id, data })) });
  await w.sync.flush();
  w.sync.stop();
  assert.equal(w.env.ss.getSheetByName('来客').dump().length, 1);
  assert.equal(w.sync.state.pending, 0);
});

test('権限がなくて断られたものは「送れなかった」に残し、店長で送り直せる', async () => {
  const w = wire();
  await w.login();
  await w.post('saveSettings', { settings: { visibility: { attendance: false } } });
  w.logout();
  await w.sync.save('attendance', 'a1', { bizDate: '2026-11-01', name: '加奈', hours: 5 });
  await w.sync.save('visits', 'v1', { bizDate: '2026-11-01', people: 2 });
  await w.sync.flush();
  assert.equal(w.sync.state.pending, 0);
  assert.equal(w.sync.state.failed, 1);
  assert.equal(w.env.ss.getSheetByName('来客').dump().length, 1);

  await w.login();
  await w.sync.retryFailed();
  w.sync.stop();
  assert.equal(w.sync.state.failed, 0);
  assert.equal(w.env.ss.getSheetByName('勤怠').dump().length, 1);
});

test('GASから読み込むとき、送信待ちの記録は端末のほうを残す', async () => {
  let off = false;
  const w = wire({ offline: () => off });
  await w.sync.save('visits', 'v1', { bizDate: '2026-11-01', people: 2, status: '店内' });
  await w.sync.flush();
  off = true;
  await w.sync.save('visits', 'v1', { status: '会計済', amount: 6000 });
  off = false;
  // flushの前にpullしても、端末の「会計済」は消えない
  await w.sync.pull('visits', '2026-11-01', '2026-11-01');
  assert.equal((await w.store.getRow('visits', 'v1')).status, '会計済');
  await w.sync.flush();
  w.sync.stop();
  await w.sync.pull('visits', '2026-11-01', '2026-11-01');
  assert.equal((await w.store.getRow('visits', 'v1')).status, '会計済');
  assert.deepEqual((await w.store.listRows('visits', '2026-11-01', '2026-11-01')).map(r => r.id), ['v1']);
});

test('時刻を営業日の日時にする（0時を過ぎたら翌日の日付）', async () => {
  const { fmtHM, timeOnBizDay } = await import('../v2/js/bizday.js');
  assert.equal(fmtHM('2026-11-01T19:05:00+09:00'), '19:05');
  assert.equal(fmtHM('2026-11-02T00:30:00+09:00'), '00:30');
  assert.equal(timeOnBizDay('2026-11-01', '21:30'), '2026-11-01T21:30:00+09:00');
  assert.equal(timeOnBizDay('2026-11-01', '0:30'), '2026-11-02T00:30:00+09:00');
  assert.equal(timeOnBizDay('2026-11-30', '01:00'), '2026-12-01T01:00:00+09:00');
  assert.equal(timeOnBizDay('2026-11-01', ''), null);
});
