// 予定・勤怠・仕入れ・固定費・分析で使い回す小物
import { h, put, yen } from '../util.js';
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

/**
 * 月の売上の減算カウンター：あと ＝ 目標 − 確定した売上 − まだ来ていない日のイベントの見込み（計算はGAS）
 * 大きく「目標まで あと（見込み込み）」、その下に小さく「確定だけだと あと」。バーは2色（濃い＝確定、薄い＝見込み。合わせて見込み込みの達成率。100%で止める）。
 * 内訳として「目標・確定・見込み・あと」を並べる。つながっていないときは前回の表示を残す
 * @returns {{el: HTMLElement, refresh: (month?: string) => Promise<void>, schedule: () => void, destroy: () => void}}
 */
export function mountCountdown(app, month) {
  const box = h('section', { class: 'dcard countdown' });
  let cur = month, seq = 0, timer = null, shown = false;
  function paint(r) {
    shown = true;
    box.hidden = false;
    if (!r.hasTarget) {
      return put(box, h('div', { class: 'lab' }, `${monthLabel(r.month)}の売上目標`),
        h('div', { class: 'small muted2' }, '目標がまだ入っていません。店長が、予定の画面の月の上か、設定で入れると、「あと いくら」が出ます。'));
    }
    const left = r.remaining; // 見込みを入れた残り
    const firmLeft = r.target - r.confirmed; // 確定だけの残り
    const done = left <= 0;
    const cell = (k, v, cls = '') => h('div', { class: 'cd-cell ' + cls }, h('div', { class: 'cd-k' }, k), h('div', { class: 'cd-v num' }, yen(v)));
    const w = v => Math.max(0, Math.min(100, Math.round(v / r.target * 100)));
    const firmW = w(r.confirmed), planW = Math.min(w(r.expected), 100 - firmW); // 2つ合わせて100%で止める
    const pct = Math.round((r.confirmed + r.expected) / r.target * 100);
    put(box,
      h('div', { class: 'lab' }, `${monthLabel(r.month)}の売上目標`),
      h('div', { class: 'cd-big num' + (done ? ' ok' : '') },
        done ? `目標まで あと ${yen(0)}（${firmLeft <= 0 ? '達成' : '見込みで達成'}）` : `目標まで あと ${yen(left)}`),
      h('div', { class: 'cd-sub num' }, firmLeft <= 0 ? `確定だけで達成（＋${yen(-firmLeft)}）` : `確定だけだと あと ${yen(firmLeft)}`),
      h('div', { class: 'cd-cap num' }, `月の売上 ${yen(r.target)} の ${pct}%（見込み込み）`),
      h('div', { class: 'cd-bar', 'aria-hidden': 'true' },
        h('div', { class: 'cd-fill', style: { width: firmW + '%' } }),
        h('div', { class: 'cd-plan', style: { width: planW + '%' } })),
      h('div', { class: 'cd-grid' }, cell('目標', r.target), cell('確定', r.confirmed, 'firm'), cell('見込み（イベント）', r.expected, 'plan'), cell('あと', Math.max(0, left), 'rest')));
  }
  async function refresh(m = cur) {
    cur = m;
    const mine = ++seq;
    try {
      const r = await app.post('countdown', { month: m });
      if (mine === seq) paint(r);
    } catch (e) {
      if (mine !== seq) return;
      if (e.code === 'forbidden' || e.code === 'bad_action') { box.hidden = true; return; } // 見せない設定／古いGAS
      if (!shown) put(box, h('div', { class: 'small muted2' }, '月の売上目標までの残りは、つながると出ます。'));
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => refresh(), 3000); };
  box.hidden = true;
  return { el: box, refresh, schedule, destroy() { clearTimeout(timer); seq++; } };
}

/** 戻るボタンつきの見出し */
export function subHead(title, sub, extra) {
  return h('div', { class: 'sub-head' },
    h('button', { class: 'btn btn-sm', onclick: () => { location.hash = 'more'; } }, '‹ その他'),
    h('h2', {}, title), sub ? h('span', { class: 'muted2' }, sub) : null, h('span', { class: 'grow' }), extra || null);
}

/** お知らせ（緑・赤） */
/**
 * イベントの1人の単価：3,000円・4,000円・5,000円のボタン（設定 eventUnitPrices）と手打ちの欄。el.value() で今の値（未入力は ''）
 */
export function unitPicker(app, value, onChange, prices) {
  const opts = (prices || app.settings?.eventUnitPrices || [3000, 4000, 5000]).map(Number); // prices：常連の料金（設定 regularPrices）など
  let cur = value === '' || value == null ? '' : Number(value);
  const el = h('div', { class: 'unit-pick' });
  const inp = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', placeholder: 'ほかの単価（手打ち）', 'aria-label': '1人の単価（手打ち）',
    value: cur !== '' && !opts.includes(cur) ? String(cur) : '',
    oninput: e => { cur = e.target.value === '' ? '' : Number(e.target.value); el.querySelectorAll('.pick').forEach(b => b.classList.remove('on')); onChange?.(cur); }
  });
  const paint = () => put(el,
    h('div', { class: 'grid3' }, opts.map(o => h('button', {
      type: 'button', class: 'btn pick' + (cur === o ? ' on' : ''), onclick: () => { cur = o; inp.value = ''; paint(); onChange?.(cur); }
    }, yen(o)))),
    inp);
  paint();
  el.value = () => cur;
  return el;
}

export const msgBox = (text, bad) => (text ? h('div', { class: 'pay-msg ' + (bad ? 'bad' : 'good'), role: 'status' }, text) : null);
