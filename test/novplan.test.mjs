// 管理シートの11月以降のタブから、シフトとイベントをアプリの予定に入れる（空いている日だけ。金額は入れない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now = '2026-10-20T14:00:00+09:00') {
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
const plain = v => JSON.parse(JSON.stringify(v));
const blank = n => new Array(n).fill('');
const head = m => [m, '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上'];
const row = (d, dow, shift, ev = '', cash = '') => [d, dow, ...shift, ev, '', '', cash];

// 管理シートのまね（名前と予定はテスト用）
function source({ nov1Event = '日本酒の会' } = {}) {
  const sep = [head('8月'), row(1, '火', ['加奈', '', '', '']), ['合計']];
  const oct = [head('10月'), row(2, '金', ['岡本', '', '', '']), ['合計']];
  const nov = [head('11月'),
    row(1, '日', ['岡本', '', '', ''], nov1Event, 99999), // 金額は入れない
    row(2, '月', ['岡本', '', '', '']), // アプリの予定にもうシフトがある → 飛ばす
    row(3, '火', ['店休日', '', '', '']),
    row(5, '木', ['岡本', '', '', ''], '別の会'), // アプリにもうイベントがある → 飛ばす
    row(6, '金', ['加奈', '', '', '']), // スプシ（アプリのタブ）で打ってある → 飛ばす
    row(7, '土', ['加奈', '', '', '']), // アプリのタブに打ってあって、まだアプリに入っていない → 飛ばす
    row(10, '火', ['岡本', '加奈', '', '優輝'], '1日ママ、貸切'),
    row(12, '木', ['', '', '', '']), // 空の日
    ['合計']];
  const dec = [head('12月'), row(1, '火', ['岡本', '', '', '']), ['合計']];
  return makeSpreadsheet({ '9月': sep, '10月': oct, '11月': nov, '12月': dec });
}
const days = env => Object.fromEntries(env.ss.getSheetByName('営業日').dump().map(r => [String(r['ID']), r]));
const events = env => env.ss.getSheetByName('予定').dump();
function typeCells(env, name, r, c, rows2d) {
  const range = env.ss.getSheetByName(name).getRange(r, c, rows2d.length, rows2d[0].length);
  range.setValues(rows2d);
  env.gas.handleSheetEdit({ range });
}

function prepared() {
  const env = boot();
  const mgrToken = env.login();
  env.gas.createNextMonthTab_(); // 「11月」のタブ（アプリ）
  const sync = (table, id, data) => env.call('sync', { mgrToken, ops: [{ opId: 'o-' + id + Math.random(), table, id, data }] });
  sync('days', '2026-11-02', { bizDate: '2026-11-02', shiftPlan: '加奈' });
  sync('events', 'e1', { date: '2026-11-05', type: '団体', title: '歓迎会', status: '有効' });
  typeCells(env, '11月', 7, 3, [['岡本']]); // 11/6（スプシから）
  env.ss.getSheetByName('11月').getRange(8, 3).setValue('優輝'); // 11/7（トリガーが動かなかった）
  return { env, mgrToken, sync };
}

