// 来客・会計・レジの計算（画面から切り離して、テストできるようにしておく）
//
// 数え方
// - 組の合計 = 基本の金額（入店のときに決まる）＋ 追加の合計
// - 受け取りは何回でも（割り勘・併用）。合計に達したら退店
// - 売上・来客数に数えるのは「退店」した組だけ。店内の組の合計は「見込み」
// - あるはずの現金 = 開店時のレジの現金 ＋ 今日の現金売上 ＋ 入金 − 出金 − 回収（オーナーがレジから抜いた分）
//   回収は支出ではない（仕入れにも月次にも入れない）。レジの現金からだけ引く
// - 出金は「出した額 → 内訳」（仕入れ・スタッフへの支払い・小口へ・レジに戻す）。レジから減るのは 出した額 − レジに戻した分
// - 小口現金はレジとは別に数える（あるはずの現金にも月次にも混ぜない）

export const KIND_NOMI = '飲み放題';
export const KIND_TANPIN = '単品';
export const KIND_EVENT = 'イベント';
export const KINDS = [KIND_NOMI, KIND_TANPIN, KIND_EVENT];
export const METHODS = ['現金', 'キャッシュレス', 'ポイント'];
export const ST_IN = '店内';
export const ST_OUT = '退店';
export const ST_DEL = '削除';
export const MOVE_IN = '入金';
export const MOVE_OUT = '出金';
export const MOVE_COLLECT = '回収';
export const MOVE_PETTY_PAY = '小口から払う'; // レジは変わらない。内訳（仕入れ・スタッフへの支払い）は出金と同じく写す
export const MOVE_PETTY_BACK = '小口からレジへ'; // レジに入る（入金と同じ向き）
// 出金の内訳の種類
export const LINE_BUY = '仕入れ';
export const LINE_STAFF = 'スタッフ';
export const LINE_PETTY = '小口';
export const LINE_BACK = '戻す';
export const LINE_KINDS = [LINE_BUY, LINE_STAFF, LINE_PETTY, LINE_BACK];
export const EXTRA_ADD = '追加';
export const EXTRA_EXT = '延長';

const n = v => Number(v) || 0;
const yen = v => '¥' + Math.round(n(v)).toLocaleString('ja-JP');
const isInt = v => Number.isInteger(Number(v)) && v !== '' && v != null;

// ===== 組 =====

/** 名前が空のときの当日の通し番号（削除した組も数えて、番号を使い回さない） */
export function nextNo(allVisitsOfDay) {
  return allVisitsOfDay.reduce((m, v) => Math.max(m, n(v.no)), 0) + 1;
}

export function label(v) {
  return v.name ? v.name : `${v.no}組目`;
}

/** 入店のときの基本の金額。飲み放題＝人数×料金、イベント＝団体の合計、単品＝0円 */
export function baseAmount(kind, people, s, eventAmount = 0) {
  if (kind === KIND_NOMI) return n(people) * n(s.nomiPrice);
  if (kind === KIND_EVENT) return n(eventAmount);
  return 0;
}

/**
 * 追加（extras）と受け取り（pays）は、1件ごとにIDを持つ。消すときは配列から外さず、del の印を付ける
 * （GASは2台からの送信をIDごとに合わせるので、外すと、もう片方の端末の古い写しで復活してしまうため）
 */
export const live = arr => (arr || []).filter(x => x && !x.del);
export const liveExtras = v => live(v.extras);
export const livePays = v => live(v.pays);
/** 消す：印を付けた新しい配列 */
export const markDeleted = (arr, id) => (arr || []).map(x => (x.id === id ? { ...x, del: true } : x));
export const markAllDeleted = arr => (arr || []).map(x => ({ ...x, del: true }));

export const extrasTotal = v => liveExtras(v).reduce((a, x) => a + n(x.amount), 0);
export const total = v => n(v.base) + extrasTotal(v);
export const paidTotal = v => livePays(v).reduce((a, p) => a + n(p.amount), 0);
export const remaining = v => Math.max(0, total(v) - paidTotal(v));
export const overpaid = v => Math.max(0, paidTotal(v) - total(v));

