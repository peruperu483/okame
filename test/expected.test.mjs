// 管理シートの見込み：まだ来ていない日の「団体売上」に書いてある金額（合計）を、その日の最初のイベントの見込みにする
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

// 管理シートのまね（数字はテスト用）。10月は「団体及びイベント」、11月は見出しが「列 7」（本物の11月と同じ）
const head10 = ['10月', '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上'];
const head11 = ['11月', '列 1', '列 2', '列 3', '列 ４', '列 ', '列 7', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', '食品\n支出'];
const row = (d, dow, shift, ev, kana, cash, group) => [d, dow, ...shift, ev, kana, '', cash, group, ''];
function source({ oct31 = 210000 } = {}) {
  const oct = [head10,
    row(11, '日', ['岡本', '', '', ''], '講演会', 0, 0, 192500), // 過ぎた日：団体売上は実績（見込みにしない）
    row(20, '火', ['加奈', '', '', ''], '', 13000, '', ''), // 加奈の見込みの人件費（見込みにしない）
    row(23, '金', ['岡本', '加奈', '', ''], '病院・消防', 12000, '', 250000),
    row(31, '土', ['岡本', '', '', ''], '日本酒の会、二次会', '', '', oct31), // 2つあっても、最初のイベントに
    ['合計']];
  const nov = [head11,
    row(7, '土', ['岡本', '', '', ''], '１日ママ', '', '', ''),
    row(21, '土', ['岡本', '', '', ''], 'おかめでナイト', '', '', 60000),
    row(28, '土', ['岡本', '', '', ''], '日本酒の会', '', '', 180000),
    row(29, '日', ['加奈', '', '', ''], '', '', '', 40000), // イベントの名前がない日：「イベント」を足す
    ['合計']];
  return makeSpreadsheet({ '9月': [head10, ['合計']], '10月': oct, '11月': nov });
}
const ev = env => Object.fromEntries(env.ss.getSheetByName('予定').dump().filter(e => e['状態'] === '有効').map(e => [e['日付'] + ' ' + e['内容'], e['見込みの金額']]));

test('まだ来ていない日の団体売上を、その日の最初のイベントの見込みにする。過ぎた日・人件費は見込みにしない', () => {
  const env = boot();
  const r = plain(env.gas.reimportLegacy_(source(), '2026-10-20'));
  const e = ev(env);
  assert.equal(e['2026-10-11 講演会'], ''); // 過ぎた日
  assert.equal(e['2026-10-23 病院・消防'], 250000);
  assert.equal(e['2026-10-31 日本酒の会'], 210000);
  assert.equal(e['2026-10-31 二次会'], ''); // 2つ目のイベントには入れない
  assert.equal(e['2026-11-07 １日ママ'], ''); // 11月の「列 7」の見出しでも、イベントを読む
  assert.equal(e['2026-11-21 おかめでナイト'], 60000);
  assert.equal(e['2026-11-28 日本酒の会'], 180000);
  assert.equal(e['2026-11-29 イベント'], 40000);
  assert.equal(r.plans.tabs.find(t => t.tab === '10月').expected, 250000 + 210000);
  assert.equal(r.plans.tabs.find(t => t.tab === '11月').expected, 60000 + 180000 + 40000);
  // カウンター：10月の見込みは、まだ来ていない日のイベントの見込みの合計
  const mgrToken = env.login();
  assert.equal(env.call('countdown', { mgrToken, month: '2026-10' }).expected, 460000);
  assert.equal(env.call('countdown', { mgrToken, month: '2026-11' }).expected, 280000);
  // 表示
  const msg = env.gas.reimportMessage_(r);
  assert.match(msg, /■ 10月[\s\S]*見込みの合計：¥460,000/);
  assert.match(msg, /■ 11月（予定だけ[\s\S]*見込みの合計：¥280,000/);
  // 10月のタブ・月次の売上には、先の日の団体売上は入らない（金額は今日まで）
  assert.equal(r.money.find(x => x.tab === '10月').sales, 192500);
});

test('見込み：何度実行しても二重にならない。管理シートで消した見込みは消える。入店して確定したら外れる', () => {
  const env = boot();
  const mgrToken = env.login();
  env.gas.reimportLegacy_(source(), '2026-10-20');
  env.gas.reimportLegacy_(source(), '2026-10-20');
  assert.equal(env.call('countdown', { mgrToken, month: '2026-10' }).expected, 460000);
  env.gas.reimportLegacy_(source({ oct31: '' }), '2026-10-20');
  assert.equal(ev(env)['2026-10-31 日本酒の会'], '');
  assert.equal(env.call('countdown', { mgrToken, month: '2026-10' }).expected, 250000);
  // 11/21 のイベントの組が退店したら、その見込みは外れる（11月になってから）
  env.setNow('2026-11-21T23:00:00+09:00');
  env.call('sync', { mgrToken, ops: [{ opId: 'v', table: 'visits', id: 'v1', data: { bizDate: '2026-11-21', no: 1, people: 20, kind: 'イベント', name: 'おかめでナイト', eventId: 'lg-2026-11-21-おかめでナイト', status: '退店', base: 65000, extras: [], pays: [{ id: 'p', method: '現金', amount: 65000 }], total: 65000, cash: 65000 } }] });
  const c = env.call('countdown', { mgrToken, month: '2026-11' });
  assert.equal(c.expected, 180000 + 40000);
  assert.equal(c.confirmed, 65000);
});

test('見込み：アプリや「11月（アプリ）」で見込みを直した日は、上書きしない', () => {
  const env = boot();
  const mgrToken = env.login();
  env.gas.createNextMonthTab_(); // 「11月」のタブ（アプリ）
  env.gas.reimportLegacy_(source(), '2026-10-20');
  // アプリで 11/28 の見込みを直す
  env.call('sync', { mgrToken, ops: [{ opId: 'x', table: 'events', id: 'lg-2026-11-28-日本酒の会', data: { expectedAmount: 150000 } }] });
  // アプリのタブで 11/21 の見込み（H）を直す
  const range = env.ss.getSheetByName('11月').getRange(22, 8);
  range.setValue(70000);
  env.gas.handleSheetEdit({ range });
  const r = plain(env.gas.reimportLegacy_(source(), '2026-10-20'));
  const e = ev(env);
  assert.equal(e['2026-11-28 日本酒の会'], 150000);
  assert.equal(e['2026-11-21 おかめでナイト'], 70000);
  assert.equal(r.plans.tabs.find(t => t.tab === '11月').skipped, 2);
  assert.equal(r.plans.tabs.find(t => t.tab === '11月').expected, 40000); // 飛ばした日の見込みは数えない
  // アプリのタブの見込みの欄にも出る
  assert.equal(env.ss.getSheetByName('11月').getRange(30, 8).getValue(), 40000); // 11/29
});
