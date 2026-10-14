import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot() {
  const env = loadGas(CODE);
  env.setNow('2026-10-20T20:00:00+09:00');
  env.gas.setup();
  const out = env.logs.join('\n');
  const token = out.match(/共有トークン：(\w+)/)[1];
  const pin = out.match(/初期の暗証番号：(\d+)/)[1];
  const call = (action, body = {}) => env.post({ token, deviceId: 'dev1', action, ...body });
  const login = () => call('login', { pin }).mgrToken;
  return { ...env, token, pin, call, login };
}

const visit = (id, extra = {}) => ({
  opId: 'op-' + id + '-' + Math.random(), table: 'visits', id,
  data: { bizDate: '2026-11-01', no: 1, name: '', people: 2, kind: '飲み放題', base: 6000, inAt: '2026-11-01T19:00:00+09:00',
    status: '店内', createdAt: '2026-11-01T19:00:00+09:00', updatedAt: '2026-11-01T19:00:00+09:00', ...extra }
});

test('初期設定でタブ・トークン・暗証番号ができ、2回実行しても増えない', () => {
  const env = boot();
  const names = env.sheets.map(s => s.name);
  for (const n of ['来客', '締め', 'レジの出し入れ', '営業日', 'スタッフ', '勤怠', '仕入れ', '固定費', '予定', '希望休', '操作履歴', '設定']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('シート1'));
  const settingsRows = env.ss.getSheetByName('設定').dump().length;
  env.gas.setup();
  assert.equal(env.ss.getSheetByName('設定').dump().length, settingsRows);
  assert.equal(env.props.get('SHARED_TOKEN'), env.token);
  assert.match(env.pin, /^\d{4}$/);
});

test('トークンがないと何もできない', () => {
  const env = boot();
  const r = env.post({ action: 'bootstrap' });
  assert.equal(r.status, 'error');
  assert.equal(r.code, 'unauthorized');
});

test('bootstrapで設定の初期値が返る', () => {
  const env = boot();
  const r = env.call('bootstrap');
  assert.equal(r.status, 'ok');
  assert.equal(r.settings.nomiPrice, 3000);
  assert.equal(r.settings.pointCountsAsSales, true);
  assert.equal(r.mgr, false);
});

test('同じものを何度送っても1件。日付は文字のまま残る', () => {
  const env = boot();
  const op = visit('v1');
  env.call('sync', { ops: [op] });
  const r = env.call('sync', { ops: [op] });
  assert.ok(r.results[0].ok);
  const rows = env.ss.getSheetByName('来客').dump();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['営業日'], '2026-11-01');
  assert.equal(typeof rows[0]['入店時刻'], 'string');
  assert.equal(rows[0]['人数'], 2);
  assert.equal(rows[0]['端末'], 'dev1');
});

test('一部だけ送ると他の項目は残る。古い更新は無視して今の値を返す', () => {
  const env = boot();
  env.call('sync', { ops: [visit('v1')] });
  env.call('sync', { ops: [{ opId: 'a', table: 'visits', id: 'v1', data: { status: '退店', total: 6000, pays: [{ id: 'p1', method: '現金', amount: 6000 }], cash: 6000, updatedAt: '2026-11-01T21:00:00+09:00' } }] });
  let row = env.call('fetch', { table: 'visits' }).rows[0];
  assert.equal(row.status, '退店');
  assert.equal(row.people, 2);
  assert.equal(row.total, 6000);
  assert.deepEqual(row.pays, [{ id: 'p1', method: '現金', amount: 6000 }]);
  const r = env.call('sync', { ops: [{ opId: 'b', table: 'visits', id: 'v1', data: { status: '店内', updatedAt: '2026-11-01T20:00:00+09:00' } }] });
  assert.equal(r.results[0].stale, true);
  assert.equal(r.results[0].current.status, '退店');
  row = env.call('fetch', { table: 'visits' }).rows[0];
  assert.equal(row.status, '退店');
});

