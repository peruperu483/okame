// 手打ちのタブ（「11月（手打ち）」）を、管理シートのその月のタブの写しにする
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGas, makeSpreadsheet } from './gas-mock.mjs';

const CODE = fileURLToPath(new URL('../gas/Code.gs', import.meta.url));

function boot(now = '2026-11-03T14:00:00+09:00') {
  const env = loadGas(CODE, { handTab: true }); // 初期設定で「11月（手打ち）」ができる
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

// 管理シートのまね（数字はテスト用）。11月のタブは列の並びが手打ちのタブと違う（10月と同じ並び）
const head = m => [m, '列 1', '1', '2', '3', '3', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'];
function source({ nov2Cash = 30000 } = {}) {
  const nov = [head('11月'),
    [1, '日', '岡本', '', '', '', '日本酒の会', 0, 0, 20000, 50000, 4000, 1000, 800, 0, 250000, 30000, 8000],
    [2, '月', '岡本', '加奈', '', '', '', 12000, 0, nov2Cash, 0, 0, 0, 500, 0, 0, 0, 0],
    [3, '火', '店休日', '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, '水', '岡本', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // 先の日：シフトだけ
    ['合計']];
  return makeSpreadsheet({ '9月': [head('8月'), ['合計']], '10月': [head('10月'), ['合計']], '11月': nov });
}

test('手打ちのタブを、管理シートの11月の写しにする。写すたびに上書きし、合計とアプリとの差の行は残す', () => {
  const env = boot();
  const hand = env.ss.getSheetByName('11月（手打ち）');
  hand.getRange(5, 10).setValue(99999); // 店長が直接打った（次に写すと上書きされる）
  const r1 = plain(env.gas.reimportLegacy_(source(), '2026-11-03'));
  assert.deepEqual(r1.hand, [{ tab: '11月（手打ち）', month: '2026-11', from: '11月', days: 4, sales: 20000 + 50000 + 4000 + 1000 + 30000 }]);
  const g = () => hand.getRange(1, 1, 34, 19).getValues();
  let v = g();
  // 列の並びは手打ちのタブのまま（H 加奈・I スタッフ・J 現金・K 団体・L ポイント・M 食品・N その他・O キャッシュレス・P 家賃電気・Q ガス・R 保険）
  assert.deepEqual(v[1].slice(0, 18), [1, '日', '岡本', '', '', '', '日本酒の会', 0, 0, 20000, 50000, 1000, 800, 0, 4000, 250000, 30000, 8000]);
  assert.deepEqual(v[2].slice(0, 10), [2, '月', '岡本', '加奈', '', '', '', 12000, 0, 30000]);
  assert.deepEqual(v[3].slice(0, 8), [3, '火', '店休日', '', '', '', '', '']); // 金額が1つもない日は空
  assert.deepEqual(v[4].slice(0, 10), [4, '水', '岡本', '', '', '', '', '', '', '']); // 直接打った 99999 は上書き
  assert.equal(v[5][0], 5); // 管理シートに行がない日は、日付と曜日だけ
  assert.equal(v[5][2], '');
  assert.equal(v[31][0], ''); // 11月は30日まで
  assert.equal(v[32][7], '=SUM(H2:H32)'); // 合計の行はそのまま
  assert.match(v[33][0], /アプリとの差/); // アプリとの差の行もそのまま
  assert.equal(v[33][7], `=IFERROR(INDIRECT("'11月（アプリ）'!I33")-H33,"")`);
  assert.match(v[0][18], /管理シートの写し/); // タブの上の一言
  assert.equal(hand.protection.warningOnly, true);
  // 管理シートで 11/2 を直して、もう一度：上書き（二重にならない）
  const r2 = plain(env.gas.reimportLegacy_(source({ nov2Cash: 31000 }), '2026-11-03'));
  assert.equal(r2.hand[0].sales, r1.hand[0].sales + 1000);
  v = g();
  assert.equal(v[2][9], 31000);
  assert.equal(env.sheets.filter(s => s.name === '11月（手打ち）').length, 1);
  // アプリのタブ・アプリの売上には入らない（金額は手打ちのタブにだけ）
  assert.equal(env.call('monthly', { mgrToken: env.login(), month: '2026-11' }).summary.sales, 0);
  // 表示
  const msg = env.gas.reimportMessage_(r2);
  assert.match(msg, /「11月（手打ち）」に写した日 4日・売上の合計 ¥106,000/);
});

test('手打ちのタブがない月・管理シートにタブがない月', () => {
  const env = boot();
  env.ss.deleteSheet(env.ss.getSheetByName('11月（手打ち）'));
  assert.deepEqual(plain(env.gas.reimportLegacy_(source(), '2026-11-03').hand), []); // 手打ちのタブがなければ写さない
  env.gas.createHandTab_('2026-12');
  const r = plain(env.gas.reimportLegacy_(source(), '2026-11-03'));
  assert.equal(r.hand.length, 1);
  assert.match(r.hand[0].error, /管理シートに「12月」のタブがありません/);
  assert.match(env.gas.reimportMessage_(r), /■ 12月（手打ち）\n　管理シートに「12月」のタブがありません/);
});

test('毎朝6時ごろの自動の取り込み直し：前にボタンで入れた管理シートから写し、結果を残す', () => {
  const env = boot();
  env.gas.reimportLegacyAuto(); // まだURLがない
  assert.match(env.props.get('AUTO_REIMPORT_LAST'), /URLがまだありません/);
  const src = source();
  env.props.set('LEGACY_URL', 'https://example.com/kanri');
  env.gas.SpreadsheetApp.openByUrl = () => src;
  env.gas.reimportLegacyAuto();
  assert.match(env.props.get('AUTO_REIMPORT_LAST'), /取り込み直しました：11月（手打ち） 4日/);
  assert.equal(env.ss.getSheetByName('11月（手打ち）').getRange(3, 10).getValue(), 30000);
  env.gas.SpreadsheetApp.openByUrl = () => { throw new Error('開けません'); };
  env.gas.reimportLegacyAuto();
  assert.match(env.props.get('AUTO_REIMPORT_LAST'), /失敗：開けません/);
});
