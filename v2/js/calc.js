// 来客・会計の計算（画面から切り離して、テストできるようにしておく）
import { minutesLeft } from './bizday.js';

export const PLAN_NOMI = '飲み放題';
export const PLAN_SINGLE = '単品';
export const PAYS = ['現金', 'キャッシュレス', 'ポイント'];
export const KINDS = ['通常', '団体'];
export const ST_IN = '店内';
export const ST_PAID = '会計済';
export const ST_DEL = '削除';

const n = v => Number(v) || 0;

/** 名前が空のときに出す当日の通し番号（削除した組も数えて、番号を使い回さない） */
export function nextNo(allVisitsOfDay) {
  return allVisitsOfDay.reduce((m, v) => Math.max(m, n(v.no)), 0) + 1;
}

export function label(v) {
  return v.name ? v.name : `${v.no}番`;
}

/** 飲み放題の時間（延長を足した合計・分） */
export function totalMinutes(v, s) {
  return n(s.nomiMinutes) + (v.extensions || []).reduce((a, e) => a + n(e.minutes), 0);
}

/**
 * 時間の状態
 * - single：単品（経過時間だけ）
 * - ok：まだ余裕がある / lo：ラストオーダー / over：時間超過
 */
export function timeState(v, s, now = new Date()) {
  if (v.plan !== PLAN_NOMI) return { kind: 'single', elapsed: Math.max(0, Math.floor((now.getTime() - Date.parse(v.inAt)) / 60e3)) };
  const left = minutesLeft(v.inAt, totalMinutes(v, s), now);
  const kind = left < 0 ? 'over' : left <= n(s.lastOrderMinutes) ? 'lo' : 'ok';
  return { kind, left };
}

/** 分 → 1:05 */
export function fmtMin(m) {
  const a = Math.abs(Math.trunc(m));
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/** 会計の金額の初期値。飲み放題は 人数×(料金＋延長の料金)。単品はなし（毎回手入力） */
export function defaultAmount(v, s) {
  if (v.plan !== PLAN_NOMI) return null;
  const ext = (v.extensions || []).reduce((a, e) => a + n(e.price), 0);
  return n(v.people) * (n(s.nomiPrice) + ext);
}

/** 会計できる金額か（0円・未入力・小数はだめ） */
export function validAmount(x) {
  return x !== '' && x != null && Number.isInteger(Number(x)) && Number(x) > 0;
}

/** その日の合計（会計済みだけ）。ポイントを売上に含めない設定なら、売上と通常・団体から外す */
export function daySummary(visits, s) {
  const paid = visits.filter(v => v.status === ST_PAID);
  const inStore = visits.filter(v => v.status === ST_IN);
  const counted = v => s.pointCountsAsSales !== false || v.pay !== 'ポイント';
  const sum = f => paid.filter(f).reduce((a, v) => a + n(v.amount), 0);
  return {
    sales: sum(counted),
    cash: sum(v => v.pay === '現金'),
    cashless: sum(v => v.pay === 'キャッシュレス'),
    point: sum(v => v.pay === 'ポイント'),
    normal: sum(v => counted(v) && v.kind !== '団体'),
    group: sum(v => counted(v) && v.kind === '団体'),
    guests: paid.reduce((a, v) => a + n(v.people), 0),
    groups: paid.length,
    inStore: inStore.length,
    inStorePeople: inStore.reduce((a, v) => a + n(v.people), 0)
  };
}

/** レジの差額 = レジの現金 − 釣り銭の準備金 − 現金の売上（プラスは多い、マイナスは足りない） */
export function cashDiff(drawerCash, changeFloat, cashSales) {
  return n(drawerCash) - n(changeFloat) - n(cashSales);
}

/** 締めたあとに会計が変わったか */
export function closingIsStale(closing, summary) {
  if (!closing) return false;
  return n(closing.sales) !== summary.sales || n(closing.cash) !== summary.cash || n(closing.groups) !== summary.groups || n(closing.guests) !== summary.guests;
}
