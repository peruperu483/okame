/**
 * お香芽 業務アプリ GAS（新しいスプシに付けて使う）
 *
 * - 直すのはこのファイル。林がApps Scriptのエディタに貼り替えてデプロイする
 * - リポジトリは公開なので、ここに秘密情報を書かない（スクリプトプロパティに置く）
 * - 画面を直してもGASを貼り替えなくて済むように、記録は「表の名前とID」で汎用に扱う
 */

var APP_VERSION = '0.1.0';
var TZ = 'Asia/Tokyo';

// ===== 表の定義 =====
// 型: t=文字 n=数値 b=はい/いいえ j=JSON（文字で保存）
// read: open=いつでも / attendance・fixedCosts・monthly=設定の「見せる範囲」に従う / mgr=店長だけ
// write: staff=設定の「バイトが直せる範囲」（表と日数）に従う。店長はいつでも / mgr=店長だけ / open=だれでも（操作履歴の追記）
// hidden: 項目ごとの見せる範囲（権限がないと読めず、書いても無視して元の値を残す）
// dateKey: 期間で絞り込むときに使う項目
var COMMON_TAIL = [
  ['memo', 'メモ', 't'],
  ['createdAt', '作成', 't'],
  ['updatedAt', '更新', 't'],
  ['deviceId', '端末', 't']
];