test('同じ送信の中で新しい行を2回更新しても1件', () => {
  const env = boot();
  env.call('sync', { ops: [visit('v9'), { opId: 'x', table: 'visits', id: 'v9', data: { people: 5 } }] });
  const rows = env.call('fetch', { table: 'visits' }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].people, 5);
});

test('期間で絞り込める', () => {
  const env = boot();
  env.call('sync', { ops: [visit('a', { bizDate: '2026-10-31' }), visit('b', { bizDate: '2026-11-01' }), visit('c', { bizDate: '2026-11-02' })] });
  const rows = env.call('fetch', { table: 'visits', from: '2026-11-01', to: '2026-11-01' }).rows;
  assert.deepEqual(rows.map(r => r.id), ['b']);
});

test('シートの行数を超えても書ける', () => {
  const env = boot();
  const ops = Array.from({ length: 1200 }, (_, i) => visit('v' + i));
  env.call('sync', { ops });
  assert.equal(env.ss.getSheetByName('来客').dump().length, 1200);
  assert.equal(env.ss.getSheetByName('来客').dump()[1100]['営業日'], '2026-11-01');
});

test('暗証番号：違うと入れず、5回間違えると止まる。合えば店長になる', () => {
  const env = boot();
  const wrong = env.pin === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) assert.equal(env.call('login', { pin: wrong }).code, 'wrong_pin');
  assert.equal(env.call('login', { pin: env.pin }).code, 'locked');
  env.cache.delete('pinfail');
  const mgrToken = env.login();
  assert.ok(mgrToken);
  assert.equal(env.call('bootstrap', { mgrToken }).mgr, true);
  env.call('logout', { mgrToken });
  assert.equal(env.call('bootstrap', { mgrToken }).mgr, false);
});

test('勤怠・仕入れ・固定費は店長だけが読み書きできる。設定の保存も店長だけ', () => {
  const env = boot();
  const mgrToken = env.login();
  const att = { opId: 'w', table: 'attendance', id: 'a1', data: { bizDate: '2026-11-01', name: '加奈', hours: 5, wage: 2000, cost: 10000 } };
  for (const table of ['attendance', 'purchases', 'fixedCosts']) assert.equal(env.call('fetch', { table }).code, 'forbidden', table);
  assert.equal(env.call('sync', { ops: [att] }).results[0].code, 'forbidden');
  assert.equal(env.call('sync', { mgrToken, ops: [att] }).results[0].ok, true);
  assert.equal(env.call('fetch', { table: 'attendance', mgrToken }).rows.length, 1);
  assert.equal(env.call('saveSettings', { settings: { nomiPrice: 3500 } }).code, 'need_mgr');
  env.call('saveSettings', { mgrToken, settings: { nomiPrice: 3500 } });
  const log = env.call('fetch', { table: 'log', mgrToken }).rows;
  assert.equal(log[0].type, '設定の変更');
  assert.equal(log[0].by, '店長');
});

test('時給と交通費はバイトに返らない。スタッフの登録は店長だけ', () => {
  const env = boot();
  const mgrToken = env.login();
  const staff = { opId: 's', table: 'staff', id: 's1', data: { name: '加奈', wage: 2200, transport: 2000, active: true } };
  assert.equal(env.call('sync', { ops: [staff] }).results[0].code, 'forbidden');
  env.call('sync', { mgrToken, ops: [staff] });
  assert.equal(env.call('fetch', { table: 'staff', mgrToken }).rows[0].wage, 2200);
  const row = env.call('fetch', { table: 'staff' }).rows[0];
  assert.equal(row.name, '加奈');
  assert.equal('wage' in row, false);
  assert.equal('transport' in row, false);
  assert.equal(row.active, true);
});

