/**
 * お香芽 業務アプリ GAS（新しいスプシに付けて使う）
 *
 * - 直すのはこのファイル。林がApps Scriptのエディタに貼り替えてデプロイする
 * - リポジトリは公開なので、ここに秘密情報を書かない（スクリプトプロパティに置く）
 * - 画面を直してもGASを貼り替えなくて済むように、記録は「表の名前とID」で汎用に扱う
 */

var APP_VERSION = '0.4.0';
var TZ = 'Asia/Tokyo';

// ===== 表の定義 =====
// 型: t=文字 n=数値 b=はい/いいえ j=JSON（文字で保存）
// read: open=いつでも / mgr=店長だけ / eventContact=設定の「見せる範囲」に従う
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
  // 1組1行。売上に数えるのは状態が「退店」（精算が終わって退店）の組だけ
  // 合計 = 基本の金額 + 追加の合計。受け取りは何回でも（割り勘・併用）
  visits: {
    sheet: '来客', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['no', '番号', 'n'], ['name', '名前', 't'],
      ['people', '人数', 'n'], ['kind', '種類', 't'], ['inAt', '入店時刻', 't'], ['endAt', '終了予定', 't'],
      ['status', '状態', 't'], ['outAt', '退店時刻', 't'],
      ['base', '基本の金額', 'n'], ['extras', '追加', 'j'], ['total', '合計', 'n'],
      ['pays', '受け取り', 'j'], ['cash', '現金', 'n'], ['cashless', 'キャッシュレス', 'n'], ['point', 'ポイント', 'n'],
      ['eventId', '予定ID', 't'], ['trial', '試運転', 'b']
    ].concat(COMMON_TAIL)
  },
  // 1日1行（ID＝営業日）。あるはずの現金 = 開店時の現金 + 現金売上 + 入金 − 出金
  closings: {
    sheet: '締め', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['closedAt', '閉店時刻', 't'],
      ['sales', '売上', 'n'], ['guests', '来客数', 'n'], ['groups', '組数', 'n'],
      ['cash', '現金', 'n'], ['cashless', 'キャッシュレス', 'n'], ['point', 'ポイント', 'n'],
      ['nomi', '飲み放題', 'n'], ['tanpin', '単品', 'n'], ['event', 'イベント', 'n'],
      ['openCash', '開店時の現金', 'n'], ['cashIn', '入金', 'n'], ['cashOut', '出金', 'n'],
      ['expectedCash', 'あるはずの現金', 'n'], ['countedCash', '数えた現金', 'n'], ['diff', '差額', 'n'],
      ['trial', '試運転', 'b']
    ].concat(COMMON_TAIL)
  },
  // レジの出し入れ。出金はGASが仕入れにも「レジから」として自動で記録する（消すと仕入れも消す）
  cashMoves: {
    sheet: 'レジの出し入れ', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['at', '日時', 't'], ['type', '入金・出金', 't'],
      ['amount', '金額', 'n'], ['category', '科目', 't'], ['note', '内容', 't'], ['reason', '入金の理由', 't'],
      ['purchaseId', '仕入れID', 't'], ['status', '状態', 't']
    ].concat(COMMON_TAIL)
  },
  days: {
    sheet: '営業日', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['closed', '店休日', 'b'],
      ['shiftPlan', 'シフト予定', 't'], ['lastPlan', 'ラスト予定', 't'],
      ['shiftActual', 'シフト実績', 't'], ['lastActual', 'ラスト実績', 't'],
      ['openCash', '開店時の現金（手入力）', 'n']
    ].concat(COMMON_TAIL)
  },
  staff: {
    sheet: 'スタッフ', read: 'open', write: 'mgr', hidden: { wage: 'mgr', transport: 'mgr' },
    cols: [
      ['id', 'ID', 't'], ['name', '名前', 't'], ['wage', '時給', 'n'], ['transport', '交通費', 'n'],
      ['active', '在籍', 'b'], ['order', '表示順', 'n']
    ].concat(COMMON_TAIL)
  },
  attendance: {
    sheet: '勤怠', read: 'mgr', write: 'mgr', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['staffId', 'スタッフID', 't'], ['name', '名前', 't'],
      ['kind', '種別', 't'], ['hours', '勤務時間', 'n'], ['wage', '時給', 'n'], ['transport', '交通費', 'n'],
      ['amount', '金額（手打ち）', 'n'], ['cost', '人件費', 'n'], ['status', '状態', 't'], ['edited', '修正あり', 'b']
    ].concat(COMMON_TAIL)
  },
  // 科目は 飲食物／備品／その他。その他は内容が必須で、表示は「その他（花）」
  purchases: {
    sheet: '仕入れ', read: 'mgr', write: 'mgr', dateKey: 'date',
    cols: [
      ['id', 'ID', 't'], ['date', '日付', 't'], ['category', '科目', 't'], ['note', '内容', 't'],
      ['label', '科目（表示）', 't'], ['shop', '店名', 't'], ['amount', '金額', 'n'],
      ['paidFrom', '支払い元', 't'], ['moveId', '出し入れID', 't'],
      ['receipts', 'レシート', 'j'], ['source', '入力方法', 't'], ['status', '状態', 't'], ['edited', '修正あり', 'b']
    ].concat(COMMON_TAIL)
  },
  fixedCosts: {
    sheet: '固定費', read: 'mgr', write: 'mgr', dateKey: 'month',
    cols: [
      ['id', 'ID', 't'], ['month', '月', 't'], ['item', '項目', 't'], ['amount', '金額', 'n'], ['status', '状態', 't'], ['edited', '修正あり', 'b']
    ].concat(COMMON_TAIL)
  },
  events: {
    sheet: '予定', read: 'open', write: 'staff', dateKey: 'date',
    hidden: { contactName: 'eventContact', contactInfo: 'eventContact' },
    cols: [
      ['id', 'ID', 't'], ['date', '日付', 't'], ['type', '種類', 't'], ['title', '内容', 't'],
      ['people', '人数', 'n'], ['contactName', '幹事', 't'], ['contactInfo', '幹事の連絡先', 't'],
      ['expectedAmount', '見込みの金額', 'n'], ['startTime', '開始', 't'], ['endTime', '終了', 't'],
      ['status', '状態', 't']
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
  quickAdds: [500, 800, 1000],
  bizDayCutoffHour: 12,
  openTime: '18:00',
  closeTime: '25:00',
  goLiveDate: '2026-11-01',
  pointCountsAsSales: true,
  defaultWage: 2000,
  cancelReasons: ['打ち間違い', '会計のやり直し', '金額の修正', 'その他'],
  deleteReasons: ['打ち間違い', '二重に登録', '来店取りやめ', 'その他'],
  purchaseCategories: ['飲食物', '備品', 'その他'],
  purchaseRules: [],
  cashInReasons: ['オーナーの補充', 'その他'],
  fixedCostItems: ['家賃', 'ガス', '電気', 'カラオケ'],
  eventTypes: ['団体', '日本酒の会', '貸切'],
  visibility: { eventContact: true },
  // days=0 はその営業日だけ。1なら前日まで。未来の日付（予定・希望休）はいつでも
  staffEdit: { days: 0, tables: ['visits', 'closings', 'days', 'cashMoves', 'events', 'requests'] },
  targets: { monthlySales: 1000000, dailyGuests: 10, monthlyEvents: 0 }
};

var SETTING_LABELS = {
  nomiPrice: '飲み放題の料金（1人・円）',
  nomiMinutes: '飲み放題の時間（分）',
  lastOrderMinutes: 'ラストオーダー（残り何分で知らせるか。イベントは終了の何分前か）',
  extensions: '延長の種類（名前・1人の料金・時間）',
  quickAdds: '追加のボタンの金額',
  bizDayCutoffHour: '営業日の切り替え時刻（この時より前は前日の営業日）',
  openTime: '開店時刻',
  closeTime: '閉店時刻',
  goLiveDate: '運用開始日（これより前の記録は試運転）',
  pointCountsAsSales: 'ポイントを売上に含める',
  defaultWage: '時給の初期値（円）',
  cancelReasons: '店内に戻す理由',
  deleteReasons: '入店を削除する理由',
  purchaseCategories: '仕入れの科目',
  purchaseRules: '仕入れの科目を決めるルール（店名の言葉 → 科目）',
  cashInReasons: 'レジに入れる理由',
  fixedCostItems: '固定費の項目',
  eventTypes: '予定の種類',
  visibility: 'バイトに見せる範囲',
  staffEdit: 'バイトが直せる範囲（何日前まで・どの記録）',
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
    .addSeparator()
    .addItem('月次を作り直す', 'buildMonthlySheet')
    .addSeparator()
    .addItem('テストの行を消す', 'deleteTestRows')
    .addItem('共有トークンを作り直す', 'rotateTokenWithConfirm')
    .addToUi();
}

// ===== 試運転の前の片付け =====
var CLEANUP_TABLES = ['visits', 'closings', 'cashMoves', 'days', 'purchases', 'log', 'attendance', 'fixedCosts', 'events', 'requests', 'staff'];
// 日付で消す表（運用開始日より前は試運転）。予定・希望休・スタッフは、名前が「テスト」で始まる行だけ消す
var CLEANUP_BY_DATE = ['visits', 'closings', 'cashMoves', 'days', 'purchases', 'log', 'attendance', 'fixedCosts'];
var TEST_NAME_KEY = { visits: 'name', attendance: 'name', events: 'title', requests: 'name', staff: 'name' };

/**
 * 消す行を探す（消さない）。
 * 名前が「テスト」で始まる来客／試運転の印が付いた行／運用開始日より前の日付の行（印の列がない表も、これで拾う）
 * @return {{key: string, sheet: string, rows: number[]}[]} rows はシートの行番号
 */
function findTestRows_() {
  var goLive = String(getSettings_().goLiveDate || '');
  return CLEANUP_TABLES.map(function (key) {
    var def = TABLES[key];
    var rows = [];
    readTable_(def).rows.forEach(function (r, i) {
      var d = String(r[def.dateKey] || '').slice(0, 10);
      var isTestName = !!TEST_NAME_KEY[key] && /^テスト/.test(String(r[TEST_NAME_KEY[key]] || ''));
      var beforeGoLive = CLEANUP_BY_DATE.indexOf(key) >= 0 && goLive && d && d < goLive.slice(0, d.length);
      if (isTestName || r.trial === true || beforeGoLive) rows.push(i + 2);
    });
    return { key: key, sheet: def.sheet, rows: rows };
  });
}

/** スプシのメニュー：件数を出して、確かめてから消す */
function deleteTestRows() {
  var ui = SpreadsheetApp.getUi();
  var found = findTestRows_();
  var total = found.reduce(function (a, f) { return a + f.rows.length; }, 0);
  if (!total) { ui.alert('消す行はありません。'); return; }
  var list = found.map(function (f) { return f.sheet + '：' + f.rows.length + '行'; }).join('\n');
  var msg = '次の行を消します。元には戻せません。\n\n' + list +
    '\n\n消すのは、試運転の印が付いた行・運用開始日（' + getSettings_().goLiveDate + '）より前の日付の行・名前が「テスト」で始まる行です。' +
    '\n予定・希望休・スタッフは、名前が「テスト」で始まる行だけ消します。設定は消しません。\n\n消してよいですか？';
  if (ui.alert('テストの行を消す', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) { ui.alert('やめました。何も消していません。'); return; }
  var done = withLock_(deleteTestRows_);
  ui.alert('消しました。\n\n' + done.map(function (f) { return f.sheet + '：' + f.rows.length + '行'; }).join('\n'));
}

/** 消す（ロックの中で探し直し、下の行から、続いている行はまとめて消す）。最後に操作履歴に1行残す */
function deleteTestRows_() {
  var found = findTestRows_();
  var ss = SpreadsheetApp.getActive();
  found.forEach(function (f) {
    var sh = ss.getSheetByName(f.sheet);
    var rows = f.rows.slice().sort(function (a, b) { return b - a; });
    for (var i = 0; i < rows.length; i++) {
      var end = rows[i], start = end;
      while (i + 1 < rows.length && rows[i + 1] === start - 1) start = rows[++i];
      sh.deleteRows(start, end - start + 1);
    }
  });
  var counts = {};
  found.forEach(function (f) { counts[f.sheet] = f.rows.length; });
  appendLog_({ type: 'テストの行を消す', table: '', targetId: '', after: counts, by: 'スプシのメニュー' }, { deviceId: 'spreadsheet' });
  return found;
}

/** スプシのメニュー：確かめてから共有トークンを作り直す */
function rotateTokenWithConfirm() {
  var ui = SpreadsheetApp.getUi();
  var msg = '作り直すと、今つないでいる端末（タブレット・スマホ）はすべて、新しいトークンを入れ直すまで送れなくなります。' +
    '\n先に、すべての端末の上の表示が「送信済み」（送信待ち0件）であることを確かめてください。\n\n作り直してよいですか？';
  if (ui.alert('共有トークンを作り直す', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) { ui.alert('やめました。トークンはそのままです。'); return; }
  rotateToken();
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
    case 'monthly': {
      requireMgr_(ctx);
      var month = String(body.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) fail_('bad_month', '月の形が違います（例：2026-11）。');
      return ok_({ summary: monthlySummary_(month, settings), prev: monthlySummary_(prevMonth_(month), settings) });
    }
    case 'buildMonthlySheet':
      requireMgr_(ctx);
      return ok_(withLock_(buildMonthlySheet_));
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
    var r = upsert_(key, byTable[key], ctx);
    results = results.concat(r);
    if (key === 'cashMoves') {
      var okIds = byTable[key].filter(function (op, i) { return r[i] && r[i].ok; }).map(function (op) { return String(op.id); });
      syncPurchasesFromMoves_(okIds, ctx);
    }
  });
  return results;
}

/**
 * レジからの出金を仕入れにも写す（仕入れのID＝'cm-'＋出し入れのID。何度写しても1件）。
 * 出金を消したら（または入金に変えたら）仕入れも「削除」にする。バイトの出金でも写せるように、ここは店長の権限で書く
 */
function syncPurchasesFromMoves_(ids, ctx) {
  if (!ids.length) return;
  var moves = readTable_(TABLES.cashMoves).rows.filter(function (m) { return ids.indexOf(m.id) >= 0; });
  var existing = {};
  readTable_(TABLES.purchases).rows.forEach(function (p) { existing[p.id] = true; });
  var ops = [];
  moves.forEach(function (m) {
    var pid = 'cm-' + m.id;
    var isOut = m.type === '出金' && m.status !== '削除';
    if (!isOut && !existing[pid]) return;
    ops.push({
      opId: 'sys-' + pid, id: pid, data: {
        date: m.bizDate, category: m.category, note: m.category === 'その他' ? m.note : '',
        label: purchaseLabel_(m.category, m.note), shop: '', amount: m.amount,
        paidFrom: 'レジから', moveId: m.id, source: 'レジの出し入れ', status: isOut ? '有効' : '削除',
        createdAt: m.createdAt, updatedAt: m.updatedAt, deviceId: m.deviceId
      }
    });
  });
  if (ops.length) upsert_('purchases', ops, { mgr: true, settings: ctx.settings, deviceId: ctx.deviceId });
}

/** 科目の表示。その他は「その他（花）」 */
function purchaseLabel_(category, note) {
  return category === 'その他' ? 'その他（' + (note || '') + '）' : String(category || '');
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
    if (tableKey === 'log') data.by = ctx.by || (ctx.mgr ? '店長' : 'スタッフ');
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
  upsert_('log', [{ opId: e.id, id: e.id, data: e }], { mgr: entry.by === '店長', by: entry.by, deviceId: ctx.deviceId });
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

// ===== 月次 =====
// アプリの分析画面とスプシの「月次」タブは、どちらもここで計算する（数字を1か所にそろえる）
// 運用開始日より前の記録（試運転）は数えない。8〜10月は「過去の月次」タブ（管理シートからの取り込み）から読む
var LEGACY_SHEET = '過去の月次';

function monthOf_(d) { return String(d || '').slice(0, 7); }
function prevMonth_(m) { var p = m.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 2, 1)).toISOString().slice(0, 7); }
function counted_(d, goLive) { d = String(d || ''); return !goLive || d >= goLive.slice(0, Math.min(10, d.length)); }

