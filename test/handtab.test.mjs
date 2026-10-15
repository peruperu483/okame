// 月のタブを「アプリ」と「手打ち」に分ける（突き合わせのタブはやめた）。スプシで打った予定の取りこぼしを拾う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now = '2026-10-20T10:00:00+09:00', opts = {}) {
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
const names = env => env.sheets.map(s => s.name);
const days = env => Object.fromEntries(env.ss.getSheetByName('営業日').dump().map(r => [String(r['ID']), r]));
const logCount = (env, type) => env.ss.getSheetByName('操作履歴').dump().filter(r => r['種別'] === type).length;
function typeCells(env, name, row, col, rows2d) {
  const sh = env.ss.getSheetByName(name);
  const range = sh.getRange(row, col, rows2d.length, rows2d[0].length);
  range.setValues(rows2d);
  env.gas.handleSheetEdit({ range });
}

test('初期設定で「11月（手打ち）」が1回だけでき、アプリのタブは「11月（アプリ）」として隣に並ぶ', () => {
  const env = boot('2026-10-20T10:00:00+09:00', { handTab: true });
  const hand = env.ss.getSheetByName('11月（手打ち）');
  assert.ok(hand, '手打ちのタブ');
  assert.equal(hand.protection, undefined, '保護しない');
  assert.equal(hand.hidden, false);
  assert.ok(env.logs.join('\n').includes('「11月（手打ち）」のタブを作りました'));
  // 管理シートと同じ列（月のひな形のコピー）。日付と曜日だけ入る
  const v = hand.getRange(1, 1, 34, 18).getValues();
  assert.equal(v[0][0], '11月（手打ち）');
  assert.equal(v[0][7], '加奈');
  assert.equal(v[0][17], '保険');
  assert.deepEqual([v[1][0], v[1][1]], [1, '日']);
  assert.deepEqual([v[30][0], v[30][1]], [30, '月']);
  assert.deepEqual([v[31][0], v[31][1]], ['', '']); // 11月は30日まで
  assert.equal(v[1][9], ''); // 金額は空
  assert.equal(v[32][7], '=SUM(H2:H32)'); // 合計の行
  // 一番下に「アプリとの差」（月の合計どうし。アプリのタブは見込みの列の分、1つ右）
  assert.match(v[33][0], /アプリとの差/);
  assert.equal(v[33][7], `=IFERROR(INDIRECT("'11月（アプリ）'!I33")-H33,"")`);
  assert.equal(v[33][17], `=IFERROR(INDIRECT("'11月（アプリ）'!S33")-R33,"")`);
  assert.equal(hand.bgs.get('34:8'), undefined, '色は付けない');

  // 来月のタブは「11月（アプリ）」の名前で作られ、手打ちのタブの左隣に並ぶ
  env.gas.createNextMonthTab_();
  assert.ok(env.ss.getSheetByName('11月（アプリ）'));
  assert.equal(env.ss.getSheetByName('11月'), null);
  const order = names(env).filter(n => n.startsWith('11月'));
  assert.deepEqual(order, ['11月（アプリ）', '11月（手打ち）']);

  // 何度初期設定をしても1つ。消したあとに初期設定をしても作り直さない
  env.gas.setup();
  assert.equal(names(env).filter(n => n === '11月（手打ち）').length, 1);
  env.ss.deleteSheet(hand);
  env.gas.setup();
  assert.equal(env.ss.getSheetByName('11月（手打ち）'), null);
});

test('アプリは手打ちのタブに書き込まない。手打ちのタブで打っても、アプリの予定には入らない', () => {
  const env = boot('2026-10-20T10:00:00+09:00', { handTab: true });
  env.gas.createNextMonthTab_();
  const mgrToken = env.login();
  // 店長が手打ちのタブに打つ
  typeCells(env, '11月（手打ち）', 3, 3, [['岡本', '加奈']]);
  env.ss.getSheetByName('11月（手打ち）').getRange(3, 10).setValue(12345);
  assert.equal(days(env)['2026-11-02'], undefined, '手打ちのタブはアプリに入れない');
  // 運用開始後の閉店：アプリのタブだけが書き換わる
  env.setNow('2026-11-02T23:00:00+09:00');
  const r = env.call('sync', { mgrToken, ops: [
    { opId: 'o1', table: 'visits', id: 'v1', data: { bizDate: '2026-11-02', no: 1, people: 2, kind: '飲み放題', status: '退店', base: 6000, extras: [], pays: [{ id: 'p', method: '現金', amount: 6000 }], total: 6000, cash: 6000 } },
    { opId: 'o2', table: 'closings', id: '2026-11-02', data: { bizDate: '2026-11-02', countedCash: 6000 } }
  ] });
  assert.ok(r.results.every(x => x.ok));
  assert.equal(env.ss.getSheetByName('11月（アプリ）').getRange(3, 11).getValue(), 6000); // アプリの現金（K）
  const hand = env.ss.getSheetByName('11月（手打ち）');
  assert.equal(hand.getRange(3, 10).getValue(), 12345); // 手打ちはそのまま
  assert.equal(hand.getRange(3, 3).getValue(), '岡本');
  assert.equal(env.ss.getSheetByName('11月'), null);
});