test('幹事の連絡先：隠すとバイトには返らず、バイトが予定を直しても消えない', () => {
  const env = boot();
  const mgrToken = env.login();
  env.call('sync', { ops: [{ opId: 'e', table: 'events', id: 'e1', data: { date: '2026-11-08', type: '団体', title: '町内会', contactName: '佐藤', contactInfo: '090-0000-0000' } }] });
  env.call('saveSettings', { mgrToken, settings: { visibility: { eventContact: false } } });
  const row = env.call('fetch', { table: 'events' }).rows[0];
  assert.equal('contactInfo' in row, false);
  env.call('sync', { ops: [{ opId: 'e2', table: 'events', id: 'e1', data: { people: 12, contactInfo: '' } }] });
  const full = env.call('fetch', { table: 'events', mgrToken }).rows[0];
  assert.equal(full.people, 12);
  assert.equal(full.contactInfo, '090-0000-0000');
});

test('操作履歴は追記だけ。操作者はGASが決める', () => {
  const env = boot();
  const mgrToken = env.login();
  const entry = { opId: 'l', table: 'log', id: 'l1', data: { at: '2026-11-01T22:00:00+09:00', type: '会計の取り消し', table: 'visits', targetId: 'v1', reason: '打ち間違い', by: '店長' } };
  env.call('sync', { ops: [entry] });
  env.call('sync', { ops: [{ ...entry, data: { ...entry.data, reason: '書き換え' } }] });
  const rows = env.call('fetch', { table: 'log', mgrToken }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, '打ち間違い');
  assert.equal(rows[0].by, 'スタッフ');
  assert.equal(env.call('fetch', { table: 'log' }).code, 'forbidden');
});

test('設定：形の違う値は保存しない。暗証番号を変えられる', () => {
  const env = boot();
  const mgrToken = env.login();
  assert.equal(env.call('saveSettings', { mgrToken, settings: { nomiPrice: 'たくさん' } }).code, 'bad_setting');
  assert.equal(env.call('saveSettings', { mgrToken, settings: { nomiPrice: 3500, unknownKey: 1 } }).settings.nomiPrice, 3500);
  assert.equal(env.call('changePin', { mgrToken, newPin: '12' }).code, 'bad_pin');
  assert.equal(env.call('changePin', { mgrToken, newPin: '2580' }).status, 'ok');
  assert.ok(env.call('login', { pin: '2580' }).mgrToken);
});

test('GETはpingだけ答え、データは返さない', () => {
  const env = boot();
  assert.equal(JSON.parse(env.gas.doGet({ parameter: { action: 'ping' } }).getContent()).status, 'ok');
  assert.equal(JSON.parse(env.gas.doGet({ parameter: {} }).getContent()).status, 'error');
});

test('バイトが直せるのはその営業日の記録だけ。店長はいつでも。範囲は設定で広げられる', () => {
  const env = boot();
  env.setNow('2026-11-02T01:00:00+09:00'); // 深夜1時は11/1の営業日
  const ok = r => r.results[0].ok;
  assert.equal(ok(env.call('sync', { ops: [visit('today', { bizDate: '2026-11-01' })] })), true);
  assert.equal(env.call('sync', { ops: [visit('old', { bizDate: '2026-10-31' })] }).results[0].code, 'forbidden');
  // 先の予定・希望休は入れられる
  assert.equal(ok(env.call('sync', { ops: [{ opId: 'e', table: 'events', id: 'e1', data: { date: '2026-11-20', type: '団体' } }] })), true);
  // 店長は前日の記録も直せる
  const mgrToken = env.login();
  assert.equal(ok(env.call('sync', { mgrToken, ops: [visit('old', { bizDate: '2026-10-31' })] })), true);
  // 店長が作った前日の記録を、バイトは直せない（日付を今日に書き換えてもだめ）
  assert.equal(env.call('sync', { ops: [{ opId: 'x', table: 'visits', id: 'old', data: { bizDate: '2026-11-01', total: 0 } }] }).results[0].code, 'forbidden');
  // 範囲を「1日前まで」に広げると直せる
  env.call('saveSettings', { mgrToken, settings: { staffEdit: { days: 1 } } });
  assert.equal(ok(env.call('sync', { ops: [{ opId: 'y', table: 'visits', id: 'old', data: { total: 3000 } }] })), true);
  // 表を外すと、その表はバイトが書けない
  env.call('saveSettings', { mgrToken, settings: { staffEdit: { tables: ['visits'] } } });
  assert.equal(env.call('sync', { ops: [{ opId: 'z', table: 'cashMoves', id: 'm1', data: { bizDate: '2026-11-01', type: '入金', amount: 500 } }] }).results[0].code, 'forbidden');
  // 仕入れ・勤怠は、範囲に関係なくバイトは書けない
  assert.equal(env.call('sync', { ops: [{ opId: 'p', table: 'purchases', id: 'p1', data: { date: '2026-11-01', amount: 500 } }] }).results[0].code, 'forbidden');
  assert.equal(env.call('sync', { ops: [{ opId: 'w', table: 'attendance', id: 'a1', data: { bizDate: '2026-11-01', hours: 3 } }] }).results[0].code, 'forbidden');
});