var TABLES = {
  visits: {
    sheet: '来客', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['no', '番号', 'n'], ['name', '名前', 't'],
      ['people', '人数', 'n'], ['plan', 'プラン', 't'], ['inAt', '入店時刻', 't'],
      ['extensions', '延長', 'j'], ['status', '状態', 't'], ['paidAt', '会計時刻', 't'],
      ['amount', '金額', 'n'], ['pay', '支払方法', 't'], ['kind', '区分', 't'],
      ['eventId', '予定ID', 't'], ['trial', '試運転', 'b']
    ].concat(COMMON_TAIL)
  },
  closings: {
    sheet: '締め', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['closedAt', '閉店時刻', 't'],
      ['sales', '売上', 'n'], ['cash', '現金', 'n'], ['cashless', 'キャッシュレス', 'n'], ['point', 'ポイント', 'n'],
      ['normal', '通常', 'n'], ['group', '団体', 'n'], ['guests', '来客数', 'n'], ['groups', '組数', 'n'],
      ['drawerCash', 'レジ現金', 'n'], ['diff', '差額', 'n'], ['trial', '試運転', 'b']
    ].concat(COMMON_TAIL)
  },
  days: {
    sheet: '営業日', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['closed', '店休日', 'b'],
      ['shiftPlan', 'シフト予定', 't'], ['lastPlan', 'ラスト予定', 't'],
      ['shiftActual', 'シフト実績', 't'], ['lastActual', 'ラスト実績', 't']
    ].concat(COMMON_TAIL)
  },
  staff: {
    sheet: 'スタッフ', read: 'open', write: 'mgr', hidden: { wage: 'attendance' },
    cols: [
      ['id', 'ID', 't'], ['name', '名前', 't'], ['wage', '時給', 'n'],
      ['active', '在籍', 'b'], ['order', '表示順', 'n']
    ].concat(COMMON_TAIL)
  },
  attendance: {
    sheet: '勤怠', read: 'attendance', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['staffId', 'スタッフID', 't'], ['name', '名前', 't'],
      ['hours', '勤務時間', 'n'], ['wage', '時給', 'n'], ['cost', '人件費', 'n'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  purchases: {
    sheet: '仕入れ', read: 'open', write: 'staff', dateKey: 'date',
    cols: [
      ['id', 'ID', 't'], ['date', '日付', 't'], ['shop', '店名', 't'], ['category', '項目', 't'],
      ['item', '品目', 't'], ['amount', '金額', 'n'], ['receipts', 'レシート', 'j'],
      ['source', '入力方法', 't'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  fixedCosts: {
    sheet: '固定費', read: 'fixedCosts', write: 'staff', dateKey: 'month',
    cols: [
      ['id', 'ID', 't'], ['month', '月', 't'], ['item', '項目', 't'], ['amount', '金額', 'n'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  events: {
    sheet: '予定', read: 'open', write: 'staff', dateKey: 'date',
    hidden: { contactName: 'eventContact', contactInfo: 'eventContact' },
    cols: [
      ['id', 'ID', 't'], ['date', '日付', 't'], ['type', '種類', 't'], ['title', '内容', 't'],
      ['people', '人数', 'n'], ['contactName', '幹事', 't'], ['contactInfo', '幹事の連絡先', 't'],
      ['expectedAmount', '見込みの金額', 'n'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  requests: {
    sheet: '希望休', read: 'open', write: 'staff', dateKey: 'date',
    cols: [
      ['id', 'ID', 't'], ['date', '日付', 't'], ['name', '名前', 't'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  log: {
    sheet: '操作履歴', read: 'mgr', write: 'open', appendOnly: true, dateKey: 'at',
    cols: [
      ['id', 'ID', 't'], ['at', '日時', 't'], ['type', '種別', 't'], ['table', '表', 't'],
      ['targetId', '対象ID', 't'], ['reason', '理由', 't'], ['before', '変更前', 'j'],
      ['after', '変更後', 'j'], ['by', '操作者', 't'], ['deviceId', '端末', 't']
    ]
  }
};

var SETTINGS_SHEET = '設定';

// ===== 設定の初期値（ここにない項目は保存できない）=====
var DEFAULT_SETTINGS = {
  nomiPrice: 3000,
  nomiMinutes: 120,
  lastOrderMinutes: 30,
  extensions: [],
  bizDayCutoffHour: 12,
  openTime: '18:00',
  closeTime: '25:00',
  goLiveDate: '2026-11-01',
  pointCountsAsSales: true,
  defaultWage: 2000,
  cancelReasons: ['打ち間違い', '会計のやり直し', '金額の修正', 'その他'],
  deleteReasons: ['打ち間違い', '二重に登録', '来店取りやめ', 'その他'],
  purchaseCategories: ['酒', '食材', '消耗品', '備品', 'その他'],
  purchaseRules: [],
  fixedCostItems: ['家賃', 'ガス', '電気', 'カラオケ'],
  eventTypes: ['団体', '日本酒の会', '貸切'],
  visibility: { attendance: true, fixedCosts: true, monthly: true, eventContact: true },
  // days=0 はその営業日だけ。1なら前日まで。未来の日付（予定・希望休）はいつでも
  staffEdit: { days: 0, tables: ['visits', 'closings', 'days', 'purchases', 'events', 'requests'] },
  changeFloat: 0,
  targets: { monthlySales: 1000000, dailyGuests: 10, monthlyEvents: 0 }
};

var SETTING_LABELS = {
  nomiPrice: '飲み放題の料金（1人・円）',
  nomiMinutes: '飲み放題の時間（分）',
  lastOrderMinutes: 'ラストオーダー（残り何分で知らせるか）',
  extensions: '延長の種類（名前・料金・時間）',
  bizDayCutoffHour: '営業日の切り替え時刻（この時より前は前日の営業日）',
  openTime: '開店時刻',
  closeTime: '閉店時刻',
  goLiveDate: '運用開始日（これより前の記録は試運転）',
  pointCountsAsSales: 'ポイントを売上に含める',
  defaultWage: '時給の初期値（円）',
  cancelReasons: '会計を取り消す理由',
  deleteReasons: '入店を削除する理由',
  purchaseCategories: '仕入れの項目',
  purchaseRules: '仕入れの項目を決めるルール（店名の言葉 → 項目）',
  fixedCostItems: '固定費の項目',
  eventTypes: '予定の種類',
  visibility: 'バイトに見せる範囲',
  staffEdit: 'バイトが直せる範囲（何日前まで・どの記録）',
  changeFloat: '釣り銭の準備金（レジに最初から入れておく現金・円）',
  targets: '目標'
};

var MGR_TTL_SEC = 2 * 60 * 60;
var PIN_FAIL_LIMIT = 5;
var PIN_LOCK_SEC = 10 * 60;

// ===== スプシのメニュー =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('お香芽')
    .addItem('初期設定（タブを作る・直す）', 'setup')
    .addItem('共有トークンを表示', 'showToken')
    .addItem('暗証番号を作り直す', 'resetPin')
    .addToUi();
}

// ===== 初期設定（何度実行しても壊れない）=====
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(TABLES).forEach(function (key) { ensureTableSheet_(ss, TABLES[key]); });
  ensureSettingsSheet_(ss);
  var blank = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var props = PropertiesService.getScriptProperties();
  var lines = ['初期設定が終わりました。'];
  if (!props.getProperty('SHARED_TOKEN')) {
    props.setProperty('SHARED_TOKEN', newToken_());
    lines.push('共有トークンを作りました。');
  }
  lines.push('共有トークン：' + props.getProperty('SHARED_TOKEN'));
  if (!props.getProperty('PIN_HASH')) {
    var pin = newPin_();
    setPin_(pin);
    lines.push('初期の暗証番号：' + pin + '（店長に伝え、設定画面で変えてもらう）');
  } else {
    lines.push('暗証番号は設定済みです（変えていません）。');
  }
  notify_(lines.join('\n'));
}

function showToken() {
  var t = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  notify_(t ? '共有トークン：' + t : 'まだありません。先に「初期設定」を実行してください。');
}

function resetPin() {
  var pin = newPin_();
  setPin_(pin);
  notify_('新しい暗証番号：' + pin + '（店長に伝え、設定画面で変えてもらう）');
}

/** 共有トークンを作り直す（タブレットで入れ直しが必要になる） */
function rotateToken() {
  PropertiesService.getScriptProperties().setProperty('SHARED_TOKEN', newToken_());
  showToken();
}

function notify_(msg) {
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* エディタから実行したときは実行ログだけ */ }
}

function ensureTableSheet_(ss, def) {
  var sh = ss.getSheetByName(def.sheet) || ss.insertSheet(def.sheet);
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing = def.cols.filter(function (c) { return header.indexOf(c[1]) < 0; });
  if (missing.length) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing.map(function (c) { return c[1]; })]);
    header = header.concat(missing.map(function (c) { return c[1]; }));
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  def.cols.forEach(function (c) {
    sh.getRange(2, header.indexOf(c[1]) + 1, rows, 1).setNumberFormat(formatOf_(c[2]));
  });
  protect_(sh);
}

/**
 * タブを保護する。setupを実行した人（林）とスプシの持ち主だけが直接書き換えられる。
 * ほかの人（オーナー・店長）は見るだけ。直すのはアプリから（アプリは林の権限でGASが書く）
 */
function protect_(sh) {
  var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
  p.setDescription('記録はアプリから直してください（直接の書き換えは林だけ）');
  var me = Session.getEffectiveUser();
  p.addEditor(me);
  var others = p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); });
  if (others.length) p.removeEditors(others);
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function ensureSettingsSheet_(ss) {
  var sh = ss.getSheetByName(SETTINGS_SHEET) || ss.insertSheet(SETTINGS_SHEET);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 4).setValues([['キー', '説明', '値', '更新']]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  var stored = readSettingsRows_(sh);
  var add = Object.keys(DEFAULT_SETTINGS).filter(function (k) { return !(k in stored.map); }).map(function (k) {
    return [k, SETTING_LABELS[k] || '', JSON.stringify(DEFAULT_SETTINGS[k]), nowIso_()];
  });
  if (add.length) appendRows_(sh, add, add.map(function () { return ['@', '@', '@', '@']; }));
  protect_(sh);
}

// ===== Webアプリの入り口 =====
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'ping') return json_({ status: 'ok', app: 'okame', version: APP_VERSION, time: nowIso_() });
  return json_({ status: 'error', code: 'bad_request', message: 'このURLはアプリから使います。' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ status: 'error', code: 'bad_json', message: '送られた内容が読めません。' });
  }
  try {
    return json_(handle_(body));
  } catch (err) {
    if (err && err.code) return json_({ status: 'error', code: err.code, message: err.message });
    console.error(err && err.stack || err);
    return json_({ status: 'error', code: 'server', message: String(err && err.message || err) });
  }
}

function handle_(body) {
  var token = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (!token || body.token !== token) fail_('unauthorized', '共有トークンが違います。');
  var settings = getSettings_();
  var ctx = { mgr: isMgr_(body.mgrToken), settings: settings, deviceId: String(body.deviceId || '') };

  switch (body.action) {
    case 'bootstrap':
      return ok_({ settings: settings, mgr: ctx.mgr, version: APP_VERSION, serverTime: nowIso_() });
    case 'fetch':
      return ok_({ rows: fetchRows_(body.table, body.from, body.to, ctx) });
    case 'sync':
      return ok_({ results: withLock_(function () { return applyOps_(body.ops || [], ctx); }) });
    case 'login':
      return ok_(login_(String(body.pin || '')));
    case 'logout':
      if (body.mgrToken) CacheService.getScriptCache().remove('mgr:' + body.mgrToken);
      return ok_({});
    case 'saveSettings':
      requireMgr_(ctx);
      return ok_({ settings: withLock_(function () { return saveSettings_(body.settings || {}, ctx); }) });
    case 'changePin':
      requireMgr_(ctx);
      if (!/^\d{4,8}$/.test(String(body.newPin || ''))) fail_('bad_pin', '暗証番号は4〜8桁の数字にしてください。');
      setPin_(String(body.newPin));
      appendLog_({ type: '暗証番号の変更', table: 'settings', targetId: '', by: '店長' }, ctx);
      return ok_({});
    default:
      fail_('bad_action', '知らない操作です：' + body.action);
  }
}

// ===== 読み込み =====
function fetchRows_(tableKey, from, to, ctx) {
  var def = tableDef_(tableKey);
  if (!canAccess_(def.read, ctx)) fail_('forbidden', 'この画面は今は見られません。');
  var t = readTable_(def);
  return t.rows.filter(function (r) {
    if (!def.dateKey || (!from && !to)) return true;
    var d = String(r[def.dateKey] || '');
    return (!from || d.slice(0, from.length) >= from) && (!to || d.slice(0, to.length) <= to);
  }).map(function (r) { return stripHidden_(def, r, ctx); });
}

// ===== 書き込み（IDで上書き。同じものを何度送っても1件）=====
function applyOps_(ops, ctx) {
  var results = [];
  var byTable = {};
  ops.forEach(function (op) {
    var def = TABLES[op && op.table];
    if (!def) { results.push({ opId: op && op.opId, ok: false, code: 'bad_table' }); return; }
    if (def.write === 'mgr' && !ctx.mgr) { results.push({ opId: op.opId, ok: false, code: 'forbidden' }); return; }
    if (!op.id || typeof op.data !== 'object' || !op.data) { results.push({ opId: op.opId, ok: false, code: 'bad_op' }); return; }
    (byTable[op.table] = byTable[op.table] || []).push(op);
  });
  Object.keys(byTable).forEach(function (key) {
    results = results.concat(upsert_(key, byTable[key], ctx));
  });
  return results;
}

function upsert_(tableKey, ops, ctx) {
  var def = TABLES[tableKey];
  var t = readTable_(def);
  var index = {};
  t.rows.forEach(function (r, i) { index[r.id] = { at: i }; });
  var dirty = {};
  var fresh = [];
  var results = [];

  ops.forEach(function (op) {
    var data = cleanIncoming_(def, op.data, ctx);
    data.id = String(op.id);
    if (tableKey === 'log') data.by = ctx.mgr ? '店長' : 'スタッフ';
    var hit = index[data.id];
    if (hit && def.appendOnly) { results.push({ opId: op.opId, ok: true, dup: true }); return; }
    var cur = hit ? (hit.fresh != null ? fresh[hit.fresh] : t.rows[hit.at]) : null;
    if (def.write === 'staff' && !staffCanWrite_(tableKey, def, cur, data, ctx)) {
      results.push({ opId: op.opId, ok: false, code: 'forbidden' });
      return;
    }
    if (hit) {
      if (data.updatedAt && cur.updatedAt && Date.parse(data.updatedAt) < Date.parse(cur.updatedAt)) {
        results.push({ opId: op.opId, ok: true, stale: true, current: stripHidden_(def, cur, ctx) });
        return;
      }
      var merged = merge_(cur, data);
      if (hit.fresh != null) fresh[hit.fresh] = merged;
      else { t.rows[hit.at] = merged; dirty[hit.at] = true; }
    } else {
      fresh.push(data);
      index[data.id] = { fresh: fresh.length - 1 };
    }
    results.push({ opId: op.opId, ok: true });
  });

  var formats = t.header.map(function (h) { var c = t.colByLabel[h]; return c ? formatOf_(c[2]) : 'General'; });
  Object.keys(dirty).forEach(function (i) {
    i = Number(i);
    var range = t.sheet.getRange(i + 2, 1, 1, t.header.length);
    range.setNumberFormats([formats]);
    range.setValues([toRow_(t, t.rows[i], t.raw[i])]);
  });
  if (fresh.length) {
    appendRows_(t.sheet, fresh.map(function (r) { return toRow_(t, r, null); }), fresh.map(function () { return formats; }));
  }
  return results;
}

/** 知らない項目を捨て、権限のない項目は送られてきても使わない */
function cleanIncoming_(def, data, ctx) {
  var out = {};
  def.cols.forEach(function (c) {
    if (!(c[0] in data)) return;
    if (def.hidden && def.hidden[c[0]] && !canAccess_(def.hidden[c[0]], ctx)) return;
    out[c[0]] = data[c[0]];
  });
  if (!('deviceId' in out) && def.cols.some(function (c) { return c[0] === 'deviceId'; })) out.deviceId = ctx.deviceId;
  return out;
}

function merge_(cur, data) {
  var m = {};
  Object.keys(cur).forEach(function (k) { m[k] = cur[k]; });
  Object.keys(data).forEach(function (k) { m[k] = data[k]; });
  return m;
}

function stripHidden_(def, row, ctx) {
  if (!def.hidden) return row;
  var out = merge_(row, {});
  Object.keys(def.hidden).forEach(function (k) { if (!canAccess_(def.hidden[k], ctx)) delete out[k]; });
  return out;
}

function appendLog_(entry, ctx) {
  var e = merge_({ id: Utilities.getUuid(), at: nowIso_(), deviceId: ctx.deviceId }, entry);
  upsert_('log', [{ opId: e.id, id: e.id, data: e }], { mgr: entry.by === '店長', deviceId: ctx.deviceId });
}

// ===== 表の読み書きの下回り =====
function tableDef_(key) {
  var def = TABLES[key];
  if (!def) fail_('bad_table', '知らない表です：' + key);
  return def;
}

function readTable_(def) {
  var sh = SpreadsheetApp.getActive().getSheetByName(def.sheet);
  if (!sh) fail_('no_sheet', 'タブ「' + def.sheet + '」がありません。スプシで「お香芽 → 初期設定」を実行してください。');
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var colByLabel = {};
  def.cols.forEach(function (c) { colByLabel[c[1]] = c; });
  var raw = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
  var rows = raw.map(function (vals) {
    var o = {};
    header.forEach(function (h, j) { var c = colByLabel[h]; if (c) o[c[0]] = fromCell_(vals[j], c[2]); });
    return o;
  });
  return { sheet: sh, header: header, colByLabel: colByLabel, raw: raw, rows: rows };
}

function toRow_(t, obj, base) {
  return t.header.map(function (h, j) {
    var c = t.colByLabel[h];
    if (!c) return base ? base[j] : '';
    return (c[0] in obj) ? toCell_(obj[c[0]], c[2]) : (base ? base[j] : '');
  });
}

function appendRows_(sh, rows, formats) {
  var start = sh.getLastRow() + 1;
  var need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  var range = sh.getRange(start, 1, rows.length, rows[0].length);
  range.setNumberFormats(formats);
  range.setValues(rows);
}

function toCell_(v, type) {
  if (v === undefined || v === null) return '';
  switch (type) {
    case 'n': return v === '' || isNaN(Number(v)) ? '' : Number(v);
    case 'b': return v === true || v === 'TRUE' || v === 'true';
    case 'j': return JSON.stringify(v);
    default: return String(v);
  }
}

function fromCell_(v, type) {
  switch (type) {
    case 'n': return v === '' || v === null ? null : Number(v);
    case 'b': return v === true || v === 'TRUE' || v === 'true';
    case 'j':
      if (v === '' || v === null) return null;
      try { return JSON.parse(v); } catch (e) { return v; }
    default:
      if (v instanceof Date) return formatDateCell_(v);
      return v === null ? '' : String(v);
  }
}

function formatOf_(type) {
  if (type === 'n') return '#,##0.##';
  if (type === 'b') return 'General';
  return '@';
}

function formatDateCell_(d) {
  var hms = Utilities.formatDate(d, TZ, 'HH:mm:ss');
  return hms === '00:00:00' ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// ===== 設定 =====
function readSettingsRows_(sh) {
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
  var map = {};
  vals.forEach(function (r, i) { if (r[0]) map[String(r[0])] = { row: i + 2, value: r[2] }; });
  return { map: map };
}

function getSettings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_SHEET);
  var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!sh) return s;
  var stored = readSettingsRows_(sh).map;
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!(k in stored)) return;
    try {
      var v = JSON.parse(stored[k].value);
      if (isPlainObject_(DEFAULT_SETTINGS[k]) && isPlainObject_(v)) s[k] = merge_(s[k], v);
      else if (sameKind_(DEFAULT_SETTINGS[k], v)) s[k] = v;
    } catch (e) { /* 壊れた値は初期値のまま */ }
  });
  return s;
}

