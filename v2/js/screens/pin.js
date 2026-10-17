// 店長の暗証番号を入れる数字の画面（キーボードは出さない）。照合はGAS。
// - renderPinGate：鍵つきの画面（分析・その他）の代わりに出す。通ると画面が作り直され、その画面が開く
// - openPinSheet：どの画面からでも重ねて出す（上の「店長モード」のボタンや、暗証番号が必要な操作）。通ると true
import { h } from '../util.js';
import { openSheet } from '../ui.js';

/** 数字のボタンと点。通ったら onDone() */
function pinPad(app, { note, quiet, onDone }) {
  let pin = '';
  let busy = false;
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'pin-msg' }, note);
  const paint = () => dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));

  async function submit() {
    if (busy || pin.length < 4) return;
    busy = true;
    msg.textContent = '確かめています…';
    msg.classList.remove('err');
    try {
      await app.auth.login(pin, { quiet });
      onDone?.();
    } catch (e) {
      msg.textContent = e.code === 'wrong_pin' || e.code === 'locked' ? e.message : app.errorText(e) + '（店長モードは、つながっているときだけ入れます）';
      msg.classList.add('err');
      pin = '';
      paint();
    } finally {
      busy = false;
    }
  }

  const press = k => {
    if (k === '消す') pin = pin.slice(0, -1);
    else if (k === 'OK') return submit();
    else if (pin.length < 8) pin += k;
    paint();
  };
  paint();
  return [msg, dots,
    h('div', { class: 'pinpad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '消す', '0', 'OK'].map(k =>
      h('button', { type: 'button', class: 'pin-key' + (k === 'OK' ? ' ok' : k === '消す' ? ' sub' : ''), 'aria-label': k, onclick: () => press(k) }, k)))];
}

export function renderPinGate(root, app, title = '店長の暗証番号', note = '店長の暗証番号を入れてください。') {
  root.append(h('section', { class: 'page pin-page' },
    h('h1', { class: 'page-title' }, title),
    pinPad(app, { note, quiet: false }))); // 通ると画面が作り直される
}

/**
 * 暗証番号の数字の画面を重ねて出す。入れたら true、やめたら false。
 * quiet=true（初期値）：入っても今の画面を作り直さないので、押した操作の続きがそのままできる
 */
export function openPinSheet(app, { title = '店長モードに入る', note = '店長の暗証番号を押してください。', quiet = true } = {}) {
  return new Promise(resolve => {
    let ok = false;
    openSheet(c => [
      h('h2', { class: 'pin-title' }, title),
      h('div', { class: 'pin-sheet' }, pinPad(app, { note, quiet, onDone: () => { ok = true; c(); } })),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: c }, 'やめる'))
    ], { onClose: () => resolve(ok) });
  });
}
