/**
 * お香芽 業務アプリ GAS（新しいスプシに付けて使う）
 *
 * - 直すのはこのファイル。林がApps Scriptのエディタに貼り替えてデプロイする
 * - リポジトリは公開なので、ここに秘密情報を書かない（スクリプトプロパティに置く）
 * - 画面を直してもGASを貼り替えなくて済むように、記録は「表の名前とID」で汎用に扱う
 */

var APP_VERSION = '0.18.0';
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
      ['eventId', '予定ID', 't'], ['trial', '試運転', 'b'],
      ['unitPrice', '1人の単価', 'n'], ['basePeople', '入店時の人数', 'n'] // イベント：金額＝人数×単価。人数＝入店時の人数＋卓の −／＋（追加の「人数」）
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
      ['openCash', '開店時の現金', 'n'], ['cashIn', '入金', 'n'], ['cashOut', '出金', 'n'], ['collected', '回収', 'n'],
      ['expectedCash', 'あるはずの現金', 'n'], ['countedCash', '数えた現金', 'n'], ['diff', '差額', 'n'],
      ['trial', '試運転', 'b']
    ].concat(COMMON_TAIL)
  },
  // レジの出し入れ。種類は 入金／出金／回収（オーナーがレジから抜いた分）／小口から払う／小口からレジへ。
  // 出金は「出した額（金額）→ 内訳」（仕入れ・スタッフ・小口・戻す）。前の版の出金（内訳なし）は全額が仕入れ。
  // GASが、内訳の仕入れを仕入れ（レジから／小口から）に、スタッフへの支払いを勤怠（手打ち）に写す（消すと写した行も消す）
  // 小口現金の残高 ＝ 設定 pettyCashStart ＋ 出金の内訳の「小口」− 小口から払う − 小口からレジへ（画面の calc.js で数える）
  cashMoves: {
    sheet: 'レジの出し入れ', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['at', '日時', 't'], ['type', '入金・出金', 't'],
      ['amount', '金額', 'n'], ['category', '科目', 't'], ['note', '内容', 't'], ['reason', '入金の理由', 't'],
      ['purchaseId', '仕入れID', 't'], ['status', '状態', 't'], ['lines', '内訳', 'j']
    ].concat(COMMON_TAIL)
  },
  days: {
    sheet: '営業日', read: 'open', write: 'staff', dateKey: 'bizDate',
    cols: [
      ['id', 'ID', 't'], ['bizDate', '営業日', 't'], ['closed', '店休日', 'b'],
      ['shiftPlan', 'シフト予定', 't'], ['shiftActual', 'シフト実績', 't'],
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
      ['status', '状態', 't'], ['unitPrice', '1人の単価', 'n'] // 見込みの金額＝人数×単価（画面が計算して入れる）
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
  defaultWage: 0, // 時給の初期値。金額は設定で入れる（コードには持たない）
  cancelReasons: ['打ち間違い', '会計のやり直し', '金額の修正', 'その他'],
  deleteReasons: ['打ち間違い', '二重に登録', '来店取りやめ', 'その他'],
  purchaseCategories: ['飲食物', '備品', 'その他'],
  purchaseRules: [],
  cashInReasons: ['オーナーの補充', 'その他'],
  staffCanCollect: true, // バイトも、オーナーの回収（レジから抜いた分）を入れられる
  fixedCostItems: ['家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'],
  eventTypes: ['団体', '日本酒の会', '貸切'],
  visibility: { eventContact: true, countdown: true, pastDays: true }, // countdown：月の売上のカウンター（あと いくら）をバイトに見せる。pastDays：過ぎた日の締めと会計を見せる
  // days=0 はその営業日だけ。1なら前日まで。未来の日付（予定・希望休）はいつでも
  staffEdit: { days: 0, tables: ['visits', 'closings', 'days', 'cashMoves', 'events', 'requests'] },
  targets: { monthlySales: 1000000, dailyGuests: 10, monthlyEvents: 0 },
  managerFee: 0, // 店長報酬（月額）。金額は設定で入れる（コードには持たない）。店長だけが見られる（バイトには返さない）
  managerName: '岡本', // 店長の名前。シフトの選び方（アプリの予定・閉店・スプシの月のタブ）に出る
  monthlyTargets: {}, // 月ごとの売上目標（'2026-11': 1200000 の形）。ない月は targets.monthlySales
  // 月のタブのシフトのプルダウン：列2・列3・列4の選択肢。列5は、店長とスタッフと「店休日」
  shiftColumnChoices: [['店休日', '岡本', '加奈'], ['加奈', '優輝'], ['優輝']],
  pettyCashStart: 0, // 小口現金の最初の残高（わかったら店長が入れる。入れるまでは0から数える）
  eventUnitPrices: [3000, 4000, 5000], // イベントの1人の単価のボタン（予定と入店）
  trialStartDate: '2026-10-16' // 試運転を始めた日。この日から運用開始日の前日までのアプリの記録を「10月（アプリ）」のタブに出す（集計には入れない）
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
  goLiveDate: '運用開始日＝完全移行の日（これより前のアプリの記録は試運転。月の数字は管理シートを使う）',
  pointCountsAsSales: 'ポイントを売上に含める',
  defaultWage: '時給の初期値（円）',
  cancelReasons: '店内に戻す理由',
  deleteReasons: '入店を削除する理由',
  purchaseCategories: '仕入れの科目',
  purchaseRules: '仕入れの科目を決めるルール（店名の言葉 → 科目）',
  cashInReasons: 'レジに入れる理由',
  staffCanCollect: 'バイトも、オーナーの回収を入れられる',
  fixedCostItems: '固定費の項目',
  eventTypes: '予定の種類',
  visibility: 'バイトに見せる範囲',
  staffEdit: 'バイトが直せる範囲（何日前まで・どの記録）',
  targets: '目標',
  managerFee: '店長報酬（月額・円。店長だけが見られる）',
  managerName: '店長の名前（シフトの選び方に出る）',
  monthlyTargets: '月ごとの売上目標（月 → 円）',
  shiftColumnChoices: '月のタブのシフトのプルダウン（列2・列3・列4の選択肢）',
  pettyCashStart: '小口現金の最初の残高（円）',
  eventUnitPrices: 'イベントの1人の単価のボタン（円）',
  trialStartDate: '試運転を始めた日（この日から運用開始日の前日までのアプリの記録を「10月（アプリ）」のタブに見るためだけに出す）'
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
    .addItem('管理シートから取り込み直す', 'reimportLegacy')
    .addItem('月次を作り直す', 'buildMonthlySheet')
    .addItem('来月のタブを作る', 'createNextMonthTab')
    .addItem('月のタブを作り直す（11月以降）', 'buildAppMonthTabs')
    .addItem('手打ちのタブを作る', 'createHandTab')
    .addItem('プルダウンの色を月のタブに反映', 'syncPlanColors')
    .addItem('スプシで打った予定の取り込みを確かめる', 'checkSheetSync')
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
      if (key === 'days' && r.memo === LEGACY_PLAN_MARK) return; // 管理シートから取り込んだ予定（9月・10月のシフト）は消さない
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
  var trigMsg = ensureTriggers_();
  removeOldReconcileTab_(ss);
  removeLastColumns_(ss);
  var handMsg = autoHandTab_();
  var blank = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var props = PropertiesService.getScriptProperties();
  var lines = ['初期設定が終わりました。', trigMsg].concat(handMsg ? [handMsg] : []);
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
function protect_(sh, unprotected) {
  var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
  p.setDescription('記録はアプリから直してください（直接の書き換えは林だけ）');
  var me = Session.getEffectiveUser();
  p.addEditor(me);
  var others = p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); });
  if (others.length) p.removeEditors(others);
  if (p.canDomainEdit()) p.setDomainEdit(false);
  if (unprotected) p.setUnprotectedRanges(unprotected); // 店長もスプシで打てる範囲（月のタブのシフト・イベント・見込み）
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
      return ok_({ settings: publicSettings_(settings, ctx), mgr: ctx.mgr, version: APP_VERSION, serverTime: nowIso_() });
    case 'fetch':
      if (body.table === 'days' || body.table === 'events') catchUpOnFetch_(settings); // スプシで打った予定の取りこぼしを拾う（1分に1回まで）
      return ok_({ rows: fetchRows_(body.table, body.from, body.to, ctx) });
    case 'sync':
      return ok_({ results: withLock_(function () { var res = applyOps_(body.ops || [], ctx); rebuildTabsAfterSync_(body.ops); return res; }) });
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
      var summary = monthlySummary_(month, settings);
      summary.pendingExpected = pendingExpected_(month, settings); // まだ来ていない日のイベントの見込み（今日の画面の「あと」と同じ計算）
      return ok_({ summary: summary, prev: monthlySummary_(prevMonth_(month), settings) });
    }
    case 'countdown': {
      if (!canAccess_('countdown', ctx)) fail_('forbidden', 'この表示は今は見られません。');
      var cm = String(body.month || monthOf_(serverBizDate_(settings)));
      if (!/^\d{4}-\d{2}$/.test(cm)) fail_('bad_month', '月の形が違います（例：2026-11）。');
      return ok_(countdownSummary_(cm, settings));
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

/** 店長でない人には、店長だけが見られる設定（店長報酬）を返さない */
function publicSettings_(settings, ctx) {
  if (ctx.mgr) return settings;
  var s = JSON.parse(JSON.stringify(settings));
  delete s.managerFee;
  delete s.defaultWage;
  return s;
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
  var collectIds = null; // 回収の行のID（バイトに回収を許さない設定のときだけ読む）
  ops.forEach(function (op) {
    var def = TABLES[op && op.table];
    if (!def) { results.push({ opId: op && op.opId, ok: false, code: 'bad_table' }); return; }
    if (def.write === 'mgr' && !ctx.mgr) { results.push({ opId: op.opId, ok: false, code: 'forbidden' }); return; }
    if (op.table === 'cashMoves' && !ctx.mgr && ctx.settings.staffCanCollect === false) { // バイトに回収を許さない設定
      if (collectIds === null) {
        collectIds = {};
        readTable_(TABLES.cashMoves).rows.forEach(function (m) { if (m.type === '回収') collectIds[m.id] = true; });
      }
      if ((op.data && op.data.type === '回収') || collectIds[String(op.id)]) { results.push({ opId: op.opId, ok: false, code: 'forbidden' }); return; }
    }
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
 * レジの出し入れを、仕入れ・勤怠（人件費）に写す。バイトの出金でも写せるように、ここは店長の権限で書く（何度写しても同じ行）
 * - 前の版の出金（内訳なし）：全額を仕入れ 'cm-'＋出し入れのID（支払い元「レジから」）
 * - 内訳のある出金・小口から払う：内訳の仕入れ → 仕入れ、スタッフへの支払い → 勤怠（手打ち。月のタブは「スタッフ」の列）。
 *   ID は 'cm-'＋出し入れのID＋'-'＋内訳の行のID。支払い元は「レジから」／「小口から」。小口へ・レジに戻すは写さない
 * - 出し入れを消した・内訳から外した・入金に変えたときは、写した行を「削除」にする
 */
function syncPurchasesFromMoves_(ids, ctx) {
  if (!ids.length) return;
  var moves = readTable_(TABLES.cashMoves).rows.filter(function (m) { return ids.indexOf(m.id) >= 0; });
  var purchases = readTable_(TABLES.purchases).rows, attendance = readTable_(TABLES.attendance).rows;
  var pOps = [], aOps = [];
  moves.forEach(function (m) {
    var want = moveCopies_(m);
    var prefix = 'cm-' + m.id;
    var mine = function (id) { id = String(id); return id === prefix || id.indexOf(prefix + '-') === 0; };
    var stamp = { createdAt: m.createdAt, updatedAt: m.updatedAt, deviceId: m.deviceId };
    Object.keys(want.purchases).forEach(function (id) { pOps.push({ opId: 'sys-' + id, id: id, data: Object.assign(want.purchases[id], stamp) }); });
    Object.keys(want.attendance).forEach(function (id) { aOps.push({ opId: 'sys-' + id, id: id, data: Object.assign(want.attendance[id], stamp) }); });
    purchases.forEach(function (p) {
      if (mine(p.id) && !want.purchases[p.id] && p.status !== '削除') pOps.push({ opId: 'sys-del-' + p.id, id: p.id, data: { status: '削除', updatedAt: laterStamp_(m.updatedAt, p.updatedAt) } });
    });
    attendance.forEach(function (a) {
      if (mine(a.id) && !want.attendance[a.id] && a.status !== '削除') aOps.push({ opId: 'sys-del-' + a.id, id: a.id, data: { status: '削除', updatedAt: laterStamp_(m.updatedAt, a.updatedAt) } });
    });
  });
  var sys = { mgr: true, settings: ctx.settings, deviceId: ctx.deviceId };
  if (pOps.length) upsert_('purchases', pOps, sys);
  if (aOps.length) upsert_('attendance', aOps, sys);
}

/** 1つの出し入れから写す行（仕入れ・勤怠）。ID → 中身 */
function moveCopies_(m) {
  var out = { purchases: {}, attendance: {} };
  if (m.status === '削除' || (m.type !== '出金' && m.type !== '小口から払う')) return out;
  var from = m.type === '小口から払う' ? '小口から' : 'レジから';
  if (!Array.isArray(m.lines)) { // 前の版の出金（内訳なし）
    if (m.type !== '出金') return out;
    out.purchases['cm-' + m.id] = {
      date: m.bizDate, category: m.category, note: m.category === 'その他' ? m.note : '',
      label: purchaseLabel_(m.category, m.note), shop: '', amount: m.amount,
      paidFrom: from, moveId: m.id, source: 'レジの出し入れ', status: '有効'
    };
    return out;
  }
  m.lines.forEach(function (l) {
    if (!l || l.del || !l.id || !(Number(l.amount) > 0)) return;
    var id = 'cm-' + m.id + '-' + l.id;
    if (l.kind === '仕入れ') {
      out.purchases[id] = {
        date: m.bizDate, category: l.category, note: l.note || '',
        label: l.category === 'その他' ? purchaseLabel_(l.category, l.note) : String(l.category || '') + (l.note ? '（' + l.note + '）' : ''),
        shop: '', amount: Number(l.amount), paidFrom: from, moveId: m.id, source: 'レジの出し入れ', status: '有効'
      };
    } else if (l.kind === 'スタッフ') {
      var amt = Number(l.amount);
      out.attendance[id] = {
        bizDate: m.bizDate, staffId: '', name: String(l.name || ''), kind: '手打ち', hours: '', wage: '', transport: '',
        amount: amt, cost: amt, status: '有効', edited: false
      };
    }
  });
  return out;
}

/** 科目の表示。その他は「その他（花）」 */
function purchaseLabel_(category, note) {
  return category === 'その他' ? 'その他（' + (note || '') + '）' : String(category || '');
}

function upsert_(tableKey, ops, ctx) {
  var def = TABLES[tableKey];
  var t = readTable_(def);
  if (def.cols.some(function (c) { return t.header.indexOf(c[1]) < 0; })) { // 新しい版で足した列：初期設定の前でも、ここで足す（送られた値を捨てないため）
    ensureTableSheet_(SpreadsheetApp.getActive(), def);
    t = readTable_(def);
  }
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
    if (def.write === 'staff' && !staffCanWrite_(tableKey, def, cur, data, opContext_(ctx, op))) {
      results.push({ opId: op.opId, ok: false, code: 'forbidden' });
      return;
    }
    if (hit) {
      var stale = !ctx.force && data.updatedAt && cur.updatedAt && Date.parse(data.updatedAt) < Date.parse(cur.updatedAt);
      var visitArrays = tableKey === 'visits' && ('extras' in data || 'pays' in data);
      if (stale && !visitArrays) {
        results.push({ opId: op.opId, ok: true, stale: true, current: stripHidden_(def, cur, ctx) });
        return;
      }
      if (ctx.force && cur.updatedAt) data.updatedAt = laterStamp_(data.updatedAt, cur.updatedAt); // スプシで打った内容は、端末の時計が進んでいても勝つ
      var sent = merge_({}, data);
      var onlyArrays = {};
      if (visitArrays) { // 追加・受け取りは、IDごとに合わせる（古い操作でも、足した分・消した印は残す）
        ['extras', 'pays'].forEach(function (k) {
          if (!(k in data)) return;
          data[k] = mergeById_(cur[k], data[k]);
          onlyArrays[k] = data[k];
        });
      }
      var merged = stale ? merge_(cur, onlyArrays) : merge_(cur, data);
      if (tableKey === 'visits') merged = recomputeVisit_(merged);
      if (hit.fresh != null) fresh[hit.fresh] = merged;
      else { t.rows[hit.at] = merged; dirty[hit.at] = true; }
      var changed = stale || ['extras', 'pays', 'total', 'cash', 'cashless', 'point', 'people', 'base'].some(function (k) { return k in sent && JSON.stringify(merged[k]) !== JSON.stringify(sent[k]); });
      results.push(changed ? { opId: op.opId, ok: true, stale: stale || undefined, current: stripHidden_(def, merged, ctx) } : { opId: op.opId, ok: true });
      return;
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

/** IDを持つ要素の配列を、IDごとに合わせる（追加・受け取り）。消した印（del）は、一度付いたら外さない */
function mergeById_(serverArr, incomingArr) {
  var out = [], at = {};
  (Array.isArray(serverArr) ? serverArr : []).forEach(function (x) {
    if (x && x.id != null) at[x.id] = out.length;
    out.push(x);
  });
  (Array.isArray(incomingArr) ? incomingArr : []).forEach(function (x) {
    if (!x || x.id == null) return;
    if (x.id in at) { var cur = out[at[x.id]]; out[at[x.id]] = cur && cur.del && !x.del ? cur : x; }
    else { at[x.id] = out.length; out.push(x); }
  });
  return out;
}

/** 来客の合計と、支払い方法ごとの受け取りを、追加・受け取りから計算し直す（画面の calc.js と同じ式） */
function recomputeVisit_(row) {
  if (!Array.isArray(row.extras) && !Array.isArray(row.pays)) return row;
  var n = function (v) { return Number(v) || 0; };
  var live = function (a) { return (Array.isArray(a) ? a : []).filter(function (x) { return x && !x.del; }); };
  var sum = function (a, f) { return a.reduce(function (t, x) { return t + (f ? (f(x) ? n(x.amount) : 0) : n(x.amount)); }, 0); };
  var pays = live(row.pays);
  // イベント（単価あり）：人数＝入店時の人数＋卓の −／＋、基本の金額＝人数×単価（2台で同時に押しても、追加と同じくIDごとに合わせる）
  if (row.kind === 'イベント' && n(row.unitPrice) > 0 && row.basePeople !== '' && row.basePeople != null) {
    var adj = live(row.extras).reduce(function (t, x) { return t + (x.type === '人数' ? n(x.delta) : 0); }, 0);
    row.people = Math.max(0, n(row.basePeople) + adj);
    row.base = row.people * n(row.unitPrice);
  }
  row.total = n(row.base) + sum(live(row.extras));
  row.cash = sum(pays, function (p) { return p.method === '現金'; });
  row.cashless = sum(pays, function (p) { return p.method === 'キャッシュレス'; });
  row.point = sum(pays, function (p) { return p.method === 'ポイント'; });
  return row;
}

/** 2つの更新時刻のうち新しい方より、1秒あとの時刻 */
function laterStamp_(a, b) {
  var t = Math.max(Date.parse(a) || 0, Date.parse(b) || 0);
  return Utilities.formatDate(new Date(t + 1000), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
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

// ===== 管理シート（シフト及び売上等）の取り込み（9月・10月） =====
// 何度やり直しても二重にならない：取り込むたびに、その月の「過去の日別」の行と「過去の月次」の列をまるごと置き換える
// 列の位置ではなく見出しの名前で読む（9月と10月で列の並びが違う）。先の日付（予定の金額）は取り込まない
var LEGACY_DAILY_SHEET = '過去の日別';
var LEGACY_TABS = { '9月': '2026-09', '10月': '2026-10' };
// 見出し（改行・空白を除いたもの）→ 取り込み先。未確認のものは docs/取り込みの対応表.md に書いてある
var LEGACY_COLS = {
  '団体及びイベント': 'event', '加奈': 'laborKana', 'スタッフ': 'laborOther',
  '現金売上': 'cash', '売上': 'cash', // 10月の「売上」は現金として読む（未確認）
  '団体売上': 'group', 'キャッシュレス売上': 'cashless', 'ポイント売上': 'point',
  '食品支出': 'food', 'その他支出': 'other',
  '家賃': 'fixed:家賃電気', '家賃電気': 'fixed:家賃電気',
  'ガス電気カラオケ': 'fixed:ガス・カラオケ・Wi-Fi・電話', 'ガス・カラオケ・Wi-Fi・電話': 'fixed:ガス・カラオケ・Wi-Fi・電話',
  '保険': 'fixed:保険'
};
// 塗りなし・1行おきの色（これ以外の塗り、たとえば黄色は、月のタブにそのまま写す）
var LEGACY_PLAIN_BG = ['#ffffff', '#f6f8f9', '#f9f9f9', '#f3f3f3', '#efefef'];
var LEGACY_DAILY_COLS = ['日付', '曜日', 'シフト', '店休日', 'イベント', '人件費（加奈）', '人件費（その他）', '現金売上', '団体売上',
  'キャッシュレス売上', 'ポイント売上', '飲食物（食品支出）', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険', '取り込んだ日時'];

/** 1つの月のタブ（2次元の値）を読む。today より先の日付は読まない */
function parseLegacyTab_(values, month, today, backgrounds) {
  var norm = function (h) { return String(h == null ? '' : h).replace(/[\s　]/g, ''); };
  var header = values[0].map(norm);
  var col = {}, unknown = [];
  header.forEach(function (h, i) {
    if (i < 2 || !h) return;
    if (LEGACY_COLS[h]) col[LEGACY_COLS[h]] = i;
  });
  if (col.event == null && /^列\d*$/.test(header[6] || '')) col.event = 6; // 管理シートの11月は、団体及びイベントの列の見出しが「列 7」
  var eventCol = col.event != null ? col.event : 6;
  header.forEach(function (h, i) {
    if (i >= 2 && i <= eventCol) return; // シフトの欄（列1〜列4・1・2・3・3 2 など）と、団体及びイベントの列
    if (i >= 2 && h && !LEGACY_COLS[h]) unknown.push(h);
  });
  var n = function (v) { var x = Number(v); return isNaN(x) ? 0 : x; };
  var days = [];
  for (var r = 1; r < values.length; r++) {
    var a = values[r][0];
    if (String(a).indexOf('合計') >= 0) break;
    var d = Number(a);
    if (!d || d < 1 || d > 31) continue;
    var date = month + '-' + (d < 10 ? '0' : '') + d;
    if (date > today) break;
    var shift = [];
    for (var c = 2; c < eventCol; c++) { var nm = String(values[r][c] || '').trim(); if (nm) shift.push(nm); }
    var closed = shift.indexOf('店休日') >= 0;
    var shiftCells = [];
    for (var k = 2; k < 6; k++) shiftCells.push(k < eventCol ? String(values[r][k] || '').trim() : '');
    var bgRow = backgrounds && backgrounds[r] ? backgrounds[r] : [];
    var mark = function (c) { var b = String(bgRow[c] || '').toLowerCase(); return !b || LEGACY_PLAIN_BG.indexOf(b) >= 0 ? '' : b; };
    var bg = { shift: [mark(2), mark(3), mark(4), mark(5)], event: mark(eventCol) };
    var fixed = {};
    Object.keys(col).forEach(function (k) { if (k.indexOf('fixed:') === 0) fixed[k.slice(6)] = (fixed[k.slice(6)] || 0) + n(values[r][col[k]]); });
    var get = function (k) { return col[k] != null ? n(values[r][col[k]]) : 0; };
    days.push({
      date: date, dow: String(values[r][1] || ''), shift: shift.filter(function (x) { return x !== '店休日'; }), closed: closed, shiftCells: shiftCells, bg: bg,
      event: col.event != null ? String(values[r][col.event] || '').trim() : '',
      laborKana: get('laborKana'), laborOther: get('laborOther'), cash: get('cash'), group: get('group'),
      cashless: get('cashless'), point: get('point'), food: get('food'), other: get('other'), fixed: fixed
    });
  }
  return { days: days, unknown: unknown };
}

/** 日ごとの行から、月の合計（「過去の月次」の1列）を作る */
function legacyMonthTotals_(days, settings) {
  var sum = function (k) { return days.reduce(function (a, d) { return a + d[k]; }, 0); };
  var fixed = {};
  days.forEach(function (d) { Object.keys(d.fixed).forEach(function (k) { fixed[k] = (fixed[k] || 0) + d.fixed[k]; }); });
  var open = days.filter(function (d) { return !d.closed && d.shift.length; });
  var salesOf = function (d) { return d.cash + d.group + d.cashless + (settings.pointCountsAsSales === false ? 0 : d.point); };
  var t = {
    '売上': days.reduce(function (a, d) { return a + salesOf(d); }, 0),
    '現金': sum('cash'), 'キャッシュレス': sum('cashless'), 'ポイント': sum('point'), 'イベント': sum('group'),
    'イベントの組数': days.filter(function (d) { return d.event; }).length,
    '来客数': 0, '組数': 0,
    '営業日数': open.length, '店休日': days.filter(function (d) { return d.closed; }).length,
    '売上0円の営業日': open.filter(function (d) { return salesOf(d) === 0; }).map(function (d) { return d.date; }).join('、'),
    '飲食物': sum('food'), '備品': 0, 'その他': sum('other'),
    '人件費（加奈）': sum('laborKana'), '人件費（その他）': sum('laborOther')
  };
  Object.keys(fixed).forEach(function (k) { t['固定費：' + k] = fixed[k]; });
  return t;
}

/** 取り込み（ロックの中で呼ぶ）。source は管理シート（Spreadsheet）。結果を返す */
function importLegacy_(source, today) {
  var settings = getSettings_();
  var ss = SpreadsheetApp.getActive();
  var stamp = nowIso_();
  var result = [];
  // 過去の日別
  var daily = ss.getSheetByName(LEGACY_DAILY_SHEET) || ss.insertSheet(LEGACY_DAILY_SHEET);
  if (daily.getLastRow() === 0) daily.getRange(1, 1, 1, LEGACY_DAILY_COLS.length).setValues([LEGACY_DAILY_COLS]);
  daily.setFrozenRows(1);
  // 過去の月次
  var monthly = ss.getSheetByName(LEGACY_SHEET) || ss.insertSheet(LEGACY_SHEET);
  if (monthly.getLastRow() === 0) monthly.getRange(1, 1, 1, 1).setValues([['項目']]);
  monthly.setFrozenRows(1);
  monthly.setFrozenColumns(1);

  var parsedByTab = {};
  Object.keys(LEGACY_TABS).forEach(function (tab) {
    var month = LEGACY_TABS[tab];
    var sh = source.getSheetByName(tab);
    if (!sh) { result.push({ tab: tab, month: month, error: 'タブ「' + tab + '」が見つかりません' }); return; }
    var range = sh.getDataRange();
    var bgs = null;
    try { bgs = range.getBackgrounds(); } catch (e) { /* 塗りが読めなくても、数字は取り込む */ }
    var parsed = parseLegacyTab_(range.getValues(), month, today, bgs);
    parsedByTab[tab] = parsed;
    // 過去の日別：この月の行を消して、書き直す
    var last = daily.getLastRow();
    if (last > 1) {
      var dates = daily.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]).slice(0, 7); });
      for (var i = dates.length - 1; i >= 0; i--) {
        if (dates[i] !== month) continue;
        var end = i;
        while (i - 1 >= 0 && dates[i - 1] === month) i--;
        daily.deleteRows(i + 2, end - i + 1);
      }
    }
    if (parsed.days.length) {
      var rows = parsed.days.map(function (d) {
        return [d.date, d.dow, d.shift.join('、'), d.closed ? '店休日' : '', d.event, d.laborKana, d.laborOther, d.cash, d.group, d.cashless, d.point,
          d.food, d.other, d.fixed['家賃電気'] || 0, d.fixed['ガス・カラオケ・Wi-Fi・電話'] || 0, d.fixed['保険'] || 0, stamp];
      });
      var formats = rows.map(function () { return LEGACY_DAILY_COLS.map(function (c, j) { return j <= 4 || j === 16 ? '@' : '#,##0'; }); });
      appendRows_(daily, rows, formats);
    }
    // 過去の月次：この月の列をまるごと書き直す
    var totals = legacyMonthTotals_(parsed.days, settings);
    totals['取り込んだ日'] = stamp.slice(0, 10);
    totals['取り込んだ範囲'] = parsed.days.length ? parsed.days[0].date + '〜' + parsed.days[parsed.days.length - 1].date : 'なし';
    writeLegacyColumn_(monthly, month, totals);
    result.push({ tab: tab, month: month, days: parsed.days.length, until: totals['取り込んだ範囲'], sales: totals['売上'], unknown: parsed.unknown });
  });
  protect_(daily);
  protect_(monthly);
  // 月ごとのタブ（管理シートの9月と同じ形）
  var tpl = prepareMonthTemplate_(ss, source.getSheetByName('9月'));
  Object.keys(LEGACY_TABS).forEach(function (tab) {
    if (!parsedByTab[tab]) return;
    var legacySheet = writeMonthTab_(ss, tpl, tab, LEGACY_TABS[tab], parsedByTab[tab].days);
    if (trialAppMonths_(settings).indexOf(LEGACY_TABS[tab]) >= 0) writeTrialDiffRow_(legacySheet, LEGACY_TABS[tab], settings);
  });
  removeOldReconcileTab_(ss);
  arrangeTabs_(ss, monthTabNames_(ss, settings));
  hide_(daily); // 普段は見えなくする（アプリの分析が読む。確認したいときは、タブの一覧から表示できる）
  hide_(monthly);
  result.forEach(function (x) { x.tabs = tpl.how; });
  return result;
}

/** 「過去の月次」の、その月の列を書く（項目の行がなければ足す。ほかの月の列はそのまま） */
function writeLegacyColumn_(sh, month, totals) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return h instanceof Date ? Utilities.formatDate(h, TZ, 'yyyy-MM') : String(h); });
  var c = header.indexOf(month);
  if (c < 0) { c = header.length; sh.getRange(1, c + 1).setNumberFormat('@').setValue(month); }
  var lastRow = sh.getLastRow();
  var labels = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  Object.keys(totals).forEach(function (k) {
    if (labels.indexOf(k) < 0) { labels.push(k); sh.getRange(labels.length + 1, 1).setNumberFormat('@').setValue(k); }
  });
  var col = labels.map(function (k) { return [k in totals ? totals[k] : '']; });
  if (!col.length) return;
  // 文字（日付の並びなど）は書式なしテキストにしないと、スプシが日付に変えてしまう
  var rng = sh.getRange(2, c + 1, col.length, 1);
  rng.setNumberFormats(col.map(function (r) { return [typeof r[0] === 'number' ? '#,##0' : '@']; }));
  rng.setValues(col);
}

// ===== 月ごとのタブ（9月・10月）：管理シートの9月のタブと同じ形・同じ見た目 =====
// 「管理シートから取り込む」のたびに作り直す（何度やっても二重にならない）。
// 見た目は、管理シートの9月のタブをそのままコピーして使う（チップ・色・幅が元と同じになる）。
// コピーできなかったときは、同じ色・同じ並びで自前で作る（チップは色付きの塗りで代わりにする）。
var MONTH_TPL_SHEET = '月のひな形';
var MONTH_HEADERS = ['', '列 1', '列 2', '列 3', '列 4', '列 5', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', 'ポイント\n売上',
  '食品\n支出', 'その他\n支出', 'キャッシュ\nレス\n売上', '家賃\n電気', 'ガス・カラオケ\nWi-Fi・電話', '保険'];
var MONTH_WIDTHS = [60, 59, 100, 100, 100, 100, 212, 70, 92, 70, 70, 70, 71, 66, 66, 80, 110, 66];
var MONTH_ROWS = 31; // 日の行（2〜32行目）。33行目が合計
var YEN_FORMAT = '[$¥-411]#,##0';
var DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];
var GREEN = '#356854';
// チップの代わりの色（自前で作るときだけ）。管理シートのチップの色に近い色
var CHIP_COLORS = { '岡本': '#a9c0d6', '加奈': '#cfe0f0', '店休日': '#efe9dc', '優輝': '#d7dcf5', 'ひな': '#e6dcf0', 'みか': '#f0dce6', 'あいか': '#dcf0e6',
  '日': '#d6e9fb', '月': '#d3efe3', '火': '#d8eed0', '水': '#d3e5f5', '木': '#e0daf3', '金': '#cfe9d6', '土': '#e4eccf' };

function dowOf_(date) { var p = date.split('-').map(Number); return DOW_JP[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]; }
function daysInMonth_(month) { var p = month.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** 見本（管理シートの9月）をコピーして、月のタブの「ひな形」を作る。コピーできなければ自前で作る */
function prepareMonthTemplate_(ss, srcSheet) {
  var old = ss.getSheetByName(MONTH_TPL_SHEET);
  if (old) ss.deleteSheet(old);
  var tpl = null, how = 'plain';
  if (srcSheet && typeof srcSheet.copyTo === 'function') {
    try {
      tpl = srcSheet.copyTo(ss);
      tpl.setName(MONTH_TPL_SHEET);
      adjustCopiedTemplate_(tpl);
      how = 'copy';
    } catch (e) {
      console.error('見本のコピーに失敗：' + e.message);
      var broken = ss.getSheetByName(MONTH_TPL_SHEET) || tpl;
      if (broken) { try { ss.deleteSheet(broken); } catch (e2) { /* 消せなくても先へ */ } }
      tpl = null;
    }
  }
  if (!tpl) tpl = buildPlainTemplate_(ss);
  protect_(tpl);
  hide_(tpl);
  PropertiesService.getScriptProperties().setProperty('MONTH_TPL_HOW', how);
  return { sheet: tpl, how: how };
}

/** コピーした見本を、新しい形（日の中身を空に・固定費3列・保険の列・メモ欄なし）にそろえる */
function adjustCopiedTemplate_(sh) {
  sh.getRange(2, 1, MONTH_ROWS, 18).clearContent();
  sh.getRange(2, 1, MONTH_ROWS, 18).setBackground(null); // 元の黄色や灰色の塗りは、取り込むときに必要な所だけ付け直す
  var rest = sh.getMaxRows() - (MONTH_ROWS + 2);
  if (rest > 0) sh.getRange(MONTH_ROWS + 3, 1, rest, sh.getMaxColumns()).clear(); // 売上目標などのメモ欄は持ち込まない
  sh.getRange(1, 17, MONTH_ROWS + 2, 1).copyTo(sh.getRange(1, 18, MONTH_ROWS + 2, 1)); // 保険の列は、ガスの列と同じ書式で足す
  sh.getRange(1, 1, 1, 18).setValues([MONTH_HEADERS]).setWrap(true).setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 48);
  MONTH_WIDTHS.forEach(function (w, i) { if (i >= 14) sh.setColumnWidth(i + 1, w); });
  var bands = sh.getBandings();
  if (bands.length) bands[0].setRange(sh.getRange(1, 1, MONTH_ROWS + 2, 18));
  else styleBanding_(sh.getRange(1, 1, MONTH_ROWS + 2, 18));
}

function styleBanding_(range) {
  var b = range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  b.setHeaderRowColor(GREEN).setFirstRowColor('#ffffff').setSecondRowColor('#f6f8f9');
}

/** 自前のひな形：緑の見出し・1行おきの色・¥表示・合計の行（元のシートと同じ並び） */
function buildPlainTemplate_(ss) {
  var sh = ss.insertSheet(MONTH_TPL_SHEET);
  sh.getRange(1, 1, 1, 18).setValues([MONTH_HEADERS]).setBackground(GREEN).setFontColor('#ffffff').setFontWeight('bold')
    .setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 48);
  MONTH_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(2, 8, MONTH_ROWS + 1, 11).setNumberFormat(YEN_FORMAT);
  sh.getRange(2, 1, MONTH_ROWS, 1).setNumberFormat('0');
  sh.getRange(2, 1, MONTH_ROWS, 2).setHorizontalAlignment('center');
  sh.getRange(1, 1, MONTH_ROWS + 2, 18).setBorder(true, true, true, true, true, true, '#dddddd', SpreadsheetApp.BorderStyle.SOLID);
  styleBanding_(sh.getRange(1, 1, MONTH_ROWS + 2, 18));
  sh.getRange(MONTH_ROWS + 2, 1).setValue('合計').setFontWeight('bold');
  var cols = 'HIJKLMNOPQR'.split('');
  sh.getRange(MONTH_ROWS + 2, 8, 1, 11).setFormulas([cols.map(function (c) { return '=SUM(' + c + '2:' + c + (MONTH_ROWS + 1) + ')'; })]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  return sh;
}

/** タブを隠す（隠せなくても先へ進む） */
function hide_(sh) { try { sh.hideSheet(); } catch (e) { console.error("タブを隠せませんでした：" + e.message); } }

function blankRow_() { var r = []; for (var i = 0; i < 18; i++) r.push(''); return r; }

/**
 * 1か月分のタブを作る。days は parseLegacyTab_ か appMonthDays_ の結果。today までの日だけ金額が入る
 * isApp（11月以降のタブ）：あれば作り直さず中身だけ書き換える。団体及びイベントの横に「見込み」の列があり、
 * シフト・団体及びイベント・見込みをスプシから打てる範囲にする。作るときは「シフト表のひな形」をコピーする
 */
function writeMonthTab_(ss, tpl, label, month, days, isApp) {
  var sh = ss.getSheetByName(label);
  if (sh && isApp && String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') { ss.deleteSheet(sh); sh = null; } // 古い形のタブは作り直す
  if (sh && isApp) removeLastColumn_(sh);
  var width = isApp ? 19 : 18;
  if (sh && isApp) {
    sh.getRange(2, 1, MONTH_ROWS, width).setBackground(null); // 塗りは付け直す（タブそのものは作り直さない）
  } else {
    if (sh) ss.deleteSheet(sh);
    sh = tpl.sheet.copyTo(ss);
    sh.setName(label);
    try { sh.showSheet(); } catch (e) { /* もとから見えている */ }
  }
  var byDate = {};
  days.forEach(function (d) { byDate[d.date] = d; });
  var n = daysInMonth_(month);
  var values = [], marks = [];
  for (var i = 0; i < MONTH_ROWS; i++) {
    var row = blankRow_(), expected = '';
    if (i < n) {
      var date = month + '-' + pad2_(i + 1), d = byDate[date];
      row[0] = i + 1; row[1] = dowOf_(date);
      if (d) {
        var sc = d.shiftCells || [];
        row[2] = sc[0] || ''; row[3] = sc[1] || ''; row[4] = sc[2] || ''; row[5] = sc[3] || '';
        row[6] = d.event || '';
        var money = d.amounts !== false; // 先の日は、金額の列を空にしておく
        if (money) {
          row[7] = d.laborKana; row[8] = d.laborOther; row[9] = d.cash; row[10] = d.group; row[11] = d.point;
          row[12] = d.food; row[13] = d.other; row[14] = d.cashless;
        }
        var fx = d.fixed || {};
        row[15] = fx['家賃電気'] || (money ? 0 : ''); row[16] = fx['ガス・カラオケ・Wi-Fi・電話'] || (money ? 0 : ''); row[17] = fx['保険'] || (money ? 0 : '');
        expected = d.expected || '';
        var bg = d.bg || {};
        (bg.shift || []).forEach(function (c, k) { if (c) marks.push([i + 2, 3 + k, c]); });
        if (bg.event) marks.push([i + 2, 7, bg.event]);
      }
    }
    values.push(isApp ? row.slice(0, 7).concat([expected], row.slice(7)) : row);
  }
  sh.getRange(1, 1).setValue(label);
  if (isApp) sh.getRange(2, 3, MONTH_ROWS, 5).setNumberFormat('@'); // 予定の名前に「=」で始まる文字があっても、数式にしない（シフト・団体及びイベントは書式なしテキスト）
  sh.getRange(2, 1, MONTH_ROWS, width).setValues(values);
  marks.forEach(function (m) { sh.getRange(m[0], m[1]).setBackground(m[2]); });
  if (tpl.how === 'plain') { // 曜日（と、管理シートの月ではシフトの名前）に、チップの代わりの色を付ける
    for (var r = 0; r < MONTH_ROWS; r++) {
      for (var c = 1; c <= (isApp ? 1 : 5); c++) {
        var v = values[r][c];
        var marked = marks.some(function (m) { return m[0] === r + 2 && m[1] === c + 1; });
        if (v && CHIP_COLORS[v] && !marked) sh.getRange(r + 2, c + 1).setBackground(CHIP_COLORS[v]);
      }
    }
  }
  if (isApp) protectPlanTab_(sh); else protect_(sh);
  return sh;
}

/** タブを、先頭から指定の順に並べる */
function arrangeTabs_(ss, names) {
  if (typeof ss.setActiveSheet !== 'function' || typeof ss.moveActiveSheet !== 'function') return;
  names.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
}

// ===== 突き合わせのタブは、2026-10-16 にやめた（月のタブを「アプリ」と「手打ち」に分け、林が目で比べる）=====
var OLD_RECON_SHEET = '突き合わせ';

/** 前の版で作った「突き合わせ」のタブがあれば消す */
function removeOldReconcileTab_(ss) {
  var sh = ss.getSheetByName(OLD_RECON_SHEET);
  if (sh) ss.deleteSheet(sh);
}

/** 「過去の日別」の行を読む（管理シート側の数字） */
function readLegacyRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEGACY_DAILY_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0].map(String);
  var at = function (name) { return head.indexOf(name); };
  var n = function (r, name) { var i = at(name); return i < 0 ? 0 : Number(r[i]) || 0; };
  var text = function (r, name) { var i = at(name); return i < 0 || r[i] == null ? '' : String(r[i]).trim(); };
  return vals.slice(1).map(function (r) {
    var d = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]).slice(0, 10);
    var shift = text(r, 'シフト');
    return {
      date: d, closed: text(r, '店休日') !== '', shift: shift ? shift.split('、') : [], event: text(r, 'イベント'),
      laborKana: n(r, '人件費（加奈）'), laborOther: n(r, '人件費（その他）'), cash: n(r, '現金売上'), group: n(r, '団体売上'),
      cashless: n(r, 'キャッシュレス売上'), point: n(r, 'ポイント売上'), food: n(r, '飲食物（食品支出）'), other: n(r, 'その他支出'),
      fixed: { '家賃電気': n(r, '家賃電気'), 'ガス・カラオケ・Wi-Fi・電話': n(r, 'ガス・カラオケ・Wi-Fi・電話'), '保険': n(r, '保険') }
    };
  }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.date); });
}

