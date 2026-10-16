// appsscript.json の許可（oauthScopes）が、Code.gs が使っているGoogleのサービスに足りているか
// oauthScopes を書くと、Apps Script は自動で許可を足さない。足りないと「〜を呼び出す権限がありません」になり、許可の画面も出ない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const code = fs.readFileSync(fileURLToPath(new URL('../gas/Code.gs', import.meta.url)), 'utf8');
const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../gas/appsscript.json', import.meta.url)), 'utf8'));
const S = 'https://www.googleapis.com/auth/';

// 使い方 → 要る許可（許可の要らないサービス：PropertiesService・CacheService・LockService・Utilities・ContentService）
const NEEDS = [
  [/SpreadsheetApp\.(getActive|openByUrl|openById)\b/, S + 'spreadsheets'], // 管理シート（別のスプシ）を開くので currentonly では足りない
  [/SpreadsheetApp\.getUi\b/, S + 'script.container.ui'], // スプシのメニュー・確かめの表示
  [/ScriptApp\.(getProjectTriggers|newTrigger|deleteTrigger)\b/, S + 'script.scriptapp'], // トリガー
  [/Session\.getEffectiveUser\(\)\.getEmail\b|getEffectiveUser\b/, S + 'userinfo.email'], // 保護の編集者（実行した人）
  [/DriveApp\./, S + 'drive'],
  [/UrlFetchApp\./, S + 'script.external_request'],
  [/(MailApp|GmailApp)\./, S + 'script.send_mail']
];

test('appsscript.json に、Code.gs が使うサービスの許可がすべて入っている', () => {
  const scopes = manifest.oauthScopes;
  for (const [re, scope] of NEEDS) {
    if (re.test(code)) assert.ok(scopes.includes(scope), scope + ' が足りない');
  }
  assert.ok(scopes.includes(S + 'script.scriptapp'));
});

test('appsscript.json：タイムゾーンと、ウェブアプリの公開の設定（実行：自分／アクセス：全員）', () => {
  assert.equal(manifest.timeZone, 'Asia/Tokyo');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('Code.gs が使っているサービスは、表にあるものだけ（新しいサービスを使ったら、許可を足す）', () => {
  const used = [...new Set(code.match(/\b[A-Z][A-Za-z]*(App|Service)\b(?=\.)/g))].sort();
  const known = ['CacheService', 'ContentService', 'DriveApp', 'GmailApp', 'LockService', 'MailApp', 'PropertiesService', 'ScriptApp', 'SpreadsheetApp', 'UrlFetchApp'];
  assert.deepEqual(used.filter(x => !known.includes(x)), []);
});
