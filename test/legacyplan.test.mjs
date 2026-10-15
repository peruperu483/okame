// 「ラスト」をなくす（前の版のタブ・ひな形・営業日の表から消す）。管理シート（9月・10月）のシフトとイベントを、アプリの予定に入れる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now = '2026-10-16T14:00:00+09:00', opts = {}) {
  const env = loadGas(CODE, opts);
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

// 管理シートのまね（名前と予定はテスト用。金額の列は空）
function source({ sepEvent4 = '6名団体', octShift31 = ['岡本', '加奈', '', ''] } = {}) {
  const head9 = ['8月', '列 1', '列 2', '列 3', '列 ４', '列 ', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上'];
  const head10 = ['10月', '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上'];
  const row = (d, dow, shift, ev = '') => [d, dow, ...shift, ev, ...blank(3)];
  const sep = [head9,
    row(1, '火', ['加奈', '', '', '']),
    row(4, '金', ['岡本', '', '', ''], sepEvent4),
    row(6, '日', ['店休日', '', '', '']),
    row(18, '金', ['岡本', '加奈', '', '優輝']), // 4つ目の列（F）も取り込む
    row(23, '水', ['店休日', '', '', ''], 'ユーワード、倫理キックオフ'), // 店休日でもイベントはある
    row(30, '水', ['', '', '', '']), // 空の日
    ['合計']];
  const oct = [head10,
    row(2, '金', ['岡本', '加奈', '優輝', ''], 'おかめでナイト'),
    row(16, '金', ['岡本', '優輝', '', ''], '1日ママ'),
    row(31, '土', octShift31, '日本酒の会'), // 今日より先の日も、予定として入れる
    ['合計']];
  return makeSpreadsheet({ '9月': sep, '10月': oct });
}
const days = env => Object.fromEntries(env.ss.getSheetByName('営業日').dump().map(r => [String(r['ID']), r]));
const events = env => env.ss.getSheetByName('予定').dump();

test('管理シートの9月・10月のシフト（C〜Fの4列すべて）とイベントを、アプリの予定に入れる。金額は入れない', () => {
  const env = boot();
  const r = plain(env.gas.importLegacyPlans_(source()));
  assert.deepEqual(r.tabs, [
    { tab: '9月', days: 5, people: 5, closedDays: 2, events: 3 },
    { tab: '10月', days: 3, people: 7, closedDays: 0, events: 3 }
  ]);
  assert.deepEqual([r.days, r.people, r.closedDays, r.events, r.removed], [8, 12, 2, 6, 0]);
  const d = days(env);
  assert.equal(d['2026-09-18']['シフト予定'], '岡本、加奈、優輝');
  assert.equal(d['2026-09-06']['店休日'], true);
  assert.equal(d['2026-09-06']['シフト予定'], '');
  assert.equal(d['2026-10-02']['シフト予定'], '岡本、加奈、優輝');
  assert.equal(d['2026-10-31']['シフト予定'], '岡本、加奈'); // 先の日
  assert.equal(d['2026-09-30'], undefined); // 空の日は作らない
  assert.equal(d['2026-10-02']['メモ'], '管理シートの予定から');
  const ev = events(env).map(e => [e['日付'], e['内容'], e['種類'], e['状態'], e['見込みの金額']]);
  assert.deepEqual(ev.sort(), [
    ['2026-09-04', '6名団体', '団体', '有効', ''],
    ['2026-09-23', 'ユーワード', '団体', '有効', ''],
    ['2026-09-23', '倫理キックオフ', '団体', '有効', ''],
    ['2026-10-02', 'おかめでナイト', '団体', '有効', ''],
    ['2026-10-16', '1日ママ', '団体', '有効', ''],
    ['2026-10-31', '日本酒の会', '団体', '有効', '']
  ]);
  // アプリからも読める（今日の予定・予定の画面）
  assert.ok(env.call('fetch', { table: 'events', from: '2026-10-16', to: '2026-10-16' }).rows.some(e => e.title === '1日ママ'));
  assert.ok(env.ss.getSheetByName('操作履歴').dump().some(x => x['種別'] === '管理シートの予定を取り込む'));
});

test('何度実行しても二重にならない。管理シートで消えたイベントは削除、変わったシフトは直る', () => {
  const env = boot();
  env.gas.importLegacyPlans_(source());
  env.gas.importLegacyPlans_(source());
  assert.equal(events(env).length, 6);
  assert.equal(env.ss.getSheetByName('営業日').dump().length, 8);
  // アプリで人数を足した予定は、取り込み直しても人数が残る
  env.call('sync', { mgrToken: env.login(), ops: [{ opId: 'x', table: 'events', id: 'lg-2026-10-31-日本酒の会', data: { people: 12 } }] });
  const r = plain(env.gas.importLegacyPlans_(source({ sepEvent4: '', octShift31: ['岡本', '', '', ''] })));
  assert.equal(r.removed, 1);
  const ev = Object.fromEntries(events(env).map(e => [e['ID'], e]));
  assert.equal(ev['lg-2026-09-04-6名団体']['状態'], '削除');
  assert.equal(ev['lg-2026-10-31-日本酒の会']['人数'], 12);
  assert.equal(events(env).length, 6);
  assert.equal(days(env)['2026-10-31']['シフト予定'], '岡本');
});

test('9月・10月の予定を入れても、売上・月次・カウンターの数字は変わらない。「テストの行を消す」で消えない', () => {
  const env = boot();
  const mgrToken = env.login();
  const before = plain(env.call('monthly', { mgrToken, month: '2026-10' }).summary);
  const cBefore = plain(env.call('countdown', { mgrToken, month: '2026-10' }));
  env.gas.importLegacyPlans_(source());
  const after = plain(env.call('monthly', { mgrToken, month: '2026-10' }).summary);
  const cAfter = plain(env.call('countdown', { mgrToken, month: '2026-10' }));
  for (const k of ['sales', 'cash', 'event', 'eventGroups', 'openDays', 'closedDays', 'plannedEvents', 'profit']) assert.equal(after[k], before[k], k);
  assert.deepEqual([cAfter.confirmed, cAfter.expected], [cBefore.confirmed, cBefore.expected]);
  // 試運転の営業日の行（取り込みでないもの）は消える。取り込んだ行は残る
  env.call('sync', { mgrToken, ops: [{ opId: 't', table: 'days', id: '2026-10-14', data: { bizDate: '2026-10-14', openCash: 30000 } }] });
  env.gas.deleteTestRows_();
  const d = days(env);
  assert.equal(d['2026-10-14'], undefined);
  assert.equal(d['2026-10-02']['シフト予定'], '岡本、加奈、優輝');
  assert.equal(events(env).filter(e => e['状態'] === '有効').length, 6);
});

test('前の版の「ラスト」の列（月のタブ・ひな形・営業日の表）は、初期設定で消え、ほかの列はずれない', () => {
  const env = boot('2026-10-20T10:00:00+09:00');
  env.gas.createNextMonthTab_();
  // 前の版のまね：T に「ラスト」、打てる範囲に T、営業日の表にラストの列
  const tab = env.ss.getSheetByName('11月');
  tab.getRange(1, 20).setValue('ラスト');
  tab.getRange(3, 20).setValue('加奈');
  tab.getRange(33, 19).setValue('=SUM(S2:S32)');
  tab.protection.setUnprotectedRanges([tab.getRange(2, 3, 31, 6), tab.getRange(2, 20, 31, 1)]);
  const tpl = env.ss.getSheetByName('シフト表のひな形');
  tpl.getRange(1, 20).setValue('ラスト');
  const daySheet = env.ss.getSheetByName('営業日');
  const head = daySheet.getRange(1, 1, 1, daySheet.getLastColumn()).getValues()[0];
  daySheet.getRange(1, head.length + 1, 1, 2).setValues([['ラスト予定', 'ラスト実績']]);
  daySheet.getRange(2, 1).setValue('2026-11-02');
  daySheet.getRange(2, head.length + 1).setValue('加奈');
  env.gas.setup();
  assert.equal(tab.getRange(1, 20).getValue(), '');
  assert.equal(tab.getRange(3, 20).getValue(), '');
  assert.equal(tab.getRange(1, 19).getValue(), '保険'); // 右端は保険のまま
  assert.equal(tab.getRange(1, 8).getValue(), '見込み');
  assert.equal(tab.getRange(33, 19).getValue(), '=SUM(S2:S32)');
  assert.deepEqual(plain(tab.protection.getUnprotectedRanges().map(r => [r.r, r.c, r.nr, r.nc])), [[2, 3, 31, 6]]);
  assert.equal(tpl.getRange(1, 20).getValue(), '');
  const head2 = daySheet.getRange(1, 1, 1, daySheet.getLastColumn()).getValues()[0];
  assert.ok(!head2.includes('ラスト予定') && !head2.includes('ラスト実績'));
  assert.deepEqual(head2.slice(0, head.length), head); // ほかの列はそのまま
  // 覚えている内容は6列（C〜H）
  assert.equal(JSON.parse(env.props.get('PLANSNAP:2026-11'))[0].length, 6);
  // 手打ちのタブのアプリとの差は、アプリのタブの I〜S のまま
  env.gas.createHandTab_('2026-11');
  assert.equal(env.ss.getSheetByName('11月（手打ち）').getRange(34, 18).getValue(), `=IFERROR(INDIRECT("'11月（アプリ）'!S33")-R33,"")`);
});