/** 受け取りを支払い方法ごとに足す（スプシの列 現金・キャッシュレス・ポイント） */
export function methodSums(pays) {
  const sum = m => live(pays).filter(p => p.method === m).reduce((a, p) => a + n(p.amount), 0);
  return { cash: sum('現金'), cashless: sum('キャッシュレス'), point: sum('ポイント') };
}

/**
 * 受け取る。input が空なら残りの全額。
 * - 現金で残りより多ければ、残りだけ受け取ってお釣りを出す
 * - キャッシュレス・ポイントで残りより多い金額は受け付けない
 * - 残りが0円なら、受け取らずに退店（0円の組）
 * @returns {{ok: boolean, error?: string, pay?: {method: string, amount: number}|null, change?: number, finished?: boolean}}
 */
export function receive(v, method, input) {
  if (overpaid(v) > 0) return { ok: false, error: `受け取り済みが合計より ${yen(overpaid(v))} 多くなっています。受け取りを消して直してください。` };
  const rem = remaining(v);
  if (rem === 0) return { ok: true, pay: null, change: 0, finished: true };
  const raw = input === '' || input == null ? rem : Number(input);
  if (!isInt(raw) || raw <= 0) return { ok: false, error: '金額を入れてください。' };
  if (raw > rem && method !== '現金') return { ok: false, error: `残り（${yen(rem)}）より多い金額です。` };
  const amount = Math.min(raw, rem);
  return { ok: true, pay: { method, amount }, change: raw - amount, finished: amount >= rem };
}

/** 精算済みの組の支払いの表示：「キャッシュレス ¥7,000 ＋ 現金 ¥3,500」 */
export function payLabel(v) {
  const pays = livePays(v);
  return pays.length ? pays.map(p => `${p.method} ${yen(p.amount)}`).join(' ＋ ') : '0円';
}

/**
 * 延長：選んだ人数だけにかける。金額＝1人の延長料金×人数。卓の時間は、1人でも延長すれば延びる
 * 前の版の延長（人数の記録がない）は、卓の全員にかけた分
 */
export function extensionExtra(x, count) {
  const c = Math.max(1, Math.floor(n(count)));
  return { type: EXTRA_EXT, label: x.label, unit: n(x.price), count: c, amount: n(x.price) * c, minutes: n(x.minutes) };
}

/** 追加・延長の明細の名前：「延長2時間 ×3人」 */
export function extraLabel(x) {
  if (x.type !== EXTRA_EXT) return '追加';
  return `${x.label || '延長'}` + (n(x.count) > 0 ? ` ×${n(x.count)}人` : '');
}

/** 飲み放題の時間（延長を足した合計・分） */
export function nomiMinutes(v, s) {
  return n(s.nomiMinutes) + liveExtras(v).filter(x => x.type === EXTRA_EXT).reduce((a, x) => a + n(x.minutes), 0);
}

/**
 * 時間の状態。kind: ok=余裕 / lo=ラストオーダー（イベントは終了まぎわ）/ over=超過 / single=単品
 * - 飲み放題：入店から（時間＋延長）まで
 * - イベント：終了の予定時刻まで
 * - 単品：経過時間だけ
 */
export function timeState(v, s, now = new Date()) {
  const t = now.getTime();
  if (v.kind === KIND_TANPIN || (v.kind === KIND_EVENT && !v.endAt)) {
    return { kind: 'single', elapsed: Math.max(0, Math.floor((t - Date.parse(v.inAt)) / 60e3)) };
  }
  const end = v.kind === KIND_EVENT ? Date.parse(v.endAt) : Date.parse(v.inAt) + nomiMinutes(v, s) * 60e3;
  const left = Math.floor((end - t) / 60e3);
  return { kind: left < 0 ? 'over' : left <= n(s.lastOrderMinutes) ? 'lo' : 'ok', left };
}