function saveSettings_(incoming, ctx) {
  var before = getSettings_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_SHEET);
  if (!sh) fail_('no_sheet', 'タブ「設定」がありません。');
  var stored = readSettingsRows_(sh).map;
  var changed = {};
  Object.keys(incoming).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS)) return;
    var v = incoming[k];
    if (isPlainObject_(DEFAULT_SETTINGS[k])) {
      if (!isPlainObject_(v)) fail_('bad_setting', '設定「' + (SETTING_LABELS[k] || k) + '」の形が違います。');
      v = merge_(before[k], v);
    } else if (!sameKind_(DEFAULT_SETTINGS[k], v)) {
      fail_('bad_setting', '設定「' + (SETTING_LABELS[k] || k) + '」の形が違います。');
    }
    var row = [k, SETTING_LABELS[k] || '', JSON.stringify(v), nowIso_()];
    if (stored[k]) sh.getRange(stored[k].row, 1, 1, 4).setValues([row]);
    else appendRows_(sh, [row], [['@', '@', '@', '@']]);
    changed[k] = v;
  });
  var keys = Object.keys(changed);
  if (keys.length) {
    var b = {};
    keys.forEach(function (k) { b[k] = before[k]; });
    appendLog_({ type: '設定の変更', table: 'settings', targetId: keys.join(','), before: b, after: changed, by: '店長' }, ctx);
  }
  return getSettings_();
}