/** 運用開始日が月の途中のとき、その月の運用開始日より前の分を、管理シートの数字で足す */
function mergeLegacyDays_(s, rows, settings) {
  var pointCounts = settings.pointCountsAsSales !== false;
  var fixed = {}, kana = 0;
  rows.forEach(function (d) {
    var sales = d.cash + d.group + d.cashless + (pointCounts ? d.point : 0);
    var open = !d.closed && d.shift.length > 0;
    s.sales += sales; s.cash += d.cash; s.cashless += d.cashless; s.point += d.point; s.event += d.group;
    if (d.event) s.eventGroups += 1;
    if (open) { s.openDays += 1; if (sales === 0) s.zeroDays.push(d.date); }
    if (d.closed) s.closedDays += 1;
    s.purchases['飲食物'] += d.food; s.purchases['その他'] += d.other; s.purchaseTotal += d.food + d.other;
    Object.keys(d.fixed).forEach(function (k) { fixed[k] = (fixed[k] || 0) + d.fixed[k]; });
    kana += d.laborKana; s.laborOthers.cost += d.laborOther; s.laborTotal += d.laborKana + d.laborOther;
  });
  Object.keys(fixed).forEach(function (k) { // 管理シートに固定費があれば、アプリの同じ項目の代わりにそちらを使う（二重に数えない）
    if (!fixed[k]) return;
    s.fixedTotal += fixed[k] - (s.fixed[k] || 0);
    s.fixed[k] = fixed[k];
  });
  if (kana) {
    var r = s.laborFixed.filter(function (x) { return x.name === '加奈'; })[0];
    if (r) r.cost += kana; else s.laborFixed.push({ name: '加奈', days: 0, hours: 0, transport: 0, cost: kana });
  }
  s.zeroDays.sort();
  return s;
}