/** カードの大きな文字（雛形どおり） */
export function timeText(v, st) {
  if (st.kind === 'single') return `経過 ${st.elapsed}分`;
  if (st.kind === 'over') return `${-st.left}分超過`;
  return v.kind === KIND_EVENT ? `終了まで${st.left}分` : `あと${st.left}分`;
}

// ===== その日の合計 =====

/** 売上に数える金額。ポイントを売上に含めない設定なら、ポイントで受け取った分を引く */
export function countedAmount(v, s) {
  return total(v) - (s.pointCountsAsSales === false ? methodSums(v.pays).point : 0);
}

export function daySummary(visits, s) {
  const done = visits.filter(v => v.status === ST_OUT);
  const inStore = visits.filter(v => v.status === ST_IN);
  const sum = (arr, f) => arr.reduce((a, v) => a + f(v), 0);
  const sales = sum(done, v => countedAmount(v, s));
  const guests = sum(done, v => n(v.people));
  const byKind = k => sum(done.filter(v => v.kind === k), v => countedAmount(v, s));
  const ms = done.reduce((a, v) => { const m = methodSums(v.pays); a.cash += m.cash; a.cashless += m.cashless; a.point += m.point; return a; }, { cash: 0, cashless: 0, point: 0 });
  return {
    sales, guests, groups: done.length, avg: guests ? Math.round(sales / guests) : 0,
    ...ms,
    nomi: byKind(KIND_NOMI), tanpin: byKind(KIND_TANPIN), event: byKind(KIND_EVENT),
    inStore: inStore.length, inStorePeople: sum(inStore, v => n(v.people)), expected: sum(inStore, total)
  };
}

/** 割合（0〜100の整数） */
export const pct = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);

// ===== レジ =====

const active = moves => (moves || []).filter(m => m.status !== ST_DEL);

/** 出金の内訳。前の版の出金（内訳なし）は、全額が1行の仕入れ */
export function moveLines(m) {
  if (Array.isArray(m.lines)) return m.lines.filter(l => l && !l.del);
  if (m.type === MOVE_OUT) return [{ id: 'old', kind: LINE_BUY, category: m.category, note: m.note, amount: n(m.amount) }];
  return [];
}
const linesSum = (m, kind) => moveLines(m).filter(l => l.kind === kind).reduce((a, l) => a + n(l.amount), 0);

/** レジの現金が増える（＋）・減る（−）額 */
export function registerEffect(m) {
  if (m.type === MOVE_IN || m.type === MOVE_PETTY_BACK) return n(m.amount);
  if (m.type === MOVE_OUT) return -(n(m.amount) - linesSum(m, LINE_BACK));
  if (m.type === MOVE_COLLECT) return -n(m.amount);
  return 0; // 小口から払う
}

/** 小口現金が増える（＋）・減る（−）額 */
export function pettyEffect(m) {
  if (m.type === MOVE_OUT) return linesSum(m, LINE_PETTY);
  if (m.type === MOVE_PETTY_PAY || m.type === MOVE_PETTY_BACK) return -n(m.amount);
  return 0;
}

/** 小口現金の残高 ＝ 最初の残高（設定。入れるまでは0）＋ 入った分 − 出た分 */
export function pettyBalance(moves, start = 0) {
  return n(start) + active(moves).reduce((a, m) => a + pettyEffect(m), 0);
}

/** 内訳の1行の表示：「仕入れ（飲食物・酒屋）」「スタッフへの支払い（一日ママ）」「小口へ」「レジに戻す」 */
export function lineLabel(l) {
  if (l.kind === LINE_BUY) return `仕入れ（${l.category === 'その他' ? `その他・${l.note || ''}` : [l.category, l.note].filter(Boolean).join('・')}）`;
  if (l.kind === LINE_STAFF) return `スタッフへの支払い（${l.name || ''}）`;
  if (l.kind === LINE_PETTY) return '小口へ';
  if (l.kind === LINE_BACK) return 'レジに戻す';
  return String(l.kind || '');
}