function isPlainObject_(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function sameKind_(a, b) {
  if (Array.isArray(a)) return Array.isArray(b);
  return typeof a === typeof b && !isPlainObject_(b);
}

// ===== 見せる範囲と店長の判定（必ずGAS側で行う）=====
function canAccess_(level, ctx) {
  if (level === 'open') return true;
  if (ctx.mgr) return true;
  if (level === 'mgr') return false;
  return !ctx.settings.visibility || ctx.settings.visibility[level] !== false;
}

/**
 * バイトが書いてよいか。店長はいつでもよい。
 * 設定の staffEdit.tables にある表で、日付が「今日の営業日 − staffEdit.days」以降のものだけ（直す前と後の両方を見る）
 */
function staffCanWrite_(tableKey, def, cur, data, ctx) {
  if (ctx.mgr) return true;
  var se = ctx.settings.staffEdit || {};
  if ((se.tables || []).indexOf(tableKey) < 0) return false;
  if (!def.dateKey) return true;
  var min = addDays_(serverBizDate_(ctx.settings), -(Number(se.days) || 0));
  var dates = [cur && cur[def.dateKey], data[def.dateKey]].filter(function (d) { return d; });
  return dates.every(function (d) { d = String(d); return d >= min.slice(0, Math.min(d.length, 10)); });
}

function serverBizDate_(settings) {
  var cutoff = Number(settings.bizDayCutoffHour);
  if (isNaN(cutoff)) cutoff = 12;
  return Utilities.formatDate(new Date(now_().getTime() - cutoff * 3600e3), TZ, 'yyyy-MM-dd');
}

function addDays_(ymd, n) {
  var p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/** テストで差し替えられるように時刻はここから取る */
function now_() { return new Date(); }

function requireMgr_(ctx) {
  if (!ctx.mgr) fail_('need_mgr', '店長の暗証番号が必要です。');
}

function isMgr_(mgrToken) {
  return !!mgrToken && CacheService.getScriptCache().get('mgr:' + mgrToken) === '1';
}

function login_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pinfail') || 0);
  if (fails >= PIN_FAIL_LIMIT) fail_('locked', '暗証番号を続けて間違えたため、10分間は入れません。');
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_HASH')) fail_('no_pin', '暗証番号が未設定です。スプシで「お香芽 → 初期設定」を実行してください。');
  if (hashPin_(pin, props.getProperty('PIN_SALT')) !== props.getProperty('PIN_HASH')) {
    cache.put('pinfail', String(fails + 1), PIN_LOCK_SEC);
    fail_('wrong_pin', '暗証番号が違います。');
  }
  cache.remove('pinfail');
  var tok = newToken_();
  cache.put('mgr:' + tok, '1', MGR_TTL_SEC);
  return { mgrToken: tok, expiresInSec: MGR_TTL_SEC };
}

function setPin_(pin) {
  var props = PropertiesService.getScriptProperties();
  var salt = newToken_();
  props.setProperty('PIN_SALT', salt);
  props.setProperty('PIN_HASH', hashPin_(pin, salt));
}

function hashPin_(pin, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

// ===== 小物 =====
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function newPin_() {
  var d = Utilities.getUuid().replace(/\D/g, '');
  return (d + '0000').slice(0, 4);
}

function nowIso_() { return Utilities.formatDate(now_(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function ok_(obj) { obj.status = 'ok'; return obj; }

function fail_(code, message) {
  var e = new Error(message);
  e.code = code;
  throw e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