// ===== 11月以降の月のタブ：アプリの記録から、9月・10月と同じ形で作る =====
// 閉店・レジ締めのたびに、その月のタブだけを作り直す（タブは作り直さず、中身を書き換える）。
// 試運転の記録（運用開始日より前・試運転の印）は数えない。月次と同じ数え方。

/** 「11月」「12月」…（2026年以外は「2027年1月」の形） */
function monthTabLabel_(month) {
  var p = month.split('-').map(Number);
  return (p[0] === 2026 ? '' : p[0] + '年') + p[1] + '月';
}

/** アプリの記録から作る月（運用開始日の月から今月まで。管理シートの月（9月・10月）は除く） */
function appMonths_(settings) {
  var goLive = String(settings.goLiveDate || '');
  if (!goLive) return [];
  var legacy = Object.keys(LEGACY_TABS).map(function (k) { return LEGACY_TABS[k]; });
  var now = Utilities.formatDate(now_(), TZ, 'yyyy-MM');
  var months = [];
  for (var m = goLive.slice(0, 7); m <= now; m = nextMonth_(m)) if (legacy.indexOf(m) < 0) months.push(m);
  return months;
}

/** タブを持てる月：appMonths_ に、来月（先に作るシフト表）を足したもの。運用開始日より前の月・管理シートの月は入れない */
function planMonths_(settings) {
  var months = appMonths_(settings);
  var goLive = String(settings.goLiveDate || '');
  var next = nextMonth_(Utilities.formatDate(now_(), TZ, 'yyyy-MM'));
  var legacy = Object.keys(LEGACY_TABS).map(function (k) { return LEGACY_TABS[k]; });
  if (goLive && next >= goLive.slice(0, 7) && legacy.indexOf(next) < 0 && months.indexOf(next) < 0) months.push(next);
  return months;
}

var APP_TAB_SUFFIX = '（アプリ）';
var HAND_TAB_SUFFIX = '（手打ち）';

