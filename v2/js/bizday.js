// 日付と営業日。端末のタイムゾーンに関係なく日本時間で数える。
const JST_MS = 9 * 3600e3;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/** その時刻が属する営業日（YYYY-MM-DD）。cutoffHour時より前は前日の営業日 */
export function bizDateOf(date = new Date(), cutoffHour = 12) {
  return new Date(date.getTime() + JST_MS - cutoffHour * 3600e3).toISOString().slice(0, 10);
}

/** 日本時間のISO文字列（例 2026-11-01T19:05:00+09:00） */
export function nowIso(date = new Date()) {
  return new Date(date.getTime() + JST_MS).toISOString().slice(0, 19) + '+09:00';
}

export function dowOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 2026-11-01 → 11/1(日) */
export function fmtDay(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}(${dowOf(ymd)})`;
}

/** ISO → 19:05（日本時間） */
export function fmtTime(iso) {
  const t = new Date(Date.parse(iso) + JST_MS).toISOString();
  return String(Number(t.slice(11, 13))) + ':' + t.slice(14, 16);
}

/** 運用開始日より前の営業日は試運転 */
export function isTrial(bizDate, goLiveDate) {
  return !!goLiveDate && bizDate < goLiveDate;
}

/** 入店から数えた残り分（マイナスは超過） */
export function minutesLeft(inAtIso, totalMinutes, now = new Date()) {
  return Math.floor((Date.parse(inAtIso) + totalMinutes * 60e3 - now.getTime()) / 60e3);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO → 19:05（日本時間・2けた） */
export function fmtHM(iso) {
  return new Date(Date.parse(iso) + JST_MS).toISOString().slice(11, 16);
}

/**
 * 時刻（HH:MM）を、その営業日の日時（ISO）にする。切り替え時刻より前の時刻は翌日の日付
 * 例：営業日 11/1・切り替え12時 → 21:30 は 11/1 21:30、0:30 は 11/2 0:30
 */
export function timeOnBizDay(bizDate, hhmm, cutoffHour = 12) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const date = hour < cutoffHour ? addDays(bizDate, 1) : bizDate;
  return `${date}T${String(hour).padStart(2, '0')}:${m[2]}:00+09:00`;
}