/** 内訳の確かめ。出した額と内訳の合計が合い、各行が埋まっていれば ok。diff＝出した額 − 内訳の合計 */
export function checkLines(amount, lines) {
  const ls = (lines || []).filter(l => l && !l.del);
  const sum = ls.reduce((a, l) => a + n(l.amount), 0);
  const diff = n(amount) - sum;
  let error = '';
  if (!isInt(amount) || n(amount) <= 0) error = '出した額を入れてください。';
  else if (!ls.length) error = '内訳を足してください。';
  else {
    for (const l of ls) {
      if (!isInt(l.amount) || n(l.amount) <= 0) { error = `${lineLabel(l)}の金額を入れてください。`; break; }
      if (l.kind === LINE_BUY && !l.category) { error = '仕入れの科目を選んでください。'; break; }
      if (l.kind === LINE_BUY && l.category === 'その他' && !String(l.note || '').trim()) { error = '仕入れ（その他）の内容を入れてください。'; break; }
      if (l.kind === LINE_STAFF && !String(l.name || '').trim()) { error = 'スタッフへの支払いの名前を入れてください。'; break; }
    }
    if (!error && diff !== 0) error = diff > 0 ? `内訳があと ${yen(diff)} 足りません。` : `内訳が ${yen(-diff)} 多いです。`;
  }
  return { sum, diff, ok: !error, error };
}

/** 出し入れの表示：「レジから出した：仕入れ（飲食物）・小口へ」「入金・オーナーの補充」「オーナーが回収（メモ）」 */
export function moveLabel(m) {
  if (m.type === MOVE_COLLECT) return 'オーナーが回収' + (m.note ? `（${m.note}）` : '');
  if (m.type === MOVE_OUT) return Array.isArray(m.lines) ? 'レジから出した：' + moveLines(m).map(lineLabel).join('・') : `出金・${purchaseLabel(m.category, m.note)}`;
  if (m.type === MOVE_PETTY_PAY) return '小口から払う：' + moveLines(m).map(lineLabel).join('・');
  if (m.type === MOVE_PETTY_BACK) return '小口からレジに戻す';
  return `入金・${m.reason || ''}`;
}

export function purchaseLabel(category, note) {
  return category === 'その他' ? `その他（${note || ''}）` : String(category || '');
}

/** 出し入れの入力の確認。問題がなければ空文字 */
export function validateMove({ type, amount, category, note }) {
  if (!isInt(amount) || Number(amount) <= 0) return '金額を入れてください。';
  if (type === MOVE_COLLECT) return ''; // 回収は金額だけ（メモは任意）
  if (type === MOVE_OUT && !category) return '科目を選んでください。';
  if (type === MOVE_OUT && category === 'その他' && !String(note || '').trim()) return 'その他の内容を入れてください。';
  return '';
}

/**
 * その日のレジ
 * - 開店時の現金：その日に手で入れた値があればそれ。なければ前の締めの「数えた現金」に、
 *   その締めのあとの出し入れ（閉店後や休みの日の補充など）を足したもの。前の締めがなければ「まだない」
 * - 入金・出金：その日の出し入れ。閉店したあとに入れた分は次の営業日に回す（until を渡したとき）
 * @param {{day: string, closings: object[], moves: object[], dayRow?: object, cashSales: number, until?: string}} p
 */