/** その月の、アプリの記録が入るタブ（「11月（アプリ）」か「11月」）。なければ null */
function appTab_(ss, month) {
  return ss.getSheetByName(monthTabLabel_(month) + APP_TAB_SUFFIX) || ss.getSheetByName(monthTabLabel_(month));
}

/** アプリのタブの名前。手打ちのタブがある月は「11月（アプリ）」、ない月は「12月」 */
function appTabName_(ss, month) {
  var sh = appTab_(ss, month);
  if (sh) return sh.getName();
  return monthTabLabel_(month) + (ss.getSheetByName(monthTabLabel_(month) + HAND_TAB_SUFFIX) ? APP_TAB_SUFFIX : '');
}

/** タブの名前から、アプリのタブの月を探す（手打ちのタブ・ほかのタブは null） */
function monthOfAppTab_(name, settings) {
  var month = null;
  planMonths_(settings).forEach(function (m) { if (name === monthTabLabel_(m) || name === monthTabLabel_(m) + APP_TAB_SUFFIX) month = m; });
  return month;
}

/** 下のタブの並び：9月・10月・11月（アプリ）・11月（手打ち）・12月… */
function monthTabNames_(ss, settings) {
  var names = [];
  Object.keys(LEGACY_TABS).forEach(function (tab) {
    names.push(tab);
    if (ss.getSheetByName(tab + APP_TAB_SUFFIX)) names.push(tab + APP_TAB_SUFFIX); // 試運転のアプリのタブ（10月（アプリ））
  });
  planMonths_(settings).forEach(function (m) {
    var app = appTab_(ss, m), hand = ss.getSheetByName(monthTabLabel_(m) + HAND_TAB_SUFFIX);
    if (app) names.push(app.getName());
    if (hand) names.push(hand.getName());
  });
  return names;
}

// ===== 手打ちのタブ（試運転のあいだの、管理シートの写し）=====
// 見た目と列は管理シートの9月と同じ（月のひな形をコピー）。作ったときは日付と曜日だけ。中身は「管理シートから取り込み直す」と毎朝6時ごろに、
// 管理シートのその月のタブから写す（copyHandTab_）。打てなくはしないが、打とうとすると注意が出る。
// 一番下に「アプリとの差」の行（月の合計どうしの差。式なので自動で変わる。色なし）
var HAND_DIFF_ROW = MONTH_ROWS + 3; // 34行目（33行目は合計）

/** 手打ちのタブを作る。作ったら名前、もうあれば null */
function createHandTab_(month) {
  var ss = SpreadsheetApp.getActive();
  var base = monthTabLabel_(month);
  var name = base + HAND_TAB_SUFFIX;
  if (ss.getSheetByName(name)) return null;
  var app = ss.getSheetByName(base);
  if (app) app.setName(base + APP_TAB_SUFFIX); // 隣のアプリのタブは「11月（アプリ）」に
  if (app && String(app.getRange(1, 1).getValue()) === base) app.getRange(1, 1).setValue(base + APP_TAB_SUFFIX);
  var tpl = getMonthTemplate_(ss);
  var sh = tpl.sheet.copyTo(ss);
  sh.setName(name);
  try { sh.showSheet(); } catch (e) { /* もとから見えている */ }
  try { sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (pr) { pr.remove(); }); } catch (e) { /* 保護がなければ何もしない */ }
  markHandTab_(sh);
  var n = daysInMonth_(month), dates = [];
  for (var i = 0; i < MONTH_ROWS; i++) dates.push(i < n ? [i + 1, dowOf_(month + '-' + pad2_(i + 1))] : ['', '']);
  sh.getRange(1, 1).setValue(base + HAND_TAB_SUFFIX);
  sh.getRange(2, 1, MONTH_ROWS, 2).setValues(dates);
  // アプリとの差（アプリ − 手打ち）。手打ちの H〜R は、アプリのタブの I〜S（アプリのタブは「見込み」の列が1つ多い）
  var appName = base + APP_TAB_SUFFIX, total = MONTH_ROWS + 2;
  var hand = 'HIJKLMNOPQR'.split(''), appCols = 'IJKLMNOPQRS'.split('');
  sh.getRange(HAND_DIFF_ROW, 1).setValue('アプリとの差（アプリ − 手打ち）').setFontWeight('bold');
  sh.getRange(HAND_DIFF_ROW, 8, 1, 11).setFormulas([hand.map(function (c, k) {
    return '=IFERROR(INDIRECT("\'' + appName + '\'!' + appCols[k] + total + '")-' + c + total + ',"")';
  })]).setNumberFormat(YEN_FORMAT).setFontWeight('bold');
  arrangeTabs_(ss, monthTabNames_(ss, getSettings_()));
  return name;
}

/** 初期設定：運用開始の月の手打ちのタブを、1回だけ作る（消したあとに初期設定をしても、作り直さない） */
function autoHandTab_() {
  var settings = getSettings_();
  var goLive = String(settings.goLiveDate || '');
  if (!/^\d{4}-\d{2}/.test(goLive)) return '';
  var month = goLive.slice(0, 7);
  var key = 'HANDTAB_AUTO:' + month;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(key) || Object.keys(LEGACY_TABS).some(function (k) { return LEGACY_TABS[k] === month; })) return '';
  var name = createHandTab_(month);
  props.setProperty(key, '1');
  return name ? '「' + name + '」のタブを作りました（管理シートの11月の写し。「管理シートから取り込み直す」で写します）。' : '';
}

/** 「12月」「2027-01」「2027年1月」「12」などを、月（YYYY-MM）にする。年がなければ、今月以降で一番近い月 */
function parseMonthInput_(text, nowMonth) {
  var t = String(text || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\s/g, '');
  var m = t.match(/^(\d{4})[-\/年](\d{1,2})月?$/);
  if (m) return m[1] + '-' + pad2_(Number(m[2]));
  m = t.match(/^(\d{1,2})月?$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  var y = Number(nowMonth.slice(0, 4)), mm = Number(m[1]);
  if (mm < Number(nowMonth.slice(5, 7))) y += 1;
  return y + '-' + pad2_(mm);
}

/** スプシのメニュー：手打ちのタブを作る（月を聞く） */
function createHandTab() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('手打ちのタブを作る', 'どの月ですか？（例：12月、2027-01）\n管理シートのその月のタブの写しを、その月のアプリのタブの隣に作ります。', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var settings = getSettings_();
  var month = parseMonthInput_(r.getResponseText(), Utilities.formatDate(now_(), TZ, 'yyyy-MM'));
  if (!month) { ui.alert('月が読めませんでした（例：12月、2027-01）。'); return; }
  var goLive = String(settings.goLiveDate || '');
  if (Object.keys(LEGACY_TABS).some(function (k) { return LEGACY_TABS[k] === month; }) || (goLive && month < goLive.slice(0, 7))) {
    ui.alert(month + ' は、管理シートから取り込む月（または運用開始日より前の月）なので作りません。'); return;
  }
  var name = withLock_(function () { return createHandTab_(month); });
  ui.alert(name ? '「' + name + '」を作りました。中身は、次の「管理シートから取り込み直す」（または毎朝6時ごろ）で、管理シートのその月のタブから写します。一番下の「アプリとの差」は、月の合計どうしの差です。'
    : '「' + monthTabLabel_(month) + HAND_TAB_SUFFIX + '」は、もうあります。');
}

/** 月のタブの元になる見た目。なければ（取り込みの前でも）自前で作る */
function getMonthTemplate_(ss) {
  var sh = ss.getSheetByName(MONTH_TPL_SHEET);
  if (!sh) return prepareMonthTemplate_(ss, null);
  return { sheet: sh, how: PropertiesService.getScriptProperties().getProperty('MONTH_TPL_HOW') || 'plain' };
}

function splitNames_(s) { return String(s || '').split(/[、,，\s]+/).filter(String); }

/**
 * その月の、シフト・店休日・イベント・見込みの名前（日付 → 中身）。
 * シフトは、実績があれば実績、なければ予定。イベントは予定の名前に、予定にない実際の入店のイベントの名前を足す
 * （予定のイベントと同じ組なら、名前は1つにまとめる）。見込みは、その日の予定の「見込みの金額」の合計
 */
function appPlanByDate_(month, settings, trial) { // trial：{from, to}（試運転のアプリのタブ。その期間の予定と、試運転の印のイベントの組も入れる）
  var goLive = String(settings.goLiveDate || '');
  var inMonth = trial
    ? function (d) { d = String(d || '').slice(0, 10); return monthOf_(d) === month && d >= trial.from && d < trial.to; }
    : function (d) { return monthOf_(d) === month && counted_(d, goLive); };
  var out = {};
  var at = function (d) { return out[d] = out[d] || { shiftCells: ['', '', '', ''], closed: false, event: '', expected: '' }; };
  var titles = {}, plannedIds = {}, expected = {};
  readTable_(TABLES.events).rows.forEach(function (e) {
    if (e.status === '削除' || !e.title || !inMonth(e.date)) return;
    (titles[e.date] = titles[e.date] || []).push(String(e.title));
    plannedIds[e.id] = true;
    expected[e.date] = (expected[e.date] || 0) + (Number(e.expectedAmount) || 0);
  });
  readTable_(TABLES.visits).rows.forEach(function (v) {
    if (v.kind !== 'イベント' || v.status === '削除' || (v.trial === true && !trial) || !v.name || !inMonth(v.bizDate)) return;
    if (v.eventId && plannedIds[v.eventId]) return; // 予定のイベントの組は、予定の名前に1つにまとめる
    var list = titles[v.bizDate] = titles[v.bizDate] || [];
    if (list.indexOf(String(v.name)) < 0) list.push(String(v.name));
  });
  Object.keys(titles).forEach(function (d) { var f = at(d); f.event = titles[d].join('、'); f.expected = expected[d] || ''; });
  var boss = String(settings.managerName || '');
  readTable_(TABLES.days).rows.forEach(function (r) {
    if (!inMonth(r.bizDate)) return;
    var f = at(r.bizDate);
    if (r.closed === true) { f.closed = true; f.shiftCells = ['店休日', '', '', '']; return; }
    var names = splitNames_(r.shiftActual || r.shiftPlan);
    names.sort(function (a, b) { return (a === boss ? 0 : 1) - (b === boss ? 0 : 1); });
    f.shiftCells = [names[0] || '', names[1] || '', names[2] || '', names.slice(3).join('、')];
  });
  return out;
}

// ===== 月の売上目標と、減算カウンター =====
// あと ＝ 目標 − 確定した売上 − まだ来ていない日のイベントの見込み
// その日の閉店が済んだら、その日の見込みは外れて、実際の売上（確定）に入れ替わる。普段の日の見込みは入れない（イベントだけ）

/** その月の売上目標。月ごとの目標（設定 monthlyTargets）があればそれ、なければ設定の「月の売上」 */
function monthTarget_(month, settings) {
  var v = Number((settings.monthlyTargets || {})[month]);
  if (v > 0) return v;
  return Number((settings.targets || {}).monthlySales) || 0;
}

/** その月の確定した売上（退店して精算が済んだ組。管理シートの月は取り込んだ数字） */
function confirmedSales_(month, settings) {
  var goLive = String(settings.goLiveDate || '');
  if (goLive && month < goLive.slice(0, 7)) { var lg = legacySummary_(month); return lg ? lg.sales : 0; }
  var n = function (v) { return Number(v) || 0; };
  var pointOff = settings.pointCountsAsSales === false;
  var sum = 0;
  readTable_(TABLES.visits).rows.forEach(function (v) {
    if (v.status !== '退店' || v.trial === true || monthOf_(v.bizDate) !== month || !counted_(v.bizDate, goLive)) return;
    sum += n(v.total) - (pointOff ? n(v.point) : 0);
  });
  if (goLive && goLive.slice(0, 7) === month && goLive.slice(8, 10) > '01') { // 運用開始日が月の途中：それより前は管理シートの数字
    readLegacyRows_().forEach(function (d) {
      if (monthOf_(d.date) === month && d.date < goLive) sum += d.cash + d.group + d.cashless + (pointOff ? 0 : d.point);
    });
  }
  return sum;
}

/** まだ来ていない日（今日を含む。閉店が済むまで）のイベントの見込みの合計。入店して退店した予定のイベントは、実際の売上に入っているので数えない */
function pendingExpected_(month, settings) {
  var today = serverBizDate_(settings);
  var n = function (v) { return Number(v) || 0; };
  var closed = {}, done = {}, doneNames = {}, loose = {};
  readTable_(TABLES.closings).rows.forEach(function (c) { closed[c.bizDate] = true; });
  var visits = readTable_(TABLES.visits).rows.filter(function (v) { return v.status === '退店' && v.kind === 'イベント' && monthOf_(v.bizDate) === month; });
  visits.forEach(function (v) { if (v.eventId) done[v.eventId] = true; doneNames[v.bizDate + '|' + v.name] = true; });
  var allEvents = readTable_(TABLES.events).rows.filter(function (e) { return e.status !== '削除' && monthOf_(e.date) === month; });
  var events = allEvents.filter(function (e) { return n(e.expectedAmount) > 0; });
  // 予定に結びつけず（または名前だけ合わせて）入店したイベントの実績は、まだ数えていない予定の見込みから引く（二重に数えないため）
  var planned = {};
  events.forEach(function (e) { if (!done[e.id] && !doneNames[e.date + '|' + e.title]) planned[e.date] = (planned[e.date] || 0) + n(e.expectedAmount); });
  visits.forEach(function (v) {
    var linked = v.eventId && allEvents.some(function (e) { return e.id === v.eventId; });
    if (!linked && !allEvents.some(function (e) { return e.date === v.bizDate && e.title === v.name; })) loose[v.bizDate] = (loose[v.bizDate] || 0) + n(v.total);
  });
  var sum = 0;
  Object.keys(planned).forEach(function (d) {
    if (String(d) < today || closed[d]) return;
    sum += Math.max(0, planned[d] - (loose[d] || 0));
  });
  return sum;
}

function countdownSummary_(month, settings) {
  var target = monthTarget_(month, settings);
  var confirmed = confirmedSales_(month, settings);
  var expected = pendingExpected_(month, settings);
  return { month: month, hasTarget: target > 0, target: target, confirmed: confirmed, expected: expected, remaining: target - confirmed - expected };
}

/** その月の日ごとの数字（管理シートの形：parseLegacyTab_ の1日分と同じ項目）。amounts が false の日は、金額の列を空にする */
function appMonthDays_(month, settings, trial) {
  // trial：{from, to}（試運転のアプリのタブ）。その期間の記録を、試運転の印が付いていても入れる。固定費は入れない（その月は管理シートの数字）
  var goLive = String(settings.goLiveDate || '');
  var n = function (v) { return Number(v) || 0; };
  var inMonth = trial
    ? function (d) { d = String(d || '').slice(0, 10); return monthOf_(d) === month && d >= trial.from && d < trial.to; }
    : function (d) { return monthOf_(d) === month && counted_(d, goLive); };
  var today = serverBizDate_(settings);
  var byDate = {};
  var at = function (d, money) {
    var f = byDate[d] = byDate[d] || { date: d, shiftCells: ['', '', '', ''], closed: false, event: '', expected: '', laborKana: 0, laborOther: 0, cash: 0, group: 0,
      cashless: 0, point: 0, food: 0, other: 0, fixed: {}, bg: {}, amounts: false };
    if (money) f.amounts = true;
    return f;
  };
  var n2 = daysInMonth_(month);
  for (var i = 1; i <= n2; i++) { var d0 = month + '-' + pad2_(i); if (d0 <= today && inMonth(d0)) at(d0, true); }
  readTable_(TABLES.visits).rows.forEach(function (v) {
    if (v.status !== '退店' || (v.trial === true && !trial) || !inMonth(v.bizDate)) return;
    var f = at(v.bizDate, true);
    if (v.kind === 'イベント') f.group += n(v.total) - (settings.pointCountsAsSales === false ? n(v.point) : 0);
    else { f.cash += n(v.cash); f.cashless += n(v.cashless); f.point += n(v.point); }
  });
  readTable_(TABLES.closings).rows.forEach(function (c) { if ((c.trial !== true || trial) && inMonth(c.bizDate)) at(c.bizDate, true); });
  readTable_(TABLES.purchases).rows.forEach(function (p) {
    if (p.status === '削除' || !inMonth(p.date)) return;
    at(p.date, true)[p.category === '飲食物' ? 'food' : 'other'] += n(p.amount);
  });
  readTable_(TABLES.attendance).rows.forEach(function (a) {
    if (a.status === '削除' || !inMonth(a.bizDate)) return;
    var f = at(a.bizDate, true);
    if (a.name === '加奈' && a.kind !== '手打ち') f.laborKana += n(a.cost); else f.laborOther += n(a.cost);
  });
  var plan = appPlanByDate_(month, settings, trial);
  Object.keys(plan).forEach(function (d) {
    var f = at(d), p = plan[d];
    f.shiftCells = p.shiftCells; f.closed = p.closed; f.event = p.event; f.expected = p.expected;
  });
  // 固定費は月に1回の入力なので、月の1日の行に入れる
  readTable_(TABLES.fixedCosts).rows.forEach(function (f) {
    if (trial || f.status === '削除' || f.month !== month || !counted_(f.month, goLive)) return;
    var first = at(month + '-01');
    first.fixed[f.item] = (first.fixed[f.item] || 0) + n(f.amount);
  });
  return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
}

// 月のタブの C〜H（シフト・団体及びイベント・見込み）に、最後に書いた（取り込んだ）内容を覚えておく。
// アプリの記録から書き換えるとき、覚えている内容と違うセルは、スプシで打たれたのに、まだアプリに入っていないもの（編集のトリガーが間に合わなかった・時間切れだった）。
// それを先にアプリへ入れてから書き換えるので、打った内容が消えない
var PLAN_SNAP = 'PLANSNAP:';

/** C〜H を、6列（列2〜列5・団体及びイベント・見込み）×31行の文字にして返す */
function planGrid_(sh) {
  return sh.getRange(2, 3, MONTH_ROWS, 6).getValues().map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); });
}

