// 店長の暗証番号を入れる画面。照合はGAS。通ると店長モードになり、画面が作り直される
import { h } from '../util.js';

export function renderPinGate(root, app, title = '店長の暗証番号', note = '店長の暗証番号を入れてください。') {
  let pin = '';
  let busy = false;
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'pin-msg' }, note);
  const paint = () => dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));

  async function submit() {
    if (busy || pin.length < 4) return;
    busy = true;
    msg.textContent = '確かめています…';
    try {
      await app.auth.login(pin); // 成功すると画面が作り直される
    } catch (e) {
      msg.textContent = e.code === 'wrong_pin' || e.code === 'locked' ? e.message : app.errorText(e) + '（設定はつながっているときだけ開けます）';
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
  root.append(h('section', { class: 'page pin-page' },
    h('h1', { class: 'page-title' }, title),
    msg, dots,
    h('div', { class: 'pinpad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '消す', '0', 'OK'].map(k =>
      h('button', { class: 'pin-key' + (k === 'OK' ? ' ok' : k === '消す' ? ' sub' : ''), onclick: () => press(k) }, k)))));
}