/** その月の数字。legacy=true は「過去の月次」タブから読んだもの */
function monthlySummary_(month, settings) {
  settings = settings || getSettings_();
  var goLive = String(settings.goLiveDate || '');
  if (goLive && month < goLive.slice(0, 7)) {
    var legacy = legacySummary_(month);
    if (legacy) return legacy;
  }
  var n = function (v) { return Number(v) || 0; };
  var inMonth = function (d) { return monthOf_(d) === month && counted_(d, goLive); };
  var s = {
    month: month, legacy: false, sales: 0, guests: 0, groups: 0, cash: 0, cashless: 0, point: 0,
    nomi: 0, tanpin: 0, event: 0, eventGroups: 0, openDays: 0, closedDays: 0, zeroDays: [],
    purchases: { '飲食物': 0, '備品': 0, 'その他': 0 }, otherNotes: [], purchaseTotal: 0,
    fixed: {}, fixedTotal: 0, laborFixed: [], laborOthers: { cost: 0, count: 0, names: [] }, laborTotal: 0,
    plannedEvents: 0
  };
  var kindKey = { '飲み放題': 'nomi', '単品': 'tanpin', 'イベント': 'event' };
  var openDays = {};
  readTable_(TABLES.visits).rows.forEach(function (v) {
    if (v.status !== '退店' || v.trial === true || !inMonth(v.bizDate)) return;
    var amount = n(v.total) - (settings.pointCountsAsSales === false ? n(v.point) : 0);
    s.sales += amount; s.guests += n(v.people); s.groups += 1;
    s.cash += n(v.cash); s.cashless += n(v.cashless); s.point += n(v.point);
    if (kindKey[v.kind]) s[kindKey[v.kind]] += amount;
    if (v.kind === 'イベント') s.eventGroups += 1;
    openDays[v.bizDate] = true;
  });
  readTable_(TABLES.closings).rows.forEach(function (c) {
    if (c.trial === true || !inMonth(c.bizDate)) return;
    openDays[c.bizDate] = true;
    if (n(c.sales) === 0) s.zeroDays.push(c.bizDate);
  });
  s.openDays = Object.keys(openDays).length;
  readTable_(TABLES.days).rows.forEach(function (d) { if (d.closed === true && inMonth(d.bizDate)) s.closedDays += 1; });
  readTable_(TABLES.purchases).rows.forEach(function (p) {
    if (p.status === '削除' || !inMonth(p.date)) return;
    var cat = s.purchases[p.category] != null ? p.category : 'その他';
    s.purchases[cat] += n(p.amount); s.purchaseTotal += n(p.amount);
    if (cat === 'その他' && p.note && s.otherNotes.indexOf(p.note) < 0) s.otherNotes.push(p.note);
  });
  readTable_(TABLES.fixedCosts).rows.forEach(function (f) {
    if (f.status === '削除' || f.month !== month || !counted_(f.month, goLive)) return;
    s.fixed[f.item] = (s.fixed[f.item] || 0) + n(f.amount); s.fixedTotal += n(f.amount);
  });
  var byStaff = {};
  readTable_(TABLES.attendance).rows.forEach(function (a) {
    if (a.status === '削除' || !inMonth(a.bizDate)) return;
    s.laborTotal += n(a.cost);
    if (a.kind === '手打ち') {
      s.laborOthers.cost += n(a.cost); s.laborOthers.count += 1;
      if (a.name && s.laborOthers.names.indexOf(a.name) < 0) s.laborOthers.names.push(a.name);
      return;
    }
    var k = a.staffId || a.name;
    var r = byStaff[k] = byStaff[k] || { name: a.name, days: 0, hours: 0, transport: 0, cost: 0 };
    r.days += 1; r.hours += n(a.hours); r.transport += n(a.transport); r.cost += n(a.cost);
  });
  s.laborFixed = Object.keys(byStaff).map(function (k) { return byStaff[k]; });
  readTable_(TABLES.events).rows.forEach(function (e) {
    if (e.status !== '削除' && inMonth(e.date) && (settings.eventTypes || []).indexOf(e.type) >= 0) s.plannedEvents += 1;
  });
  return finishSummary_(s, settings);
}