function savePlanSnapshot_(month, sh) {
  try { PropertiesService.getScriptProperties().setProperty(PLAN_SNAP + month, JSON.stringify(planGrid_(sh))); }
  catch (e) { console.error('月のタブの内容を覚えられませんでした：' + e.message); }
}

function readPlanSnapshot_(month) {
  try { var v = PropertiesService.getScriptProperties().getProperty(PLAN_SNAP + month); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

/** 打ったばかりの行・列だけ、覚えている内容を新しくする（ほかの行に、まだ取り込めていない編集があっても、見落とさないため） */
function updatePlanSnapshotCells_(month, sh, rowFrom, rowTo, what) {
  var snap = readPlanSnapshot_(month);
  if (!snap) return;
  var now = planGrid_(sh);
  for (var r = rowFrom - 2; r <= rowTo - 2; r++) {
    if (!snap[r] || !now[r]) continue;
    if (what.shift) for (var c = 0; c < 4; c++) snap[r][c] = now[r][c];
    if (what.event) snap[r][4] = now[r][4];
    if (what.expected) snap[r][5] = now[r][5];
  }
  try { PropertiesService.getScriptProperties().setProperty(PLAN_SNAP + month, JSON.stringify(snap)); } catch (e) { /* 覚えられなくても先へ */ }
}

/** 覚えている内容と違うセルを、アプリへ取り込む。取り込んだ行の数を返す */
function ingestSheetPlanEdits_(month, sh, settings) {
  var snap = readPlanSnapshot_(month);
  if (!snap || String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') return 0;
  var grid = planGrid_(sh), count = 0, days = daysInMonth_(month);
  for (var i = 0; i < days; i++) {
    var a = snap[i], b = grid[i];
    if (!a) continue;
    var what = { shift: [0, 1, 2, 3].some(function (k) { return a[k] !== b[k]; }), event: a[4] !== b[4], expected: a[5] !== b[5] };
    if (!what.shift && !what.event && !what.expected) continue;
    pushPlanFromSheet_(sh, month, i + 2, i + 2, what, settings);
    count++;
  }
  return count;
}

/** その月のタブを作る（なければシフト表のひな形から。あれば中身だけ書き換える。プルダウンはひな形のものを写す） */
function rebuildAppMonthTab_(month) {
  var settings = getSettings_();
  var ss = SpreadsheetApp.getActive();
  var label = appTabName_(ss, month);
  var old = appTab_(ss, month);
  var existed = !!old;
  if (old) { removeLastColumn_(old); ingestSheetPlanEdits_(month, old, settings); } // スプシで打って、まだアプリに入っていないものを、書き換える前に取り込む
  var tpl = getPlanTemplate_(ss);
  var sh = writeMonthTab_(ss, tpl, label, month, appMonthDays_(month, settings), true);
  copyValidationsFromTemplate_(sh, tpl.sheet);
  savePlanSnapshot_(month, sh);
  if (!existed || sh !== old) arrangeTabs_(ss, monthTabNames_(ss, settings)); // 新しく作った（古い形のタブを作り直した）ときは、タブの並びも直す
  return label;
}

// ===== 試運転のアプリのタブ（「10月（アプリ）」）=====
// 試運転を始めた日（設定 trialStartDate）から運用開始日の前日までのアプリの記録を、11月（アプリ）と同じ形で出す（試運転の印が付いていても入れる）。
// 見るだけ（全部保護。スプシで打ってもアプリには入らない）。閉店のたびに書き換える。月次・カウンター・取り込みの数字は変えない。
// 隣の「10月」（管理シートの写し）の一番下に「アプリとの差」の行（試運転を始めた日からの合計どうし）

/** 試運転のアプリのタブを作る月（試運転を始めた日の月 〜 運用開始日の前日の月） */
function trialAppMonths_(settings) {
  var r = trialRange_(settings);
  if (!r) return [];
  var out = [], m = r.from.slice(0, 7), last = addDays_(r.to, -1).slice(0, 7);
  while (m <= last && out.length < 3) { out.push(m); m = nextMonth_(m); }
  return out;
}

/** 試運転の期間 {from: 始めた日, to: 運用開始日（この日は含まない）}。なければ null */
function trialRange_(settings) {
  var from = String(settings.trialStartDate || ''), to = String(settings.goLiveDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) return null;
  return { from: from, to: to };
}

/** 試運転のアプリのタブを、すべて作り直す。作ったタブの名前 */
function rebuildTrialAppTabs_() {
  var settings = getSettings_();
  return trialAppMonths_(settings).map(function (m) { return rebuildTrialAppTab_(m, settings); });
}

function rebuildTrialAppTab_(month, settings) {
  settings = settings || getSettings_();
  var r = trialRange_(settings);
  var ss = SpreadsheetApp.getActive();
  var name = monthTabLabel_(month) + APP_TAB_SUFFIX;
  var existed = !!ss.getSheetByName(name);
  var sh = writeMonthTab_(ss, getPlanTemplate_(ss), name, month, appMonthDays_(month, settings, r), true);
  protect_(sh, []); // 見るだけ（シフト・イベントの欄も打てなくする）
  var from = r.from > month + '-01' ? r.from : month + '-01';
  sh.getRange(1, 21).setValue('試運転（' + Number(from.slice(5, 7)) + '/' + Number(from.slice(8, 10)) + '〜）のアプリの記録。見るだけ。閉店のたびに書き換えます（月次・カウンターには入りません）');
  var legacy = ss.getSheetByName(monthTabLabel_(month));
  if (legacy && LEGACY_TABS[monthTabLabel_(month)] === month) writeTrialDiffRow_(legacy, month, settings);
  if (!existed) arrangeTabs_(ss, monthTabNames_(ss, settings));
  return name;
}

/** 管理シートの写しの月のタブ（「10月」）の一番下に、試運転を始めた日からの「アプリとの差」（アプリ − 管理シート）。式なので自動で変わる */
function writeTrialDiffRow_(sh, month, settings) {
  var r = trialRange_(settings);
  if (!r) return;
  var from = r.from > month + '-01' ? r.from : month + '-01';
  var endDay = r.to.slice(0, 7) === month ? Number(r.to.slice(8, 10)) - 1 : daysInMonth_(month);
  var top = Number(from.slice(8, 10)) + 1, bottom = endDay + 1; // 日の行は「日＋1」行目
  var appName = monthTabLabel_(month) + APP_TAB_SUFFIX;
  var hand = 'HIJKLMNOPQR'.split(''), appCols = 'IJKLMNOPQRS'.split(''); // アプリのタブは「見込み」の列が1つ多い
  sh.getRange(HAND_DIFF_ROW, 1).setValue('アプリとの差（' + Number(from.slice(5, 7)) + '/' + Number(from.slice(8, 10)) + '〜の合計。アプリ − 管理シート）').setFontWeight('bold');
  sh.getRange(HAND_DIFF_ROW, 8, 1, 11).setFormulas([hand.map(function (c, k) {
    return '=IFERROR(SUM(INDIRECT("\'' + appName + '\'!' + appCols[k] + top + ':' + appCols[k] + bottom + '"))-SUM(' + c + top + ':' + c + bottom + '),"")';
  })]).setNumberFormat(YEN_FORMAT).setFontWeight('bold');
}

/** シフト・店休日・イベント・見込みの列だけ、アプリの内容に書き換える（アプリの予定を直したとき。金額は触らない） */
function refreshPlanColumns_(month) {
  var ss = SpreadsheetApp.getActive();
  var sh = appTab_(ss, month);
  if (!sh) return false;
  if (String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') { rebuildAppMonthTab_(month); return true; } // 古い形のタブは作り直す
  var settings = getSettings_();
  if (removeLastColumn_(sh)) protectPlanTab_(sh);
  ingestSheetPlanEdits_(month, sh, settings); // スプシで打って、まだアプリに入っていないものを、書き換える前に取り込む
  var plan = appPlanByDate_(month, settings);
  var n = daysInMonth_(month);
  var cells = [];
  for (var i = 0; i < MONTH_ROWS; i++) {
    var p = i < n ? plan[month + '-' + pad2_(i + 1)] : null;
    var sc = p ? p.shiftCells : ['', '', '', ''];
    cells.push([sc[0], sc[1], sc[2], sc[3], p ? p.event : '', p ? p.expected : '']);
  }
  sh.getRange(2, 3, MONTH_ROWS, 5).setNumberFormat('@'); // 予定の名前に「=」で始まる文字があっても、数式にしない
  sh.getRange(2, 3, MONTH_ROWS, 6).setValues(cells);
  savePlanSnapshot_(month, sh);
  return true;
}

/** タブを持つ月（来月を含む）のうち、まだ作っていない月も含めて、すべて作り直す（メニュー） */
function buildAppMonthTabs() {
  var settings = getSettings_();
  var ss = SpreadsheetApp.getActive();
  var active = appMonths_(settings);
  var months = planMonths_(settings).filter(function (m) { return active.indexOf(m) >= 0 || appTab_(ss, m); });
  if (!months.length) { notify_('運用開始日（' + settings.goLiveDate + '）になる前なので、アプリの記録から作る月のタブはまだありません。'); return; }
  var labels = withLock_(function () { return months.map(rebuildAppMonthTab_); });
  notify_('月のタブを作り直しました（' + labels.join('・') + '）。');
}

/** 来月のタブ（運用開始日より前の月や、管理シートの月は作らない）。作った月、作らなければ null */
function createNextMonthTab_() {
  var settings = getSettings_();
  var next = nextMonth_(Utilities.formatDate(now_(), TZ, 'yyyy-MM'));
  if (planMonths_(settings).indexOf(next) < 0) return null;
  return withLock_(function () { return rebuildAppMonthTab_(next); });
}

/** スプシのメニュー：次の月のタブを作る（シフトや店休日、イベントの予定を先に打てる） */
function createNextMonthTab() {
  var label = createNextMonthTab_();
  notify_(label
    ? '「' + label + '」のタブを作りました。シフト・店休日・団体及びイベントは、このタブから打てます（アプリの予定にも入ります）。'
    : '来月は、運用開始日より前か管理シートの月なので、タブは作りません。');
}

/** 毎月20日に動く（トリガー）：来月のタブを作る */
function createNextMonthTabAuto() {
  try { createNextMonthTab_(); } catch (e) { console.error('来月のタブを作れませんでした：' + e.message); }
}

/** 自動の動き（トリガー）を作る：スプシの編集をアプリに入れる・毎月20日に来月のタブ・毎朝6時ごろに管理シートから取り込み直す。何度実行しても1つずつ */
function ensureTriggers_() {
  try {
    var ss = SpreadsheetApp.getActive();
    var have = {};
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
    var made = [];
    if (!have['handleSheetEdit']) { ScriptApp.newTrigger('handleSheetEdit').forSpreadsheet(ss).onEdit().create(); made.push('スプシで打った予定をアプリに入れる'); }
    if (!have['createNextMonthTabAuto']) { ScriptApp.newTrigger('createNextMonthTabAuto').timeBased().onMonthDay(20).atHour(9).inTimezone(TZ).create(); made.push('毎月20日に来月のタブを作る'); }
    if (!have['reimportLegacyAuto']) { ScriptApp.newTrigger('reimportLegacyAuto').timeBased().everyDays(1).atHour(6).inTimezone(TZ).create(); made.push('毎朝6時ごろに管理シートから取り込み直す'); }
    return made.length ? '自動の動き（トリガー）を設定しました：' + made.join('・') : '自動の動き（トリガー）は設定済みです。';
  } catch (e) {
    return '自動の動き（トリガー）を設定できませんでした：' + e.message + '（もう一度「初期設定」を実行し、許可を求められたら許可してください）';
  }
}

// ===== シフト表のひな形（11月以降のタブの元）=====
// 隠してある「シフト表のひな形」を、毎月のタブがコピーして作る。プルダウン（チップ）の色は、このひな形に林が手で一度だけ付ける
// （色はGASからは付けられない）。付けたあと、メニュー「プルダウンの色を月のタブに反映」で、今あるタブにも写せる。
// ひな形は、なければ作るだけで、あとからGASが書き換えることはない（色を消さないため）
var PLAN_TPL_SHEET = 'シフト表のひな形';
var APP_EXPECT_COL = 8;  // H：見込み（団体及びイベントの売上見込み）
var OLD_LAST_COL = 20;   // 前の版の T「ラスト」（2026-10-16 になくした。右端の列なので、消してもほかの列はずれない）

/** 前の版の「ラスト」の列（T）があれば消す。消したら true */
function removeLastColumn_(sh) {
  if (!sh || sh.getMaxColumns() < OLD_LAST_COL || String(sh.getRange(1, OLD_LAST_COL).getValue()) !== 'ラスト') return false;
  sh.deleteColumn(OLD_LAST_COL);
  return true;
}

/** 初期設定：シフト表のひな形と、11月以降のアプリのタブから「ラスト」の列を消す。営業日の表のラストの列（値）も消す */
function removeLastColumns_(ss) {
  removeLastColumn_(ss.getSheetByName(PLAN_TPL_SHEET));
  planMonths_(getSettings_()).forEach(function (m) {
    var sh = appTab_(ss, m);
    if (removeLastColumn_(sh)) { protectPlanTab_(sh); savePlanSnapshot_(m, sh); }
  });
  var days = ss.getSheetByName(TABLES.days.sheet);
  if (!days || !days.getLastColumn()) return;
  var head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0].map(String);
  for (var c = head.length; c >= 1; c--) if (head[c - 1] === 'ラスト予定' || head[c - 1] === 'ラスト実績') days.deleteColumn(c);
}

function planNames_(settings) {
  var names = [];
  if (settings.managerName) names.push(String(settings.managerName));
  readTable_(TABLES.staff).rows.forEach(function (r) { if (r.active !== false && r.name && names.indexOf(String(r.name)) < 0) names.push(String(r.name)); });
  return names;
}

/** 列2〜列5のプルダウンの選択肢。列2〜4は設定（shiftColumnChoices）、列5は店長とスタッフと「店休日」 */
function shiftChoiceLists_(settings) {
  var names = planNames_(settings);
  var fixed = settings.shiftColumnChoices || [];
  var out = [];
  for (var i = 0; i < 3; i++) out.push(fixed[i] && fixed[i].length ? fixed[i].map(String) : names.concat(['店休日']));
  out.push(names.concat(['店休日']));
  return out;
}

function applyDefaultPlanValidations_(sh, settings) {
  var rule = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build(); };
  shiftChoiceLists_(settings).forEach(function (list, i) { sh.getRange(2, 3 + i, MONTH_ROWS, 1).setDataValidation(rule(list)); });
}

/** シフト表のひな形。なければ、月のひな形をコピーして作る（見込みの列を足し、プルダウンの選択肢を入れる） */
function getPlanTemplate_(ss) {
  var sh = ss.getSheetByName(PLAN_TPL_SHEET);
  if (sh) { removeLastColumn_(sh); return { sheet: sh, how: PropertiesService.getScriptProperties().getProperty('MONTH_TPL_HOW') || 'plain' }; }
  var base = getMonthTemplate_(ss);
  sh = base.sheet.copyTo(ss);
  sh.setName(PLAN_TPL_SHEET);
  ensureAppColumns_(sh);
  applyDefaultPlanValidations_(sh, getSettings_());
  protect_(sh);
  hide_(sh);
  return { sheet: sh, how: base.how };
}

/** 11月以降のタブの形にする：H に「見込み」を足す（管理シートの形の H〜R は右へずれて I〜S） */
function ensureAppColumns_(sh) {
  if (String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') {
    sh.insertColumnAfter(7);
    sh.getRange(1, APP_EXPECT_COL).setValue('見込み');
    sh.getRange(2, APP_EXPECT_COL, MONTH_ROWS + 1, 1).clearContent().setNumberFormat(YEN_FORMAT);
    sh.getRange(MONTH_ROWS + 2, APP_EXPECT_COL).setFormula('=SUM(H2:H' + (MONTH_ROWS + 1) + ')');
  }
  sh.getRange(2, 3, MONTH_ROWS, 5).setNumberFormat('@');
  var widths = MONTH_WIDTHS.slice(0, 7).concat([90], MONTH_WIDTHS.slice(7));
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var bands = sh.getBandings();
  if (bands.length) bands[0].setRange(sh.getRange(1, 1, MONTH_ROWS + 2, 19));
}

/** ひな形のプルダウン（色つき）を、月のタブに写す（列2〜列5） */
function copyValidationsFromTemplate_(sh, tplSheet) {
  if (typeof SpreadsheetApp.CopyPasteType === 'undefined') return;
  var type = SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION;
  tplSheet.getRange(2, 3, MONTH_ROWS, 4).copyTo(sh.getRange(2, 3, MONTH_ROWS, 4), type, false);
}

/** スプシのメニュー：ひな形のプルダウンの色を、今ある11月以降のタブにも写す */
function syncPlanColors() {
  var ss = SpreadsheetApp.getActive();
  var tpl = ss.getSheetByName(PLAN_TPL_SHEET);
  if (!tpl) { notify_('「' + PLAN_TPL_SHEET + '」がまだありません。先に「来月のタブを作る」を実行してください。'); return; }
  var labels = [];
  planMonths_(getSettings_()).forEach(function (m) {
    var sh = appTab_(ss, m);
    if (sh) { copyValidationsFromTemplate_(sh, tpl); labels.push(sh.getName()); }
  });
  notify_(labels.length ? 'プルダウンの色を写しました（' + labels.join('・') + '）。' : '写すタブがありません（11月以降のタブは、まだありません）。');
}

/** 月のタブの保護：金額の列と合計の行は保護のまま。シフト（C〜F）・団体及びイベント（G）・見込み（H）だけ、スプシから打てる */
function protectPlanTab_(sh) {
  protect_(sh, [sh.getRange(2, 3, MONTH_ROWS, 6)]);
}

/**
 * スプシで打ったシフト・店休日・団体及びイベント・見込みを、アプリの予定に入れる（スプシの編集のトリガー。林の権限で動く）
 * - シフト（C〜F）→ 営業日の「シフト（予定）」。「店休日」を選んだ日は店休日に
 * - 団体及びイベント（G）→ 予定。名前が増えたら足し、消えたら削除にする（時間・人数は空）
 * - 見込み（H）→ その日の予定の「見込みの金額」（予定が複数ある日は、先頭の予定に合わせる。予定がない日は「イベント」を足す）
 */
function handleSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (!/月/.test(sh.getName()) || sh.getName().indexOf(HAND_TAB_SUFFIX) >= 0) return; // 月のタブ以外・手打ちのタブは見ない
    var settings = getSettings_();
    var month = monthOfAppTab_(sh.getName(), settings);
    if (!month) return;
    if (String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') { noteSheetEdit_(sh, e.range, '古い形のタブなので、取り込みませんでした'); return; } // 古い形のタブは、作り直すまで何もしない
    var r1 = e.range.getRow(), r2 = r1 + e.range.getNumRows() - 1;
    var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    var hit = function (a, b) { return c1 <= b && c2 >= a; };
    var what = { shift: hit(3, 6), event: hit(7, 7), expected: hit(APP_EXPECT_COL, APP_EXPECT_COL) };
    if (!what.shift && !what.event && !what.expected) return;
    var from = Math.max(r1, 2), to = Math.min(r2, 1 + daysInMonth_(month));
    if (from > to) return;
    withLock_(function () {
      pushPlanFromSheet_(sh, month, from, to, what, settings);
      updatePlanSnapshotCells_(month, sh, from, to, what);
    });
    noteSheetEdit_(sh, e.range, 'アプリに入れました');
  } catch (err) {
    console.error('スプシの編集をアプリに入れられませんでした：' + err.message);
    try { noteSheetEdit_(e.range.getSheet(), e.range, '失敗：' + err.message); } catch (e2) { /* 記録できなくても先へ */ }
  }
}

/** 編集のトリガーが動いた記録（最後の1回だけ）。メニュー「スプシで打った予定の取り込みを確かめる」で見る */
function noteSheetEdit_(sh, range, result) {
  var a1 = '';
  try { a1 = range.getA1Notation(); } catch (e) { a1 = range.getRow() + '行' + range.getColumn() + '列'; }
  PropertiesService.getScriptProperties().setProperty('SHEET_EDIT_LAST', JSON.stringify({ at: nowIso_(), sheet: sh.getName(), range: a1, result: result }));
}

/**
 * 編集のトリガーが動かなかった（入っていない・時間切れ・ロック待ち）ときの取りこぼしを拾う：
 * 月のタブの、覚えている内容と違うセルをアプリへ入れ、覚えている内容を新しくする。
 * アプリが営業日・予定を読むとき（1分に1回まで）と、メニューから呼ぶ。入れた行の数を返す
 */
function catchUpSheetEdits_(settings, force) {
  var cache = CacheService.getScriptCache();
  if (!force && cache.get('sheetCatchUp')) return 0;
  cache.put('sheetCatchUp', '1', 60);
  var ss = SpreadsheetApp.getActive(), count = 0;
  planMonths_(settings).forEach(function (m) {
    var sh = appTab_(ss, m);
    if (!sh || String(sh.getRange(1, APP_EXPECT_COL).getValue()) !== '見込み') return;
    if (removeLastColumn_(sh)) protectPlanTab_(sh);
    if (!readPlanSnapshot_(m)) { savePlanSnapshot_(m, sh); return; } // 覚えていない（前の版で作ったタブ）：今の内容を覚えるだけ
    var n = ingestSheetPlanEdits_(m, sh, settings);
    if (n) savePlanSnapshot_(m, sh);
    count += n;
  });
  return count;
}

/** 読み込みのついでに拾う（ロックが取れなければ、次の機会に。読み込みは止めない） */
function catchUpOnFetch_(settings) {
  try {
    if (CacheService.getScriptCache().get('sheetCatchUp')) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return;
    try { catchUpSheetEdits_(settings, false); } finally { lock.releaseLock(); }
  } catch (e) {
    console.error('スプシで打った予定を拾えませんでした：' + e.message);
  }
}

/** スプシのメニュー：編集のトリガーがあるか・最後に動いたときの結果を見せ、なければ作り、取りこぼしをアプリへ入れる */
function checkSheetSync() {
  var lines = [];
  var has = false;
  try { has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'handleSheetEdit'; }); } catch (e) { lines.push('トリガーを読めませんでした：' + e.message); }
  lines.push(has ? '編集のトリガー：あります。' : '編集のトリガー：ありませんでした。');
  lines.push(ensureTriggers_());
  var auto = PropertiesService.getScriptProperties().getProperty('AUTO_REIMPORT_LAST');
  if (auto) { var au = JSON.parse(auto); lines.push('毎朝の取り込み直し（最後）：' + String(au.at).slice(0, 16).replace('T', ' ') + '　' + au.result); }
  var last = PropertiesService.getScriptProperties().getProperty('SHEET_EDIT_LAST');
  if (last) {
    var l = JSON.parse(last);
    lines.push('最後に動いたとき：' + String(l.at).slice(0, 16).replace('T', ' ') + '　' + l.sheet + ' ' + l.range + '　' + l.result);
  } else lines.push('最後に動いたとき：まだ記録がありません（この版を貼ってから、トリガーが1回も動いていません）。');
  var n = withLock_(function () { return catchUpSheetEdits_(getSettings_(), true); });
  lines.push(n ? 'まだアプリに入っていなかった打ち込み：' + n + '行を、いまアプリに入れました。' : 'まだアプリに入っていない打ち込みは、ありませんでした。');
  lines.push('\n確かめ方：月のタブ（アプリ）のシフトの欄を1つ打ち、もう一度このメニューを開くと、「最後に動いたとき」がその欄になります。');
  notify_(lines.join('\n'));
}