test('11月：空いている日だけ入れ、アプリの予定やアプリのタブにもう入っている日は上書きしない。アプリのタブにも出る', () => {
  const { env } = prepared();
  const r = plain(env.gas.reimportLegacy_(source(), '2026-10-20'));
  const nov = r.plans.tabs.find(t => t.tab === '11月');
  assert.deepEqual(nov, { tab: '11月', month: '2026-11', legacy: false, days: 3, people: 4, closedDays: 1, events: 3, skipped: 4, expected: 0 });
  const d = days(env);
  assert.equal(d['2026-11-01']['シフト予定'], '岡本');
  assert.equal(d['2026-11-02']['シフト予定'], '加奈'); // 上書きしない
  assert.equal(d['2026-11-03']['店休日'], true);
  assert.equal(d['2026-11-06']['シフト予定'], '岡本');
  assert.equal(d['2026-11-07']['シフト予定'], '優輝'); // アプリのタブで打った分が先に入り、上書きしない
  assert.equal(d['2026-11-10']['シフト予定'], '岡本、加奈、優輝');
  assert.equal(d['2026-11-12'], undefined);
  const ev = events(env).filter(e => String(e['日付']).startsWith('2026-11') && e['状態'] === '有効').map(e => e['日付'] + ' ' + e['内容']).sort();
  assert.deepEqual(ev, ['2026-11-01 日本酒の会', '2026-11-05 歓迎会', '2026-11-10 1日ママ', '2026-11-10 貸切']);
  assert.ok(events(env).every(e => !e['見込みの金額'])); // 金額は入れない
  // アプリのタブ（11月）のシフトとイベントの欄
  const g = env.ss.getSheetByName('11月').getRange(1, 1, 33, 19).getValues();
  assert.deepEqual(g[1].slice(2, 7), ['岡本', '', '', '', '日本酒の会']); // 11/1
  assert.equal(g[3][2], '店休日'); // 11/3
  assert.deepEqual(g[10].slice(2, 7), ['岡本', '加奈', '優輝', '', '1日ママ、貸切']); // 11/10（店長が先）
  assert.equal(g[2][2], '加奈'); // 11/2 はアプリのまま
  assert.equal(g[1][10], ''); // 金額の列は空のまま
  // 12月（アプリのタブはまだない）も入る
  assert.equal(d['2026-12-01']['シフト予定'], '岡本');
  assert.deepEqual(plain(r.plans.tabs.find(t => t.tab === '12月')), { tab: '12月', month: '2026-12', legacy: false, days: 1, people: 1, closedDays: 0, events: 0, skipped: 0, expected: 0 });
  // 売上は変わらない
  assert.equal(env.call('monthly', { mgrToken: env.login(), month: '2026-11' }).summary.sales, 0);
  // 表示
  const msg = env.gas.reimportMessage_(r);
  assert.match(msg, /■ 11月（予定だけ。もう入っている日は上書きしない）\n　予定：取り込んだ日 3日（うち店休日 1日）・シフトの人数 のべ4人・イベント 3件・上書きせずに飛ばした日 4日/);
  assert.match(msg, /■ 12月（予定だけ/);
});

test('11月：何度実行しても二重にならない。取り込んだあとにアプリで直した日は、次から上書きしない', () => {
  const { env, sync } = prepared();
  env.gas.reimportLegacy_(source(), '2026-10-20');
  const daysCount = env.ss.getSheetByName('営業日').dump().length, evCount = events(env).length;
  const r2 = plain(env.gas.reimportLegacy_(source(), '2026-10-20'));
  assert.deepEqual(plain(r2.plans.tabs.find(t => t.tab === '11月')), { tab: '11月', month: '2026-11', legacy: false, days: 3, people: 4, closedDays: 1, events: 3, skipped: 4, expected: 0 });
  assert.equal(env.ss.getSheetByName('営業日').dump().length, daysCount);
  assert.equal(events(env).length, evCount);
  // アプリで 11/10 のシフトを直す → 次の取り込みでは飛ばす
  sync('days', '2026-11-10', { bizDate: '2026-11-10', shiftPlan: '岡本' });
  const r3 = plain(env.gas.reimportLegacy_(source(), '2026-10-20'));
  assert.equal(r3.plans.tabs.find(t => t.tab === '11月').skipped, 5);
  assert.equal(days(env)['2026-11-10']['シフト予定'], '岡本');
  assert.equal(events(env).filter(e => e['日付'] === '2026-11-10' && e['状態'] === '有効').length, 2); // 取り込んだイベントも、そのまま
  // 管理シートで 11/1 のイベントを消す → 取り込んだだけの予定は削除になる
  env.gas.reimportLegacy_(source({ nov1Event: '' }), '2026-10-20');
  assert.equal(events(env).find(e => e['ID'] === 'lg-2026-11-01-日本酒の会')['状態'], '削除');
  assert.equal(env.ss.getSheetByName('11月').getRange(2, 7).getValue(), '');
});

test('管理シートの月のタブの名前：今月の2か月前〜2か月先で探す（2027年は「1月」「2027年1月」のどちらでも）', () => {
  const env = boot('2026-12-20T14:00:00+09:00');
  const src = makeSpreadsheet({ '9月': [head('8月'), ['合計']], '10月': [head('10月'), ['合計']], '1月': [head('1月'), row(4, '月', ['岡本', '', '', '']), ['合計']] });
  const tabs = env.gas.legacyPlanTabs_(src, env.gas.getSettings_()).map(t => [t.tab, t.month, t.legacy, !!t.sheet]);
  assert.deepEqual(plain(tabs), [['9月', '2026-09', true, true], ['10月', '2026-10', true, true], ['1月', '2027-01', false, true]]);
  env.gas.importLegacyPlans_(src);
  assert.equal(days(env)['2027-01-04']['シフト予定'], '岡本');
});