/** 合計・率・目標など、記録から出す数字を足す */
function finishSummary_(s, settings) {
  var t = settings.targets || {};
  s.expenses = s.purchaseTotal + s.fixedTotal + s.laborTotal;
  s.profitBeforeMgr = s.sales - s.expenses;
  s.mgrFee = null; // 店長の報酬（利益連動）。計算はあとで足す
  s.avgPerGuest = s.guests ? Math.round(s.sales / s.guests) : 0;
  s.normalDailyAvg = s.openDays ? Math.round((s.sales - s.event) / s.openDays) : 0;
  s.laborRate = s.sales ? Math.round(s.laborTotal / s.sales * 1000) / 10 : 0;
  s.costRate = s.sales ? Math.round(s.purchases['飲食物'] / s.sales * 1000) / 10 : 0;
  s.target = {
    monthlySales: Number(t.monthlySales) || 0, salesRate: t.monthlySales ? Math.round(s.sales / t.monthlySales * 100) : 0,
    dailyGuests: Number(t.dailyGuests) || 0, avgGuestsPerDay: s.openDays ? Math.round(s.guests / s.openDays * 10) / 10 : 0,
    monthlyEvents: Number(t.monthlyEvents) || 0, events: s.eventGroups
  };
  return s;
}

/** 「過去の月次」タブ（1列目が項目、2行目から。1行目が月 YYYY-MM）から、その月の数字を読む。なければ null */
function legacySummary_(month) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEGACY_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = vals[0].map(function (h) { return h instanceof Date ? Utilities.formatDate(h, TZ, 'yyyy-MM') : String(h).slice(0, 7); }).indexOf(month);
  if (col < 1) return null;
  var get = function (label) {
    for (var i = 1; i < vals.length; i++) if (String(vals[i][0]).trim() === label) return Number(vals[i][col]) || 0;
    return 0;
  };
  var s = {
    month: month, legacy: true, sales: get('売上'), guests: get('来客数'), groups: get('組数'),
    cash: get('現金'), cashless: get('キャッシュレス'), point: get('ポイント'),
    nomi: 0, tanpin: 0, event: get('イベント'), eventGroups: get('イベントの組数'), openDays: get('営業日数'),
    closedDays: get('店休日'), zeroDays: [], purchases: { '飲食物': get('飲食物'), '備品': get('備品'), 'その他': get('その他') },
    otherNotes: [], fixed: {}, fixedTotal: 0, laborFixed: [], laborOthers: { cost: get('人件費（その他）'), count: 0, names: [] },
    plannedEvents: 0
  };
  s.purchaseTotal = s.purchases['飲食物'] + s.purchases['備品'] + s.purchases['その他'];
  ['家賃', 'ガス電気カラオケ'].forEach(function (k) { var v = get(k); if (v) { s.fixed[k] = v; s.fixedTotal += v; } });
  vals.slice(1).forEach(function (r) {
    var m = /^人件費（(.+)）$/.exec(String(r[0]).trim());
    if (m && m[1] !== 'その他') s.laborFixed.push({ name: m[1], days: 0, hours: 0, transport: 0, cost: Number(r[col]) || 0 });
  });
  s.laborTotal = s.laborOthers.cost + s.laborFixed.reduce(function (a, r) { return a + r.cost; }, 0);
  return finishSummary_(s, getSettings_());
}