function pushPlanFromSheet_(sh, month, rowFrom, rowTo, what, settings) {
  var count = rowTo - rowFrom + 1;
  var cells = sh.getRange(rowFrom, 3, count, 6).getValues(); // C〜H
  var now = nowIso_();
  var ctx = { mgr: true, settings: settings, deviceId: 'spreadsheet', by: 'スプシ', force: true };
  var eventRows = (what.event || what.expected) ? readTable_(TABLES.events).rows : [];
  var dayOps = [], eventOps = [], after = {};
  for (var i = 0; i < count; i++) {
    var date = month + '-' + pad2_(rowFrom + i - 1);
    var row = cells[i];
    var data = { bizDate: date, updatedAt: now };
    if (what.shift) {
      var names = [];
      for (var c = 0; c < 4; c++) { var v = String(row[c] == null ? '' : row[c]).trim(); if (v) names.push(v); }
      data.closed = names.indexOf('店休日') >= 0;
      data.shiftPlan = names.filter(function (x) { return x !== '店休日'; }).join('、');
    }
    if (what.shift) dayOps.push({ opId: 'sheet-' + date + '-' + now, id: date, data: data });
    if (what.event || what.expected) {
      var rowOps = what.event ? eventOpsFromCell_(date, row[4], eventRows, settings, now) : [];
      eventOps = eventOps.concat(rowOps);
      if (what.expected) eventOps = eventOps.concat(expectedOpsFromCell_(date, row[5], liveEventsAfter_(date, eventRows, rowOps), settings, now));
    }
    after[date] = { shift: data.shiftPlan, closed: data.closed, event: what.event ? String(row[4] || '') : undefined, expected: what.expected ? row[5] : undefined };
  }
  if (dayOps.length) upsert_('days', dayOps, ctx);
  if (eventOps.length) upsert_('events', eventOps, ctx);
  appendLog_({ type: 'スプシから予定を直す', table: 'days', targetId: Object.keys(after).join(','), after: after, by: 'スプシ' }, ctx);
}

/** 「団体及びイベント」のセルの名前に合わせて、その日の予定を増やす・削除にする。同じ名前の予定があればそのまま */
function eventOpsFromCell_(date, text, eventRows, settings, now) {
  var titles = [];
  String(text == null ? '' : text).split(/[、,，\n]+/).forEach(function (t) { t = t.trim(); if (t && titles.indexOf(t) < 0) titles.push(t); });
  var dayEvents = eventRows.filter(function (e) { return e.date === date && e.status !== '削除'; });
  var adds = titles.filter(function (t) { return !dayEvents.some(function (e) { return String(e.title) === t; }); });
  var ops = [];
  dayEvents.forEach(function (e) {
    if (titles.indexOf(String(e.title)) >= 0) return;
    if (String(e.title) === 'イベント' && String(e.id).indexOf('sh-') === 0 && adds.length) { // 見込みだけ先に打って足した仮の予定は、名前を打ったら、その名前に変える
      ops.push({ opId: 'sheet-ren-' + e.id + '-' + now, id: e.id, data: { title: adds.shift(), updatedAt: now } });
      return;
    }
    ops.push({ opId: 'sheet-del-' + e.id + '-' + now, id: e.id, data: { status: '削除', updatedAt: now } });
  });
  adds.forEach(function (t) {
    ops.push({
      opId: 'sheet-ev-' + date + '-' + t + '-' + now, id: 'sh-' + date + '-' + t,
      data: { date: date, type: (settings.eventTypes || [])[0] || '団体', title: t, status: '有効', createdAt: now, updatedAt: now }
    });
  });
  return ops;
}

/** その日の予定（削除でないもの）に、いま作る操作を当てはめたあとの一覧（見込みを振り分けるため） */
function liveEventsAfter_(date, eventRows, ops) {
  var live = eventRows.filter(function (e) { return e.date === date && e.status !== '削除'; }).map(function (e) { return { id: e.id, expectedAmount: Number(e.expectedAmount) || 0 }; });
  ops.forEach(function (op) {
    if (op.data.status === '削除') live = live.filter(function (e) { return e.id !== op.id; });
    else if (!live.some(function (e) { return e.id === op.id; })) live.push({ id: op.id, expectedAmount: 0 });
  });
  return live;
}

/** 「見込み」のセル（その日の見込みの合計）に合わせて、予定の「見込みの金額」を直す。複数あるときは先頭の予定に合わせる */
function expectedOpsFromCell_(date, value, live, settings, now) {
  var v = Number(String(value == null ? '' : value).replace(/[,¥￥\s]/g, ''));
  if (isNaN(v) || v < 0) v = 0;
  var ops = [];
  if (!live.length) {
    if (v > 0) ops.push({
      opId: 'sheet-exp-' + date + '-' + now, id: 'sh-' + date + '-イベント',
      data: { date: date, type: (settings.eventTypes || [])[0] || '団体', title: 'イベント', expectedAmount: v, status: '有効', createdAt: now, updatedAt: now }
    });
    return ops;
  }
  var others = 0;
  live.slice(1).forEach(function (e) { others += e.expectedAmount; });
  live.forEach(function (e, i) {
    var want = i === 0 ? (v === 0 ? 0 : Math.max(0, v - others)) : (v === 0 ? 0 : e.expectedAmount);
    if (want === e.expectedAmount) return;
    ops.push({ opId: 'sheet-exp-' + e.id + '-' + now, id: e.id, data: { expectedAmount: want === 0 ? null : want, unitPrice: null, updatedAt: now } }); // スプシで金額を打ったら、単価の計算はやめて金額のまま
  });
  return ops;
}

