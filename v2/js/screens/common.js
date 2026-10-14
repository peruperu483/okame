// 予定・勤怠・仕入れ・固定費・分析で使い回す小物
import { h } from '../util.js';
import { dowOf } from '../bizday.js';

/** 2026-11-05 → 11/5（木） */
export const fmtMD = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}（${dowOf(ymd)}）`;

/** 2026-11 → 2026年11月 */
export const monthLabel = m => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;

export function addMonths(m, k) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1 + k, 1)).toISOString().slice(0, 7);
}

/** 月の初日と末日（YYYY-MM-DD） */
export function monthRange(m) {
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}

/** ‹ 2026年11月 › */
export function monthNav(month, onChange, { max } = {}) {
  return h('div', { class: 'month-nav' },
    h('button', { class: 'btn btn-sm', 'aria-label': '前の月', onclick: () => onChange(addMonths(month, -1)) }, '‹'),
    h('span', { class: 'month-label' }, monthLabel(month)),
    h('button', { class: 'btn btn-sm', 'aria-label': '次の月', disabled: !!max && month >= max, onclick: () => onChange(addMonths(month, 1)) }, '›'));
}

/** 戻るボタンつきの見出し */
export function subHead(title, sub, extra) {
  return h('div', { class: 'sub-head' },
    h('button', { class: 'btn btn-sm', onclick: () => { location.hash = 'more'; } }, '‹ その他'),
    h('h2', {}, title), sub ? h('span', { class: 'muted2' }, sub) : null, h('span', { class: 'grow' }), extra || null);
}

/** お知らせ（緑・赤） */
export const msgBox = (text, bad) => (text ? h('div', { class: 'pay-msg ' + (bad ? 'bad' : 'good'), role: 'status' }, text) : null);
