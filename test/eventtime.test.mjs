// イベントの終わりの予定：「時間で決める」（入店から2時間・3時間…）と「終了時刻で決める」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { eventEndAt, fmtDuration, EVENT_DURATIONS } from '../v2/js/bizday.js';

test('時間で決める：入店の時刻から、選んだ時間あと（日をまたいでもよい）', () => {
  assert.equal(eventEndAt({ mode: 'dur', minutes: 180 }, '2026-11-04T20:10:00+09:00', '2026-11-04'), '2026-11-04T23:10:00+09:00');
  assert.equal(eventEndAt({ mode: 'dur', minutes: 240 }, '2026-11-04T22:30:00+09:00', '2026-11-04'), '2026-11-05T02:30:00+09:00');
  assert.equal(eventEndAt({ mode: 'dur', minutes: 150 }, '2026-11-04T19:00:00+09:00', '2026-11-04'), '2026-11-04T21:30:00+09:00');
  assert.equal(eventEndAt({ mode: 'dur', minutes: '' }, '2026-11-04T19:00:00+09:00', '2026-11-04'), null); // 選んでいない
  assert.equal(eventEndAt({ mode: 'dur', minutes: 120 }, '', '2026-11-04'), null);
});

test('終了時刻で決める：その営業日の時刻。切り替え時刻より前は翌日', () => {
  assert.equal(eventEndAt({ mode: 'end', end: '21:30' }, '2026-11-04T19:00:00+09:00', '2026-11-04', 12), '2026-11-04T21:30:00+09:00');
  assert.equal(eventEndAt({ mode: 'end', end: '00:30' }, '2026-11-04T22:00:00+09:00', '2026-11-04', 12), '2026-11-05T00:30:00+09:00');
  assert.equal(eventEndAt({ mode: 'end', end: '' }, '2026-11-04T19:00:00+09:00', '2026-11-04'), null);
  assert.equal(eventEndAt(null, '2026-11-04T19:00:00+09:00', '2026-11-04'), null);
});

test('時間の表示', () => {
  assert.deepEqual(EVENT_DURATIONS.map(fmtDuration), ['2時間', '3時間', '4時間']);
  assert.equal(fmtDuration(150), '2時間30分');
  assert.equal(fmtDuration(30), '30分');
});

test('GAS：設定に「イベントの時間のボタン」（初期は2・3・4時間）。店長が変えられる', () => {
  const env = loadGas(fileURLToPath(new URL('../gas/Code.gs', import.meta.url)));
  env.setNow('2026-11-04T14:00:00+09:00');
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1], pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'd', action, ...body });
  assert.deepEqual(call('bootstrap').settings.eventDurations, [120, 180, 240]);
  const mgrToken = call('login', { pin }).mgrToken;
  call('saveSettings', { mgrToken, settings: { eventDurations: [90, 120, 180] } });
  assert.deepEqual(call('bootstrap').settings.eventDurations, [90, 120, 180]);
});