/** 送られてきた記録に合わせて、月のタブを書き換える。閉店は金額も含めて全部、予定・イベントはシフトなどの列だけ。失敗しても、記録は止めない */
function rebuildTabsAfterSync_(ops) {
  try {
    var settings = getSettings_();
    var allowed = planMonths_(settings);
    var trialMonths = trialAppMonths_(settings); // 試運転のアプリのタブ（10月（アプリ））も、閉店などのたびに書き換える
    allowed = allowed.concat(trialMonths.filter(function (m) { return allowed.indexOf(m) < 0; }));
    var ss = SpreadsheetApp.getActive();
    var full = {}, light = {};
    var ids = {};       // 表 → {ID → 日付}。送られてきた操作に日付がないとき（変えた項目だけを送るため）、記録から探す
    var closedDates = null;
    var dateOf = function (op) {
      var key = TABLES[op.table].dateKey;
      var d = op.data && key && op.data[key];
      if (d) return d;
      if (op.table === 'closings' || op.table === 'days') return op.id; // IDが営業日
      if (!ids[op.table]) {
        ids[op.table] = {};
        readTable_(TABLES[op.table]).rows.forEach(function (r) { ids[op.table][r.id] = r[key]; });
      }
      return ids[op.table][String(op.id)];
    };
    var isClosed = function (d) {
      if (!closedDates) { closedDates = {}; readTable_(TABLES.closings).rows.forEach(function (c) { closedDates[c.bizDate] = true; }); }
      return !!closedDates[d];
    };
    (ops || []).forEach(function (op) {
      if (!op || !op.table || !TABLES[op.table]) return;
      var kind = null;
      switch (op.table) {
        case 'closings': kind = 'full'; break;
        case 'days': case 'events': kind = 'light'; break;
        case 'purchases': case 'attendance': case 'fixedCosts': kind = 'full'; break; // 店長があとから入れる分（閉店のあとでも、月のタブに出す）
        case 'visits': case 'cashMoves': kind = 'closedOnly'; break; // 閉店のあとの訂正だけ（閉店前は、閉店のときに書く）
        default: return;
      }
      var d = dateOf(op);
      var m = monthOf_(String(d || ''));
      if (!/^\d{4}-\d{2}$/.test(m) || allowed.indexOf(m) < 0) return;
      if (kind === 'closedOnly') {
        if (op.table === 'visits' && op.data && op.data.kind === 'イベント' && op.data.inAt) light[m] = true; // イベントの入店は、団体及びイベントの列に出す
        if (isClosed(d)) full[m] = true;
        return;
      }
      (kind === 'full' ? full : light)[m] = true;
    });
    Object.keys(full).forEach(function (m) { if (trialMonths.indexOf(m) >= 0) rebuildTrialAppTab_(m, settings); else rebuildAppMonthTab_(m); });
    Object.keys(light).forEach(function (m) { if (!full[m] && trialMonths.indexOf(m) < 0 && appTab_(ss, m)) refreshPlanColumns_(m); });
  } catch (e) {
    console.error('月のタブを書き換えられませんでした：' + e.message);
  }
}

/** 管理シートを開く（URLを聞く。2回目からは覚えている）。やめたら・開けなければ null */
function openLegacySource_(ui, title) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('LEGACY_URL');
  var ask = !url || ui.alert(title, '前と同じ管理シートから取り込みますか？\n（「いいえ」で、URLを入れ直します）', ui.ButtonSet.YES_NO) !== ui.Button.YES;
  if (ask) {
    var r = ui.prompt(title, '管理シート「シフト及び売上等」のURLを貼ってください。', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) { ui.alert('やめました。'); return null; }
    url = r.getResponseText().trim();
  }
  var source;
  try { source = SpreadsheetApp.openByUrl(url); } catch (e) { ui.alert('管理シートを開けませんでした。URLを確かめてください。\n' + e.message); return null; }
  props.setProperty('LEGACY_URL', url);
  return source;
}

/**
 * 管理シート（9月・10月）を取り込み直す（ロックの中で呼ぶ）：金額（過去の日別・過去の月次・9月と10月のタブ）と、予定（シフト・イベント）をまとめて。
 * どちらも、何度実行しても二重にならない（金額はその月をまるごと置き換え、予定はIDで上書き）。管理シートに10月の続きが打たれたら、これを実行する
 */
function reimportLegacy_(source, today) { // 予定は、9月・10月に加えて、管理シートに11月以降のタブがあれば、その月も（空いている日だけ）。手打ちのタブは、管理シートの写しにする
  var money = importLegacy_(source, today);
  var plans = importLegacyPlans_(source, today);
  try { rebuildTrialAppTabs_(); } catch (e) { console.error('試運転のアプリのタブを作れませんでした：' + e.message); }
  return { today: today, money: money, plans: plans, hand: copyHandTabs_(source, getSettings_(), today) };
}

