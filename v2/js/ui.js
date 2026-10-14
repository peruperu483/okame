// 画面で使い回す部品：下から出るパネル・切り替えボタン・理由を選ぶ・人数の増減
import { h } from './util.js';

/** パネルを開く。build(close) が中身を返す。戻り値は close。外側を押しても閉じる */
export function openSheet(build, { wide = false, onClose } = {}) {
  const sheet = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const overlay = h('div', { class: 'overlay' }, sheet);
  let closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); onClose?.(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  sheet.append(...[build(close)].flat(Infinity).filter(Boolean));
  document.body.append(overlay);
  return close;
}

/** 切り替えボタン（どれか1つ）。el.value() で今の値 */
export function seg(options, value, onChange, { size = '' } = {}) {
  let cur = value;
  const el = h('div', { class: 'seg ' + size, role: 'radiogroup' });
  const paint = () => el.querySelectorAll('button').forEach(b => {
    const on = b.dataset.v === cur;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  for (const o of options) {
    el.append(h('button', { type: 'button', role: 'radio', 'data-v': o, onclick: () => { cur = o; paint(); onChange?.(o); } }, o));
  }
  paint();
  el.value = () => cur;
  el.set = v => { cur = v; paint(); };
  return el;
}

/** 理由を選ぶ。選ばれた理由（キャンセルなら null）を返す */
export function pickReason(title, reasons, note = '') {
  return new Promise(resolve => {
    let picked = null;
    openSheet(close => [
      h('h2', {}, title),
      note ? h('p', { class: 'help' }, note) : null,
      h('div', { class: 'reason-list' }, reasons.map(r =>
        h('button', { class: 'btn reason', onclick: () => { picked = r; close(); } }, r))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'やめる'))
    ], { onClose: () => resolve(picked) }); // 外側を押して閉じたときは null（やめる）
  });
}

/** 人数などの増減（−・数・＋） */
export function stepper(value, { min = 1, max = 99, onChange } = {}) {
  let cur = value;
  const num = h('span', { class: 'stepper-num' }, String(cur));
  const set = v => { cur = Math.max(min, Math.min(max, v)); num.textContent = String(cur); onChange?.(cur); };
  const el = h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'btn stepper-btn', 'aria-label': '減らす', onclick: () => set(cur - 1) }, '−'),
    num,
    h('button', { type: 'button', class: 'btn stepper-btn', 'aria-label': '増やす', onclick: () => set(cur + 1) }, '＋'));
  el.value = () => cur;
  return el;
}

/** 金額の入力（数字のキーボードを出す） */
export function amountInput(value, { onInput } = {}) {
  const el = h('input', {
    class: 'input amount', type: 'number', inputmode: 'numeric', min: 1, step: 1,
    value: value == null ? '' : String(value), placeholder: '金額', oninput: e => onInput?.(e.target.value)
  });
  return el;
}