/** スプシの「月次」タブを作り直す（項目×月） */
function buildMonthlySheet_() {
  var settings = getSettings_();
  var now = Utilities.formatDate(now_(), TZ, 'yyyy-MM');
  var first = String(settings.goLiveDate || now).slice(0, 7);
  var legacy = SpreadsheetApp.getActive().getSheetByName(LEGACY_SHEET);
  if (legacy && legacy.getLastColumn() > 1) {
    legacy.getRange(1, 2, 1, legacy.getLastColumn() - 1).getValues()[0].forEach(function (h) {
      var m = h instanceof Date ? Utilities.formatDate(h, TZ, 'yyyy-MM') : String(h).slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m) && m < first) first = m;
    });
  }
  var months = [];
  for (var m = first; m <= now; m = nextMonth_(m)) months.push(m);
  var sums = months.map(function (mm) { return monthlySummary_(mm, settings); });
  var staffNames = [], fixedItems = [];
  sums.forEach(function (s) {
    s.laborFixed.forEach(function (r) { if (staffNames.indexOf(r.name) < 0) staffNames.push(r.name); });
    Object.keys(s.fixed).forEach(function (k) { if (fixedItems.indexOf(k) < 0) fixedItems.push(k); });
  });
  var rows = [
    ['売上', function (s) { return s.sales; }],
    ['　現金', function (s) { return s.cash; }], ['　キャッシュレス', function (s) { return s.cashless; }], ['　ポイント', function (s) { return s.point; }],
    ['　飲み放題', function (s) { return s.nomi; }], ['　単品', function (s) { return s.tanpin; }], ['　イベント', function (s) { return s.event; }],
    ['来客数', function (s) { return s.guests; }], ['組数', function (s) { return s.groups; }], ['客単価', function (s) { return s.avgPerGuest; }],
    ['営業日数', function (s) { return s.openDays; }], ['店休日', function (s) { return s.closedDays; }],
    ['売上0円の営業日', function (s) { return s.zeroDays.join('、'); }], ['通常営業の1日平均', function (s) { return s.normalDailyAvg; }],
    ['イベントの組数', function (s) { return s.eventGroups; }],
    ['仕入れ', function (s) { return s.purchaseTotal; }],
    ['　飲食物', function (s) { return s.purchases['飲食物']; }], ['　備品', function (s) { return s.purchases['備品']; }],
    ['　その他', function (s) { return s.purchases['その他']; }], ['　その他の内容', function (s) { return s.otherNotes.join('・'); }],
    ['固定費', function (s) { return s.fixedTotal; }]
  ].concat(fixedItems.map(function (k) { return ['　' + k, function (s) { return s.fixed[k] || 0; }]; }))
    .concat([['人件費', function (s) { return s.laborTotal; }]])
    .concat(staffNames.map(function (nm) { return ['　' + nm, function (s) { var r = s.laborFixed.filter(function (x) { return x.name === nm; })[0]; return r ? r.cost : 0; }]; }))
    .concat([
      ['　人件費（その他）', function (s) { return s.laborOthers.cost; }],
      ['支出', function (s) { return s.expenses; }],
      ['差し引き（店長報酬前）', function (s) { return s.profitBeforeMgr; }],
      ['店長報酬（あとで）', function () { return ''; }],
      ['人件費率（%）', function (s) { return s.laborRate; }],
      ['原価率（飲食物・%）', function (s) { return s.costRate; }],
      ['取り込み', function (s) { return s.legacy ? '管理シート' : 'アプリ'; }]
    ]);
  var values = [['項目'].concat(months)].concat(rows.map(function (r) { return [r[0]].concat(sums.map(r[1])); }));
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('月次') || ss.insertSheet('月次');
  if (sh.getLastRow()) sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).clearContent();
  if (sh.getMaxColumns() < values[0].length) sh.insertColumnsAfter(sh.getMaxColumns(), values[0].length - sh.getMaxColumns());
  var rng = sh.getRange(1, 1, values.length, values[0].length);
  rng.setNumberFormat('@');
  if (values[0].length > 1) sh.getRange(2, 2, values.length - 1, values[0].length - 1).setNumberFormat('#,##0.#');
  rng.setValues(values);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  protect_(sh);
  return { months: months, rows: values.length - 1 };
}

function nextMonth_(m) { var p = m.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 1)).toISOString().slice(0, 7); }

/** スプシのメニュー */
function buildMonthlySheet() {
  var r = buildMonthlySheet_();
  notify_('「月次」タブを作り直しました（' + r.months[0] + '〜' + r.months[r.months.length - 1] + '）。');
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