/** 取り込み直しの結果の表示 */
function reimportMessage_(r) {
  var yen = function (v) { return '¥' + String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var plan = {};
  r.plans.tabs.forEach(function (t) { plan[t.tab] = t; });
  var lines = ['管理シートから取り込み直しました（9月・10月の金額は ' + r.today + ' まで。予定は月末まで。11月以降の金額は、手打ちのタブにだけ写します）', ''];
  var planLine = function (p) {
    return '　予定：取り込んだ日 ' + (p.days || 0) + '日（うち店休日 ' + (p.closedDays || 0) + '日）・シフトの人数 のべ' + (p.people || 0) + '人・イベント ' + (p.events || 0) + '件'
      + '・上書きせずに飛ばした日 ' + (p.skipped || 0) + '日' + (p.legacy ? '（9月・10月は管理シートの内容で上書き）' : '')
      + '\n　見込みの合計：' + yen(p.expected) + '（' + (p.legacy ? '明日' : '今日') + '以降の日の団体売上を、その日のイベントの見込みに）';
  };
  r.money.forEach(function (x) {
    if (x.error) { lines.push(x.tab + '：' + x.error); return; }
    lines.push('■ ' + x.tab);
    lines.push('　金額：' + x.days + '日分（' + x.until + '）・売上の合計 ' + yen(x.sales));
    if (plan[x.tab]) lines.push(planLine(plan[x.tab]));
    if (x.unknown.length) lines.push('　読めなかった列：' + x.unknown.join('、'));
  });
  r.plans.tabs.forEach(function (p) { // 11月以降（予定だけ。金額は入れない）
    if (p.legacy !== false || p.error) return;
    lines.push('■ ' + p.tab + '（予定だけ。もう入っている日は上書きしない）');
    lines.push(planLine(p));
    (r.hand || []).forEach(function (h) {
      if (h.month !== p.month) return;
      lines.push(h.error ? '　' + h.error : '　「' + h.tab + '」に写した日 ' + h.days + '日・売上の合計（今日まで） ' + yen(h.sales));
    });
  });
  (r.hand || []).forEach(function (h) { // 予定の取り込みの月に入っていない手打ちのタブ
    if (r.plans.tabs.some(function (p) { return p.month === h.month && p.legacy === false; })) return;
    lines.push('■ ' + h.tab);
    lines.push(h.error ? '　' + h.error : '　写した日 ' + h.days + '日・売上の合計（今日まで） ' + yen(h.sales));
  });
  var oct = r.money.filter(function (x) { return x.tab === '10月' && !x.error; })[0];
  if (oct) lines.push('', '10月の売上の合計：' + yen(oct.sales) + '（' + oct.until + '）');
  if (r.plans.removed) lines.push('', '管理シートから消えていたイベント：' + r.plans.removed + '件を削除にしました');
  lines.push('', '月のタブ（9月・10月）を' + (r.money[0] && r.money[0].tabs === 'copy' ? '管理シートの9月をコピーして' : '自前の形で（見本のコピーができなかったため）') + '作り直しました。',
    '何度実行しても二重にはなりません（金額はその月をまるごと置き換え、予定は同じ日・同じ名前に上書きします。11月以降は、アプリやスプシで入れた・直した日は上書きしません）。');
  return lines.join('\n');
}

/** スプシのメニュー：管理シートのURLを聞いて（2回目からは覚えている）、9月・10月の金額と予定を取り込み直す */
function reimportLegacy() {
  var ui = SpreadsheetApp.getUi();
  var source = openLegacySource_(ui, '管理シートから取り込み直す');
  if (!source) return;
  var today = serverBizDate_(getSettings_());
  var r = withLock_(function () { return reimportLegacy_(source, today); });
  ui.alert(reimportMessage_(r));
}

/** 毎朝6時ごろに動く（トリガー）：ボタンと同じ取り込み直し。管理シートのURLは、前にボタンで入れたものを使う。結果はスクリプトプロパティに残す */
function reimportLegacyAuto() {
  var props = PropertiesService.getScriptProperties();
  var note = function (result) { props.setProperty('AUTO_REIMPORT_LAST', JSON.stringify({ at: nowIso_(), result: result })); };
  try {
    var url = props.getProperty('LEGACY_URL');
    if (!url) { note('管理シートのURLがまだありません（先に「管理シートから取り込み直す」を1回押してください）'); return; }
    var source = SpreadsheetApp.openByUrl(url);
    var today = serverBizDate_(getSettings_());
    var r = withLock_(function () { return reimportLegacy_(source, today); });
    note('取り込み直しました：' + (r.hand || []).map(function (h) { return h.error ? h.tab + ' ' + h.error : h.tab + ' ' + h.days + '日'; }).join('・'));
  } catch (e) {
    console.error('管理シートから自動で取り込み直せませんでした：' + e.message);
    note('失敗：' + e.message);
  }
}

// ===== 管理シート（9月・10月）のシフトとイベントを、アプリの予定に入れる =====
// 名前と予定だけ（金額・見込みは入れない）。9月・10月は運用開始日より前なので、売上・月次・カウンターには効かない（月次は管理シートの数字）。
// 何度実行しても二重にならない：営業日はID＝日付で上書き、イベントはID＝'lg-日付-名前'。管理シートから消えたイベントは削除にする。
// 取り込んだ営業日の行はメモに印を付け、「テストの行を消す」で消さない
var LEGACY_PLAN_MARK = '管理シートの予定から';
var LEGACY_PLAN_SHIFT_COLS = 4; // シフトの欄のうち取り込む列（C〜F の4列すべて。2026-10-16 林の指示）

var LEGACY_PLAN_DEVICE = 'kanri-import'; // 取り込みで書いた行の「端末」。アプリやスプシで直すと変わるので、直された行は上書きしない

/**
 * 予定を取り込む管理シートのタブ：9月・10月（管理シートの月。いつも管理シートの内容で上書き）と、
 * 運用開始日の月以降で、今月の2か月前〜2か月先の月（空いている日だけ入れる）。タブの名前は「11月」「2027年1月」「1月」の形
 */
function legacyPlanTabs_(source, settings) {
  var out = [];
  Object.keys(LEGACY_TABS).forEach(function (tab) { out.push({ tab: tab, month: LEGACY_TABS[tab], legacy: true, sheet: source.getSheetByName(tab) }); });
  var goLive = String(settings.goLiveDate || '').slice(0, 7);
  var now = Utilities.formatDate(now_(), TZ, 'yyyy-MM');
  var from = prevMonth_(prevMonth_(now)), to = nextMonth_(nextMonth_(now));
  if (goLive && goLive > from) from = goLive;
  var legacy = Object.keys(LEGACY_TABS).map(function (k) { return LEGACY_TABS[k]; });
  for (var m = from; m <= to; m = nextMonth_(m)) {
    if (legacy.indexOf(m) >= 0) continue;
    var found = legacySourceTab_(source, m);
    if (found) out.push({ tab: found.name, month: m, legacy: false, sheet: found.sheet });
  }
  return out;
}

/** 管理シートの、その月のタブ（「11月」「2027年1月」「1月」の形）。なければ null */
function legacySourceTab_(source, month) {
  var names = [monthTabLabel_(month), Number(month.slice(5, 7)) + '月'];
  for (var i = 0; i < names.length; i++) { var sh = source.getSheetByName(names[i]); if (sh) return { name: names[i], sheet: sh }; }
  return null;
}

// ===== 手打ちのタブ＝管理シートの写し（2026-10-16〜）=====
// 試運転のあいだ、店長は11月以降の数字を管理シートに打つ。手打ちのタブ（「11月（手打ち）」）は、管理シートのその月のタブの写しにする。
// 写すたびに、日の行（2〜32行目）のシフト・団体及びイベント・金額をまるごと上書きする（二重にならない）。合計の行と「アプリとの差」の行はそのまま。
// 列の並びは手打ちのタブのまま（見出しの名前で読むので、管理シートの列の並びが違っても同じ列に入る）
var HAND_TAB_NOTICE = 'このタブは管理シートの写しです。ここに打っても、次に写すとき（「管理シートから取り込み直す」・毎朝6時ごろ）に上書きされます。数字は管理シートに打ってください。';
var HAND_NOTICE_COL = 19; // S1（保険の見出しの右）

/** 手打ちのタブの上に、一言と、打とうとしたときの注意を付ける（何度付けてもよい） */
function markHandTab_(sh) {
  sh.getRange(1, HAND_NOTICE_COL).setValue(HAND_TAB_NOTICE).setFontWeight('bold').setFontColor('#c0392b').setWrap(false);
  try { sh.getRange(1, 1).setNote(HAND_TAB_NOTICE); } catch (e) { /* メモが付けられなくても先へ */ }
  try {
    var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
    p.setDescription(HAND_TAB_NOTICE);
    p.setWarningOnly(true); // 打てなくはしない。打とうとすると注意が出る
  } catch (e) { /* 注意を付けられなくても先へ */ }
}

/** 管理シートのタブ（2次元の値）を、手打ちのタブに写す。写した日数（何か入っている日）と、今日までの売上の合計を返す */
function copyHandTab_(sh, values, month, settings, today) {
  today = today || serverBizDate_(settings);
  var parsed = parseLegacyTab_(values, month, '9999-12-31', null);
  var byDate = {};
  parsed.days.forEach(function (d) { byDate[d.date] = d; });
  var n = daysInMonth_(month), rows = [], days = 0, sales = 0;
  for (var i = 0; i < MONTH_ROWS; i++) {
    var row = blankRow_();
    if (i < n) {
      var date = month + '-' + pad2_(i + 1), d = byDate[date];
      row[0] = i + 1; row[1] = dowOf_(date);
      if (d) {
        var sc = d.shiftCells || [];
        row[2] = sc[0] || ''; row[3] = sc[1] || ''; row[4] = sc[2] || ''; row[5] = sc[3] || '';
        row[6] = d.event || '';
        var fx = d.fixed || {};
        var money = [d.laborKana, d.laborOther, d.cash, d.group, d.point, d.food, d.other, d.cashless,
          fx['家賃電気'] || 0, fx['ガス・カラオケ・Wi-Fi・電話'] || 0, fx['保険'] || 0];
        var any = money.some(function (v) { return v !== 0; });
        if (any) for (var k = 0; k < money.length; k++) row[7 + k] = money[k]; // 金額が1つもない日は、金額の列を空にする
        if (any || row.slice(2, 7).some(String)) days += 1;
        if (date <= today) sales += d.cash + d.group + d.cashless + (settings.pointCountsAsSales === false ? 0 : d.point); // 売上の合計は今日まで（先の日の団体売上は見込み）
      }
    }
    rows.push(row);
  }
  sh.getRange(2, 3, MONTH_ROWS, 5).setNumberFormat('@'); // 名前に「=」で始まる文字があっても、数式にしない
  sh.getRange(2, 1, MONTH_ROWS, 18).setValues(rows);
  markHandTab_(sh);
  return { days: days, sales: sales };
}

/** 手打ちのタブがある月（運用開始日の月〜2か月先）を、管理シートから写す（ロックの中で呼ぶ） */
function copyHandTabs_(source, settings, today) {
  var ss = SpreadsheetApp.getActive();
  var goLive = String(settings.goLiveDate || '').slice(0, 7);
  var to = nextMonth_(nextMonth_(Utilities.formatDate(now_(), TZ, 'yyyy-MM')));
  var out = [];
  if (!goLive) return out;
  for (var m = goLive; m <= to; m = nextMonth_(m)) {
    var hand = ss.getSheetByName(monthTabLabel_(m) + HAND_TAB_SUFFIX);
    if (!hand) continue;
    var src = legacySourceTab_(source, m);
    if (!src) { out.push({ tab: hand.getName(), month: m, error: '管理シートに「' + monthTabLabel_(m) + '」のタブがありません（写していません）' }); continue; }
    var r = copyHandTab_(hand, src.sheet.getDataRange().getValues(), m, settings, today);
    out.push({ tab: hand.getName(), month: m, from: src.name, days: r.days, sales: r.sales });
  }
  return out;
}

/**
 * 取り込む（ロックの中で呼ぶ）。件数を返す。
 * 9月・10月：管理シートの内容で上書き。11月以降：アプリの予定（またはアプリのタブ）にもう入っている日は飛ばし、空いている日だけ入れる
 * （前にこの取り込みで入れて、そのあと誰も直していない日は、管理シートの内容に合わせ直す）。入れたら、その月のアプリのタブのシフト・イベントの欄も書き換える
 */
function importLegacyPlans_(source, today) {
  var settings = getSettings_();
  var now = nowIso_();
  today = today || serverBizDate_(settings);
  var ctx = { mgr: true, settings: settings, deviceId: LEGACY_PLAN_DEVICE, by: '管理シートの取り込み', force: true };
  var tabs = legacyPlanTabs_(source, settings);
  if (tabs.some(function (t) { return !t.legacy; })) catchUpSheetEdits_(settings, true); // アプリのタブで打って、まだアプリに入っていない分を先に入れる
  var dayRows = {};
  readTable_(TABLES.days).rows.forEach(function (r) { dayRows[String(r.id)] = r; });
  var eventRows = readTable_(TABLES.events).rows;
  var eventById = {};
  eventRows.forEach(function (e) { eventById[String(e.id)] = e; });
  var eventVisitDates = {};
  readTable_(TABLES.visits).rows.forEach(function (v) { if (v.kind === 'イベント' && v.status !== '削除' && v.trial !== true) eventVisitDates[v.bizDate] = true; });
  var type = (settings.eventTypes || [])[0] || '団体';
  var dayOps = [], eventOps = [], keep = {}, months = [], skippedDates = {}, appMonths = [];
  var res = { tabs: [], days: 0, people: 0, closedDays: 0, events: 0, skipped: 0, removed: 0 };
  // その日に、取り込み以外で入った予定があるか（シフト・店休日・イベント・入店したイベント）
  var filled = function (date) {
    var r = dayRows[date];
    if (r && r.deviceId !== LEGACY_PLAN_DEVICE && (r.shiftPlan || r.shiftActual || r.closed === true)) return true;
    if (eventVisitDates[date]) return true;
    return eventRows.some(function (e) { return e.date === date && e.status !== '削除' && e.deviceId !== LEGACY_PLAN_DEVICE; });
  };
  tabs.forEach(function (tb) {
    if (!tb.sheet) { res.tabs.push({ tab: tb.tab, error: 'タブ「' + tb.tab + '」が見つかりません' }); return; }
    months.push(tb.month);
    if (!tb.legacy) appMonths.push(tb.month);
    var parsed = parseLegacyTab_(tb.sheet.getDataRange().getValues(), tb.month, '9999-12-31', null); // 先の日（予定）も入れる
    var t = { tab: tb.tab, month: tb.month, legacy: tb.legacy, days: 0, people: 0, closedDays: 0, events: 0, skipped: 0, expected: 0 };
    parsed.days.forEach(function (d) {
      var cells = d.shiftCells.slice(0, LEGACY_PLAN_SHIFT_COLS).filter(String);
      var closed = cells.indexOf('店休日') >= 0;
      var names = [];
      cells.forEach(function (x) { if (x !== '店休日' && names.indexOf(x) < 0) names.push(x); });
      var titles = [];
      String(d.event || '').split(/[、,，\n]+/).forEach(function (x) { x = x.trim(); if (x && titles.indexOf(x) < 0) titles.push(x); });
      var has = names.length || closed || titles.length;
      if (!tb.legacy && filled(d.date)) { // 11月以降：もう入っている日は上書きしない
        skippedDates[d.date] = true;
        if (has) t.skipped += 1;
        return;
      }
      // 見込み：管理シートには見込みの列がなく、まだ来ていない日の「団体売上」に、その日のイベントの金額（合計）が書いてある。
      // その日の最初のイベントの見込みにする（イベントの名前がなければ「イベント」を足す）。9月・10月は今日まで金額として取り込むので、明日から
      var future = tb.legacy ? d.date > today : d.date >= today;
      var amount = future ? Number(d.group) || 0 : 0;
      if (amount > 0 && !titles.length) titles.push('イベント');
      var cur = dayRows[d.date];
      var ours = cur && (tb.legacy ? cur.memo === LEGACY_PLAN_MARK : cur.deviceId === LEGACY_PLAN_DEVICE);
      if (names.length || closed || ours) {
        dayOps.push({ opId: 'lgp-' + d.date + '-' + now, id: d.date, data: { bizDate: d.date, shiftPlan: names.join('、'), closed: closed, memo: LEGACY_PLAN_MARK, updatedAt: now } });
      }
      if (names.length || closed) t.days += 1;
      else if (titles.length) t.days += 1;
      t.people += names.length;
      if (closed) t.closedDays += 1;
      t.expected += amount;
      titles.forEach(function (title, k) {
        var id = 'lg-' + d.date + '-' + title;
        keep[id] = true;
        t.events += 1;
        var data = { date: d.date, title: title, status: '有効', memo: LEGACY_PLAN_MARK, updatedAt: now };
        var unitSet = eventById[id] && Number(eventById[id].unitPrice) > 0 && Number(eventById[id].people) > 0; // アプリで人数と単価を入れた予定は、人数×単価のまま
        if (future && !unitSet) data.expectedAmount = k === 0 && amount > 0 ? amount : null; // 過ぎた日の見込みは触らない（カウンターにも入らない）
        if (!eventById[id]) { data.type = type; data.createdAt = now; }
        eventOps.push({ opId: 'lge-' + id + '-' + now, id: id, data: data });
      });
    });
    res.tabs.push(t);
    res.days += t.days; res.people += t.people; res.closedDays += t.closedDays; res.events += t.events; res.skipped += t.skipped; res.expected = (res.expected || 0) + t.expected;
  });
  eventRows.forEach(function (e) { // 前に取り込んで、管理シートから消えたイベントは削除にする（11月以降は、飛ばした日と、直された予定は触らない）
    var id = String(e.id);
    if (id.indexOf('lg-') !== 0 || keep[id] || e.status === '削除' || months.indexOf(monthOf_(e.date)) < 0) return;
    if (appMonths.indexOf(monthOf_(e.date)) >= 0 && (skippedDates[e.date] || e.deviceId !== LEGACY_PLAN_DEVICE)) return;
    eventOps.push({ opId: 'lge-del-' + id + '-' + now, id: id, data: { status: '削除', updatedAt: now } });
    res.removed += 1;
  });
  if (dayOps.length) upsert_('days', dayOps, ctx);
  if (eventOps.length) upsert_('events', eventOps, ctx);
  appMonths.forEach(function (m) { if (appTab_(SpreadsheetApp.getActive(), m)) refreshPlanColumns_(m); }); // アプリのタブのシフト・イベントの欄にも出す
  appendLog_({ type: '管理シートの予定を取り込む', table: 'days', targetId: months.join(','),
    after: { days: res.days, people: res.people, closedDays: res.closedDays, events: res.events, skipped: res.skipped, removed: res.removed }, by: '管理シートの取り込み' }, ctx);
  return res;
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
  var splitMonth = !!goLive && goLive.slice(0, 7) === month && goLive.slice(8, 10) > '01'; // 運用開始日が月の途中
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
    if (v.kind !== 'イベント') { s.cash += n(v.cash); s.cashless += n(v.cashless); s.point += n(v.point); } // イベントは「イベント」の金額で別に数える（管理シートの団体売上と同じ）
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
  if (splitMonth) {
    var before = readLegacyRows_().filter(function (d) { return monthOf_(d.date) === month && d.date < goLive; });
    if (before.length) { mergeLegacyDays_(s, before, settings); s.splitAt = goLive; }
  }
  readTable_(TABLES.events).rows.forEach(function (e) {
    if (e.status !== '削除' && inMonth(e.date) && (settings.eventTypes || []).indexOf(e.type) >= 0) s.plannedEvents += 1;
  });
  return finishSummary_(s, settings);
}

/** 合計・率・目標など、記録から出す数字を足す */
function finishSummary_(s, settings) {
  var t = settings.targets || {};
  s.mgrFee = Number(settings.managerFee) || 0; // 店長報酬（月額）
  s.expenses = s.purchaseTotal + s.fixedTotal + s.laborTotal + s.mgrFee;
  s.profit = s.sales - s.expenses; // 差し引き（店長報酬を引いたあと）
  s.avgPerGuest = s.guests ? Math.round(s.sales / s.guests) : 0;
  s.normalDailyAvg = s.openDays ? Math.round((s.sales - s.event) / s.openDays) : 0;
  s.laborRate = s.sales ? Math.round(s.laborTotal / s.sales * 1000) / 10 : 0;
  s.costRate = s.sales ? Math.round(s.purchases['飲食物'] / s.sales * 1000) / 10 : 0;
  var monthTarget = monthTarget_(s.month, settings);
  s.target = {
    monthlySales: monthTarget, salesRate: monthTarget ? Math.round(s.sales / monthTarget * 100) : 0,
    dailyGuests: Number(t.dailyGuests) || 0, avgGuestsPerDay: s.openDays ? Math.round(s.guests / s.openDays * 10) / 10 : 0,
    monthlyEvents: Number(t.monthlyEvents) || 0, events: s.eventGroups
  };
  return s;
}

/** 「過去の月次」タブ（1列目が項目、1行目が月 YYYY-MM。管理シートの取り込みで作る）から、その月の数字を読む。なければ null */
function legacySummary_(month) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEGACY_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = vals[0].map(function (h) { return h instanceof Date ? Utilities.formatDate(h, TZ, 'yyyy-MM') : String(h).slice(0, 7); }).indexOf(month);
  if (col < 1) return null;
  var rows = vals.slice(1).map(function (r) { return { label: String(r[0]).trim(), value: r[col] }; });
  var get = function (label) { var r = rows.filter(function (x) { return x.label === label; })[0]; return r ? Number(r.value) || 0 : 0; };
  var text = function (label) { var r = rows.filter(function (x) { return x.label === label; })[0]; return r ? String(r.value || '') : ''; };
  var s = {
    month: month, legacy: true, sales: get('売上'), guests: get('来客数'), groups: get('組数'),
    cash: get('現金'), cashless: get('キャッシュレス'), point: get('ポイント'),
    nomi: 0, tanpin: 0, event: get('イベント'), eventGroups: get('イベントの組数'), openDays: get('営業日数'),
    closedDays: get('店休日'), zeroDays: text('売上0円の営業日').split('、').filter(String),
    purchases: { '飲食物': get('飲食物'), '備品': get('備品'), 'その他': get('その他') },
    otherNotes: [], fixed: {}, fixedTotal: 0, laborFixed: [], laborOthers: { cost: get('人件費（その他）'), count: 0, names: [] },
    plannedEvents: 0, importedUntil: text('取り込んだ範囲')
  };
  s.purchaseTotal = s.purchases['飲食物'] + s.purchases['備品'] + s.purchases['その他'];
  rows.forEach(function (r) {
    if (r.value === '' || r.value == null) return; // その月にない項目（9月の保険など）
    var f = /^固定費：(.+)$/.exec(r.label);
    if (f) { s.fixed[f[1]] = Number(r.value) || 0; s.fixedTotal += Number(r.value) || 0; }
    var l = /^人件費（(.+)）$/.exec(r.label);
    if (l && l[1] !== 'その他') s.laborFixed.push({ name: l[1], days: 0, hours: 0, transport: 0, cost: Number(r.value) || 0 });
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
  var goMonth = String(settings.goLiveDate || now).slice(0, 7);
  var last = now > goMonth ? now : goMonth; // 運用開始の前でも、運用開始の月までは作る
  for (var m = first; m <= last; m = nextMonth_(m)) months.push(m);
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
    ['営業日数', function (s) { return s.openDays; }], ['通常営業の1日平均', function (s) { return s.normalDailyAvg; }],
    ['仕入れ', function (s) { return s.purchaseTotal; }],
    ['　飲食物', function (s) { return s.purchases['飲食物']; }], ['　備品', function (s) { return s.purchases['備品']; }],
    ['　その他', function (s) { return s.purchases['その他']; }], ['　その他の内容', function (s) { return s.otherNotes.join('・'); }],
    ['固定費', function (s) { return s.fixedTotal; }]
  ].concat(fixedItems.map(function (k) { return ['　' + k, function (s) { return s.fixed[k] || 0; }]; }))
    .concat([['人件費', function (s) { return s.laborTotal; }]])
    .concat(staffNames.map(function (nm) { return ['　' + nm, function (s) { var r = s.laborFixed.filter(function (x) { return x.name === nm; })[0]; return r ? r.cost : 0; }]; }))
    .concat([
      ['　人件費（その他）', function (s) { return s.laborOthers.cost; }],
      ['店長報酬', function (s) { return s.mgrFee; }],
      ['支出', function (s) { return s.expenses; }],
      ['差し引き', function (s) { return s.profit; }],
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
  var min = addDays_(serverBizDate_(ctx.settings, ctx.at), -(Number(se.days) || 0));
  var dates = [cur && cur[def.dateKey], data[def.dateKey]].filter(function (d) { return d; });
  return dates.every(function (d) { d = String(d); return d >= min.slice(0, Math.min(d.length, 10)); });
}

function serverBizDate_(settings, atMs) {
  var cutoff = Number(settings.bizDayCutoffHour);
  if (isNaN(cutoff)) cutoff = 12;
  return Utilities.formatDate(new Date((atMs || now_().getTime()) - cutoff * 3600e3), TZ, 'yyyy-MM-dd');
}

/**
 * 操作ごとの判定の文脈。端末が操作を保存した時刻（op.at）が受け取る時刻より前なら、その時刻の営業日でバイトの権限を判定する
 * （閉店の送信が失敗したまま、翌営業日に届いても、断らないため）。受け取る時刻より未来や、48時間より前の時刻は信じない
 */
function opContext_(ctx, op) {
  var at = op && op.at ? Date.parse(op.at) : NaN;
  if (isNaN(at)) return ctx;
  var now = now_().getTime();
  var t = Math.min(now, Math.max(at, now - 48 * 3600e3));
  if (t >= now - 1000) return ctx;
  var c = {};
  Object.keys(ctx).forEach(function (k) { c[k] = ctx[k]; });
  c.at = t;
  return c;
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
