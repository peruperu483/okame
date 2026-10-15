import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot() {
  const env = loadGas(CODE);
  env.setNow('2026-10-20T20:00:00+09:00');
  env.gas.setup();
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
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
  env.setSetting('managerFee', 180000); env.setSetting('defaultWage', 1500); // テスト用に作った金額（コードの初期値は0）
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

test('テストの行を消す：テストの名前・試運転の印・運用開始日より前の行だけ消し、ほかは残す', () => {
  const env = boot(); // 今は 2026-10-20
  const mgrToken = env.login();
  const ops = [
    visit('t1', { name: 'テストA1', bizDate: '2026-11-05', trial: false }),     // 名前がテスト → 消す
    visit('r1', { name: '佐藤', bizDate: '2026-11-05', trial: false }),         // 本番 → 残す
    visit('t2', { name: '', bizDate: '2026-10-30', trial: true }),              // 試運転 → 消す
    visit('r2', { name: '鈴木', bizDate: '2026-11-06', trial: false }),         // 本番 → 残す
    { opId: 'c1', table: 'closings', id: '2026-10-30', data: { bizDate: '2026-10-30', countedCash: 140900, trial: true } },
    { opId: 'c2', table: 'closings', id: '2026-11-05', data: { bizDate: '2026-11-05', countedCash: 30000, trial: false } },
    { opId: 'm1', table: 'cashMoves', id: 'm1', data: { bizDate: '2026-10-30', type: '出金', amount: 1500, category: '飲食物', status: '有効' } },
    { opId: 'm2', table: 'cashMoves', id: 'm2', data: { bizDate: '2026-11-05', type: '出金', amount: 2000, category: '備品', status: '有効' } },
    { opId: 'd1', table: 'days', id: '2026-10-30', data: { bizDate: '2026-10-30', openCash: 20000 } },
    { opId: 'd2', table: 'days', id: '2026-11-20', data: { bizDate: '2026-11-20', shiftPlan: '加奈' } },
    { opId: 'e1', table: 'events', id: 'e1', data: { date: '2026-10-30', type: '団体', title: '残す予定' } },
    { opId: 'e2', table: 'events', id: 'e2', data: { date: '2026-11-20', type: '団体', title: 'テスト会' } },
    { opId: 'a1', table: 'attendance', id: 'a1', data: { bizDate: '2026-10-30', name: '加奈', kind: '固定', hours: 5, cost: 10000 } },
    { opId: 'a2', table: 'attendance', id: 'a2', data: { bizDate: '2026-11-05', name: '加奈', kind: '固定', hours: 5, cost: 10000 } },
    { opId: 'f1', table: 'fixedCosts', id: '2026-10|家賃', data: { month: '2026-10', item: '家賃', amount: 100000 } },
    { opId: 'f2', table: 'fixedCosts', id: '2026-11|家賃', data: { month: '2026-11', item: '家賃', amount: 100000 } },
    { opId: 'l1', table: 'log', id: 'l1', data: { at: '2026-10-30T20:00:00+09:00', type: '会計の取り消し', reason: '打ち間違い' } },
    { opId: 'l2', table: 'log', id: 'l2', data: { at: '2026-11-05T20:00:00+09:00', type: '会計の取り消し', reason: '打ち間違い' } }
  ];
  for (const op of ops) env.call('sync', { mgrToken, ops: [op] });
  env.call('sync', { mgrToken, ops: [{ opId: 's', table: 'staff', id: 's1', data: { name: '加奈', wage: 2000, active: true } }] });
  env.call('sync', { mgrToken, ops: [{ opId: 's2', table: 'staff', id: 's2', data: { name: 'テスト太郎', wage: 2000, active: true } }] });

  const count = () => Object.fromEntries(env.gas.findTestRows_().map(f => [f.sheet, f.rows.length]));
  const before = count();
  assert.deepEqual(before, { '来客': 2, '締め': 1, 'レジの出し入れ': 1, '営業日': 1, '仕入れ': 1, '操作履歴': 1, '勤怠': 1, '固定費': 1, '予定': 1, '希望休': 0, 'スタッフ': 1 });

  const done = env.gas.deleteTestRows_();
  assert.equal(done.find(f => f.sheet === '来客').rows.length, 2);
  const names = env.ss.getSheetByName('来客').dump().map(r => r['名前']);
  assert.deepEqual(names, ['佐藤', '鈴木']);
  assert.deepEqual(env.ss.getSheetByName('締め').dump().map(r => r['営業日']), ['2026-11-05']);
  assert.deepEqual(env.ss.getSheetByName('レジの出し入れ').dump().map(r => r['ID']), ['m2']);
  assert.deepEqual(env.ss.getSheetByName('仕入れ').dump().map(r => r['ID']), ['cm-m2']);
  assert.deepEqual(env.ss.getSheetByName('営業日').dump().map(r => r['営業日']), ['2026-11-20']);
  assert.deepEqual(env.ss.getSheetByName('予定').dump().map(r => r['内容']), ['残す予定']);
  assert.deepEqual(env.ss.getSheetByName('スタッフ').dump().map(r => r['名前']), ['加奈']);
  assert.deepEqual(env.ss.getSheetByName('勤怠').dump().map(r => r['ID']), ['a2']);
  assert.deepEqual(env.ss.getSheetByName('固定費').dump().map(r => r['ID']), ['2026-11|家賃']);
  // 操作履歴：本番の日付の行は残り、最後に「消した」記録が1行増える（中身は各表の件数）
  const log = env.ss.getSheetByName('操作履歴').dump();
  assert.deepEqual(log.map(r => r['ID']), ['l2', log[1]['ID']]);
  assert.equal(log[1]['種別'], 'テストの行を消す');
  assert.equal(log[1]['操作者'], 'スプシのメニュー');
  assert.equal(JSON.parse(log[1]['変更後'])['来客'], 2);
  // 残った行はアプリから今までどおり読める・書ける
  assert.deepEqual(env.call('fetch', { table: 'visits' }).rows.map(r => r.name), ['佐藤', '鈴木']);
  assert.equal(env.call('sync', { ops: [visit('r3', { name: '高橋', bizDate: '2026-11-07' })] }).results[0].ok, true);
  // もう一度探すと、消した記録の1行（運用開始日より前）だけが出る
  assert.deepEqual(Object.values(count()).reduce((a, b) => a + b, 0), 1);
});

test('月次：退店した組・仕入れ・固定費・人件費から出す。試運転と運用開始日より前は数えない', () => {
  const env = boot();
  env.setNow('2026-11-30T20:00:00+09:00');
  const mgrToken = env.login();
  const v = (id, extra) => ({ opId: 'o' + id, table: 'visits', id, data: { bizDate: '2026-11-05', status: '退店', trial: false, ...extra } });
  const ops = [
    v('v1', { kind: '飲み放題', people: 2, total: 6000, cash: 6000 }),
    v('v2', { kind: 'イベント', people: 8, total: 40000, cash: 36000, point: 4000 }),
    v('v3', { kind: '単品', people: 1, total: 1500, cashless: 1500, bizDate: '2026-11-06' }),
    v('v4', { kind: '飲み放題', people: 3, total: 9000, cash: 9000, status: '店内' }),         // 店内は数えない
    v('v5', { kind: '飲み放題', people: 3, total: 9000, cash: 9000, trial: true }),           // 試運転は数えない
    v('v6', { kind: '飲み放題', people: 3, total: 9000, cash: 9000, bizDate: '2026-10-31' }), // 運用開始日より前
    { opId: 'c1', table: 'closings', id: '2026-11-05', data: { bizDate: '2026-11-05', sales: 46000, trial: false } },
    { opId: 'c2', table: 'closings', id: '2026-11-07', data: { bizDate: '2026-11-07', sales: 0, trial: false } },
    { opId: 'd1', table: 'days', id: '2026-11-10', data: { bizDate: '2026-11-10', closed: true } },
    { opId: 'p1', table: 'purchases', id: 'p1', data: { date: '2026-11-05', category: '飲食物', amount: 5000, status: '有効' } },
    { opId: 'p2', table: 'purchases', id: 'p2', data: { date: '2026-11-06', category: 'その他', note: '花', amount: 1000, status: '有効' } },
    { opId: 'p3', table: 'purchases', id: 'p3', data: { date: '2026-11-06', category: '備品', amount: 700, status: '削除' } },
    { opId: 'f1', table: 'fixedCosts', id: '2026-11|家賃', data: { month: '2026-11', item: '家賃', amount: 100000 } },
    { opId: 'a1', table: 'attendance', id: 'a1', data: { bizDate: '2026-11-05', staffId: 's1', name: '加奈', kind: '固定', hours: 5, wage: 2000, transport: 2000, cost: 12000 } },
    { opId: 'a2', table: 'attendance', id: 'a2', data: { bizDate: '2026-11-06', staffId: 's1', name: '加奈', kind: '固定', hours: 6.5, wage: 2000, transport: 0, cost: 13000 } },
    { opId: 'a3', table: 'attendance', id: 'a3', data: { bizDate: '2026-11-06', name: 'みか', kind: '手打ち', amount: 8000, cost: 8000 } },
    { opId: 'e1', table: 'events', id: 'e1', data: { date: '2026-11-05', type: '団体', title: '町内会' } }
  ];
  env.call('sync', { mgrToken, ops });
  assert.equal(env.call('monthly', { month: '2026-11' }).code, 'need_mgr');
  const r = env.call('monthly', { mgrToken, month: '2026-11' });
  const m = r.summary;
  assert.deepEqual([m.sales, m.guests, m.groups, m.cash, m.cashless, m.point], [47500, 11, 3, 6000, 1500, 0]);
  assert.deepEqual([m.nomi, m.tanpin, m.event, m.eventGroups], [6000, 1500, 40000, 1]);
  assert.deepEqual([m.openDays, m.closedDays, m.zeroDays], [3, 1, ['2026-11-07']]);
  assert.deepEqual(m.purchases, { '飲食物': 5000, '備品': 0, 'その他': 1000 });
  assert.deepEqual(m.otherNotes, ['花']);
  assert.deepEqual([m.fixedTotal, m.fixed['家賃']], [100000, 100000]);
  assert.deepEqual(m.laborFixed, [{ name: '加奈', days: 2, hours: 11.5, transport: 2000, cost: 25000 }]);
  assert.deepEqual(m.laborOthers, { cost: 8000, count: 1, names: ['みか'] });
  assert.equal(m.laborTotal, 33000);
  assert.equal(m.mgrFee, 180000); // 店長報酬（月額・設定）
  assert.equal(m.expenses, 5000 + 1000 + 100000 + 33000 + 180000);
  assert.equal(m.profit, 47500 - 319000);
  assert.equal(m.normalDailyAvg, Math.round((47500 - 40000) / 3));
  assert.equal(m.laborRate, 69.5);
  assert.equal(m.costRate, 10.5);
  assert.equal(m.plannedEvents, 1);
  assert.equal(r.prev.month, '2026-10');
  assert.equal(r.prev.sales, 0); // 10月は運用開始日より前（取り込みがまだなので0）

  // スプシの「月次」タブ：固定のスタッフは1人1行、ほかは「人件費（その他）」の1行、仕入れは科目ごと
  const built = env.call('buildMonthlySheet', { mgrToken });
  assert.deepEqual(built.months, ['2026-11']);
  const sh = env.ss.getSheetByName('月次');
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const row = label => (vals.find(r => r[0] === label) || [])[1];
  assert.equal(vals[0][1], '2026-11');
  assert.equal(row('売上'), 47500);
  assert.equal(row('　加奈'), 25000);
  assert.equal(row('　人件費（その他）'), 8000);
  assert.equal(row('　飲食物'), 5000);
  assert.equal(row('　その他の内容'), '花');
  assert.equal(row('　家賃'), 100000);
  assert.equal(row('店長報酬'), 180000);
  assert.equal(row('差し引き'), -271500);
  for (const gone of ['店休日', '売上0円の営業日', 'イベントの組数', '差し引き（店長報酬前）', '店長報酬（あとで）']) assert.ok(!vals.some(r => r[0] === gone), gone + 'は月次から消した');
  assert.ok(sh.protection);
});

test('月次：運用開始日より前の月は「過去の月次」タブ（管理シートの取り込み）から読む', () => {
  const env = boot();
  env.setNow('2026-11-30T20:00:00+09:00');
  const mgrToken = env.login();
  const sh = env.ss.insertSheet('過去の月次');
  sh.getRange(1, 1, 6, 3).setNumberFormats(Array.from({ length: 6 }, () => ['@', '@', '@']));
  sh.getRange(1, 1, 6, 3).setValues([
    ['項目', '2026-09', '2026-10'], ['売上', 800000, 900000], ['来客数', 250, 280],
    ['飲食物', 200000, 210000], ['人件費（加奈）', 120000, 130000], ['人件費（その他）', 40000, 30000]
  ]);
  const r = env.call('monthly', { mgrToken, month: '2026-10' });
  assert.equal(r.summary.legacy, true);
  assert.deepEqual([r.summary.sales, r.summary.guests, r.summary.laborTotal, r.summary.purchases['飲食物']], [900000, 280, 160000, 210000]);
  assert.equal(r.prev.sales, 800000);
  const built = env.call('buildMonthlySheet', { mgrToken });
  assert.deepEqual(built.months, ['2026-09', '2026-10', '2026-11']);
});

test('管理シートの取り込み：見出しの名前で読み、今日まで。何度やり直しても二重にならない', async () => {
  const { makeSpreadsheet } = await import('./gas-mock.mjs');
  const env = boot();
  env.setNow('2026-10-14T20:00:00+09:00');
  // 9月の並び（管理シートと同じ見出し。金額はテスト用）
  const sep = [
    ['8月', '列 1', '列 2', '列 3', '列 ４', '列 ', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', 'ポイント\n売上', '食品\n支出', 'その他\n支出', 'キャッシュ\nレス\n売上', '家賃', 'ガス\n電気\nカラオケ'],
    [1, '火', '加奈', '', '', '', '', 12000, 0, 8000, 0, 0, 0, 0, 0, 200000, 30000],
    [2, '水', '岡本', '', '', '', '', 0, 0, 10000, 0, 0, 1000, 0, 2000, 0, 0],
    [3, '木', '店休日', '', '', '', '', 0, 0, 0, 0, 0, 0, 500, 0, 0, 0],
    [4, '金', '岡本', '加奈', '', '', '6名団体', 13000, 5000, 20000, 30000, 1000, 2000, 0, 0, 0, 1000],
    [5, '土', '岡本', '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['合計', '', '', '', '', '', '', 25000, 5000, 38000, 30000, 1000, 3000, 500, 2000, 200000, 31000],
    ['', '', '売上目標等', '売上目標'],
  ];
  // 10月の並び（列が違う。先の日付は予定）
  const oct = [
    ['10月', '列 1', '1', '2', '3', '3 2', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険', '新しい列'],
    [1, '木', '岡本', '', '', '', '', 0, 0, 0, 0, 0, 0, 500, 100, 250000, 30000, 8000, 9],
    [2, '金', '岡本', '加奈', '優輝', '', 'おかめでナイト', 15000, 0, 100000, 0, 5000, 0, 800, 0, 0, 4900, 0, 9],
    [14, '水', '岡本', '', '', '', '', 0, 0, 25000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [23, '金', '岡本', '加奈', '', '', '団体の予定', 12000, 0, 0, 250000, 0, 0, 0, 0, 0, 0, 0, 0], // 先の日付：取り込まない
    ['合計']
  ];
  const source = makeSpreadsheet({ '9月': sep, '10月': oct });
  // GASの中の配列は別の実行環境のものなので、比べる前にふつうの値に写す
  const res = JSON.parse(JSON.stringify(env.gas.importLegacy_(source, '2026-10-14')));
  assert.deepEqual(res.map(r => [r.tab, r.days, r.until]), [['9月', 5, '2026-09-01〜2026-09-05'], ['10月', 3, '2026-10-01〜2026-10-14']]);
  assert.deepEqual(res[1].unknown, ['新しい列']);

  const daily = env.ss.getSheetByName('過去の日別').dump();
  assert.equal(daily.length, 8);
  const d4 = daily.find(r => r['日付'] === '2026-09-04');
  assert.deepEqual([d4['シフト'], d4['イベント'], d4['人件費（加奈）'], d4['現金売上'], d4['団体売上'], d4['ポイント売上']], ['岡本、加奈', '6名団体', 13000, 20000, 30000, 1000]);
  assert.equal(daily.find(r => r['日付'] === '2026-09-03')['店休日'], '店休日');
  assert.equal(daily.find(r => r['日付'] === '2026-09-01')['家賃電気'], 200000); // 9月の「家賃」は10月の分け方の「家賃電気」へ
  assert.equal(daily.find(r => r['日付'] === '2026-10-02')['シフト'], '岡本、加奈、優輝');

  // 月次（管理シートからの月）：9月
  const mgrToken = env.login();
  const sepSum = env.call('monthly', { mgrToken, month: '2026-09' }).summary;
  assert.equal(sepSum.legacy, true);
  assert.deepEqual([sepSum.sales, sepSum.cash, sepSum.cashless, sepSum.point, sepSum.event, sepSum.eventGroups], [38000 + 30000 + 2000 + 1000, 38000, 2000, 1000, 30000, 1]);
  assert.deepEqual([sepSum.openDays, sepSum.closedDays, sepSum.zeroDays], [4, 1, ['2026-09-05']]);
  assert.deepEqual(sepSum.purchases, { '飲食物': 3000, '備品': 0, 'その他': 500 });
  assert.deepEqual(sepSum.fixed, { '家賃電気': 200000, 'ガス・カラオケ・Wi-Fi・電話': 31000 });
  assert.deepEqual([sepSum.laborTotal, sepSum.laborFixed[0]], [30000, { name: '加奈', days: 0, hours: 0, transport: 0, cost: 25000 }]);
  // 10月：今日まで（23日の予定の団体売上は入らない）
  const octSum = env.call('monthly', { mgrToken, month: '2026-10' }).summary;
  assert.deepEqual([octSum.sales, octSum.event, octSum.fixed['保険'], octSum.importedUntil], [130000, 0, 8000, '2026-10-01〜2026-10-14']);

  // 管理シートに書き足して、もう一度取り込む → 二重にならず、置き換わる
  oct.splice(4, 0, [15, '木', '加奈', '', '', '', '', 13000, 0, 30000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  env.setNow('2026-10-15T20:00:00+09:00');
  env.gas.importLegacy_(makeSpreadsheet({ '9月': sep, '10月': oct }), '2026-10-15');
  env.gas.importLegacy_(makeSpreadsheet({ '9月': sep, '10月': oct }), '2026-10-15');
  const daily2 = env.ss.getSheetByName('過去の日別').dump();
  assert.equal(daily2.length, 9);
  assert.equal(daily2.filter(r => r['日付'] === '2026-09-04').length, 1);
  assert.equal(env.call('monthly', { mgrToken, month: '2026-10' }).summary.sales, 160000);
  const legacy = env.ss.getSheetByName('過去の月次');
  const vals = legacy.getRange(1, 1, legacy.getLastRow(), legacy.getLastColumn()).getValues();
  assert.deepEqual(vals[0], ['項目', '2026-09', '2026-10']);
  assert.equal(vals.filter(r => r[0] === '売上').length, 1);
  // スプシの「月次」タブにも9月・10月が出る
  assert.deepEqual(env.call('buildMonthlySheet', { mgrToken }).months, ['2026-09', '2026-10', '2026-11']);
});