export function registerCalc({ day, closings, moves, dayRow, cashSales, until }) {
  const act = active(moves);
  let openCash = null, openFrom = 'none', carried = [];
  if (dayRow && dayRow.openCash !== '' && dayRow.openCash != null) {
    openCash = n(dayRow.openCash);
    openFrom = 'manual';
  } else {
    const prev = (closings || []).filter(c => c.bizDate < day && c.countedCash !== '' && c.countedCash != null)
      .sort((a, b) => b.bizDate.localeCompare(a.bizDate))[0];
    if (prev) {
      const after = act.filter(m => (m.bizDate > prev.bizDate && m.bizDate < day) || (m.bizDate === prev.bizDate && String(m.at) > String(prev.closedAt)));
      carried = after; // 前の締めのあとに入れた分（閉店後・休みの日の入金・回収など）。開店時の現金に入っている
      openCash = n(prev.countedCash) + after.reduce((a, m) => a + registerEffect(m), 0);
      openFrom = 'carry';
    }
  }
  const today = act.filter(m => m.bizDate === day && (!until || String(m.at) <= String(until)));
  const cashIn = today.filter(m => m.type === MOVE_IN || m.type === MOVE_PETTY_BACK).reduce((a, m) => a + n(m.amount), 0);
  const cashOut = today.filter(m => m.type === MOVE_OUT).reduce((a, m) => a - registerEffect(m), 0); // 出した額 − レジに戻した分
  const collected = today.filter(m => m.type === MOVE_COLLECT).reduce((a, m) => a + n(m.amount), 0);
  return { openCash, openFrom, carried, cashIn, cashOut, collected, expected: n(openCash) + n(cashSales) + cashIn - cashOut - collected };
}

/** 締めたあとに会計が変わったか */
export function closingIsStale(closing, summary) {
  if (!closing) return false;
  return n(closing.sales) !== summary.sales || n(closing.cash) !== summary.cash || n(closing.groups) !== summary.groups || n(closing.guests) !== summary.guests;
}

// ===== 勤怠 =====
export const ATT_FIXED = '固定';
export const ATT_OTHER = '手打ち';

/** 6.5 → 6時間30分 */
export function fmtHours(h) {
  const v = Number(h) || 0;
  return `${Math.floor(v)}時間` + (v % 1 ? '30分' : '');
}

/** 人件費：固定のスタッフは 勤務時間×時給＋（押した日だけ）交通費、ほかは手打ちの金額 */
export function attendanceCost(a) {
  return a.kind === ATT_OTHER ? n(a.amount) : Math.round(n(a.hours) * n(a.wage)) + n(a.transport);
}

/** 月の勤怠の集計：固定のスタッフは1人ずつ、ほかは1つにまとめる（スプシの月次と同じ分け方） */
export function attendanceSummary(rows) {
  const live = rows.filter(r => r.status !== ST_DEL);
  const fixed = new Map();
  for (const r of live.filter(x => x.kind !== ATT_OTHER)) {
    const k = r.staffId || r.name;
    const s = fixed.get(k) || { name: r.name, days: 0, hours: 0, transport: 0, transportDays: 0, cost: 0 };
    s.days += 1; s.hours += n(r.hours); s.transport += n(r.transport); s.transportDays += n(r.transport) ? 1 : 0; s.cost += attendanceCost(r);
    fixed.set(k, s);
  }
  const others = live.filter(x => x.kind === ATT_OTHER);
  return {
    fixed: [...fixed.values()],
    others: { count: others.length, names: [...new Set(others.map(o => o.name))], cost: others.reduce((a, o) => a + attendanceCost(o), 0) },
    total: live.reduce((a, r) => a + attendanceCost(r), 0)
  };
}

// ===== 仕入れ =====
export const PURCHASE_CATS = ['飲食物', '備品', 'その他'];

export function validatePurchase({ amount, category, note }) {
  if (!isInt(amount) || Number(amount) <= 0) return '金額を入れてください。';
  if (!PURCHASE_CATS.includes(category)) return '科目を選んでください。';
  if (category === 'その他' && !String(note || '').trim()) return 'その他の内容を入れてください。';
  return '';
}

export function purchaseSummary(rows) {
  const live = rows.filter(r => r.status !== ST_DEL);
  const by = Object.fromEntries(PURCHASE_CATS.map(c => [c, { count: 0, amount: 0, notes: [] }]));
  for (const r of live) {
    const c = by[r.category] ? r.category : 'その他';
    by[c].count += 1; by[c].amount += n(r.amount);
    if (c === 'その他' && r.note && !by[c].notes.includes(r.note)) by[c].notes.push(r.note);
  }
  return { by, total: live.reduce((a, r) => a + n(r.amount), 0) };
}