test('タブに保護がかかり、直接書き換えられるのは林だけ', () => {
  const env = boot();
  for (const name of ['来客', '締め', '設定', '操作履歴']) {
    const p = env.ss.getSheetByName(name).protection;
    assert.ok(p, name);
    assert.deepEqual([...p.editors], ['hayashi@example.com'], name);
    assert.equal(p.canDomainEdit(), false);
  }
});

test('レジからの出金は仕入れにも「レジから」で1件入る。消すと仕入れも削除。入金は仕入れに入らない', () => {
  const env = boot();
  const mgrToken = env.login();
  const out = (extra = {}) => ({ opId: 'o' + Math.random(), table: 'cashMoves', id: 'm1', data: {
    bizDate: '2026-11-01', at: '2026-11-01T19:30:00+09:00', type: '出金', amount: 3200, category: 'その他', note: '花',
    purchaseId: 'cm-m1', status: '有効', updatedAt: '2026-11-01T19:30:00+09:00', ...extra } });
  // バイトの出金でも写る（2回送っても1件）
  assert.equal(env.call('sync', { ops: [out()] }).results[0].ok, true);
  env.call('sync', { ops: [out()] });
  let rows = env.call('fetch', { table: 'purchases', mgrToken }).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].category, rows[0].note, rows[0].label, rows[0].amount, rows[0].paidFrom, rows[0].moveId, rows[0].status],
    ['cm-m1', 'その他', '花', 'その他（花）', 3200, 'レジから', 'm1', '有効']);
  // 金額を直すと仕入れも直る
  env.call('sync', { ops: [out({ amount: 3000, category: '飲食物', note: '', updatedAt: '2026-11-01T19:40:00+09:00' })] });
  rows = env.call('fetch', { table: 'purchases', mgrToken }).rows;
  assert.deepEqual([rows[0].amount, rows[0].label, rows[0].note], [3000, '飲食物', '']);
  // 出金を消すと仕入れも削除
  env.call('sync', { ops: [{ opId: 'd', table: 'cashMoves', id: 'm1', data: { status: '削除', updatedAt: '2026-11-01T20:00:00+09:00' } }] });
  rows = env.call('fetch', { table: 'purchases', mgrToken }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, '削除');
  // 入金は仕入れに入らない
  env.call('sync', { ops: [{ opId: 'i', table: 'cashMoves', id: 'm2', data: { bizDate: '2026-11-01', type: '入金', amount: 10000, reason: 'オーナーの補充' } }] });
  assert.equal(env.call('fetch', { table: 'purchases', mgrToken }).rows.length, 1);
  assert.equal(env.ss.getSheetByName('レジの出し入れ').dump().length, 2);
});