test('アプリのタブがあとから「（アプリ）」になっても、スプシで打った予定はアプリに入る', () => {
  const env = boot();
  env.gas.createNextMonthTab_();
  assert.ok(env.ss.getSheetByName('11月'));
  assert.equal(env.gas.createHandTab_('2026-11'), '11月（手打ち）');
  assert.equal(env.gas.createHandTab_('2026-11'), null); // 2回目は作らない
  const app = env.ss.getSheetByName('11月（アプリ）');
  assert.ok(app);
  assert.equal(app.getRange(1, 1).getValue(), '11月（アプリ）');
  assert.deepEqual(names(env).filter(n => n.startsWith('11月')), ['11月（アプリ）', '11月（手打ち）']);
  typeCells(env, '11月（アプリ）', 3, 3, [['岡本', '加奈']]);
  assert.equal(days(env)['2026-11-02']['シフト予定'], '岡本、加奈');
  assert.match(env.props.get('SHEET_EDIT_LAST'), /アプリに入れました/);
  // アプリの予定を直すと、改名したタブに出る（「11月」を作り直さない）
  const mgrToken = env.login();
  env.call('sync', { mgrToken, ops: [{ opId: 'd1', table: 'days', id: '2026-11-03', data: { bizDate: '2026-11-03', shiftPlan: '優輝' } }] });
  assert.equal(app.getRange(4, 3).getValue(), '優輝');
  assert.equal(env.ss.getSheetByName('11月'), null);
});

test('編集のトリガーが動かなくても、アプリが予定を読むときに、スプシで打った予定を拾う（1分に1回まで）', () => {
  const env = boot();
  env.gas.createNextMonthTab_();
  // トリガーなしで打った（値だけ変わる）
  env.ss.getSheetByName('11月').getRange(3, 3, 1, 2).setValues([['岡本', '加奈']]);
  assert.equal(days(env)['2026-11-02'], undefined);
  const r = env.call('fetch', { table: 'days', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.status, 'ok');
  assert.equal(days(env)['2026-11-02']['シフト予定'], '岡本、加奈');
  assert.ok(r.rows.some(x => x.id === '2026-11-02' && x.shiftPlan === '岡本、加奈'), 'その読み込みの返事に入っている');
  assert.equal(logCount(env, 'スプシから予定を直す'), 1);
  // 1分以内は見ない
  env.ss.getSheetByName('11月').getRange(4, 3).setValue('優輝');
  env.call('fetch', { table: 'events' });
  assert.equal(days(env)['2026-11-03'], undefined);
  // 1分たつと拾う。前に拾った行を、もう一度は入れない
  env.cache.delete('sheetCatchUp');
  env.call('fetch', { table: 'events' });
  assert.equal(days(env)['2026-11-03']['シフト予定'], '優輝');
  assert.equal(logCount(env, 'スプシから予定を直す'), 2);
  // ほかの表の読み込みでは見ない
  env.cache.delete('sheetCatchUp');
  env.ss.getSheetByName('11月').getRange(5, 3).setValue('加奈');
  env.call('fetch', { table: 'visits' });
  assert.equal(days(env)['2026-11-04'], undefined);
});

test('メニュー「スプシで打った予定の取り込みを確かめる」：トリガーがなければ作り、取りこぼしを入れる', () => {
  const env = boot();
  env.gas.createNextMonthTab_();
  env.triggers.splice(0, env.triggers.length); // トリガーがない状態
  env.ss.getSheetByName('11月').getRange(3, 3).setValue('岡本');
  env.logs.length = 0;
  env.gas.checkSheetSync();
  const out = env.logs.join('\n');
  assert.match(out, /編集のトリガー：ありませんでした/);
  assert.match(out, /トリガー）を設定しました/);
  assert.match(out, /まだ記録がありません/);
  assert.match(out, /1行を、いまアプリに入れました/);
  assert.ok(env.triggers.some(t => t.fn === 'handleSheetEdit'));
  assert.equal(days(env)['2026-11-02']['シフト予定'], '岡本');
  // トリガーが動いたあとは、最後に動いたときが出る
  typeCells(env, '11月', 4, 3, [['加奈']]);
  env.logs.length = 0;
  env.gas.checkSheetSync();
  assert.match(env.logs.join('\n'), /編集のトリガー：あります[\s\S]*最後に動いたとき：.*11月.*アプリに入れました[\s\S]*入っていない打ち込みは、ありませんでした/);
});

test('前の版の「突き合わせ」のタブは、初期設定で消える', () => {
  const env = boot();
  env.ss.insertSheet('突き合わせ');
  env.gas.setup();
  assert.equal(env.ss.getSheetByName('突き合わせ'), null);
});

test('手打ちのタブの月の読み取り', () => {
  const env = loadGas(CODE);
  const p = (t, now = '2026-10') => env.gas.parseMonthInput_(t, now);
  assert.equal(p('12月'), '2026-12');
  assert.equal(p('１２月'), '2026-12');
  assert.equal(p('1'), '2027-01');
  assert.equal(p('10月'), '2026-10');
  assert.equal(p('2027-03'), '2027-03');
  assert.equal(p('2027年3月'), '2027-03');
  assert.equal(p('13月'), null);
  assert.equal(p('あ'), null);
});
