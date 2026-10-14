// 画面づくりの小物
export const $ = (sel, root = document) => root.querySelector(sel);

/** h('button', {class:'btn', onclick}, '保存') のように要素を作る */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 中身を入れ替える。null・false・空文字・入れ子の配列は気にせず渡してよい */
export function put(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false && c !== ''));
}

export const yen = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

/** 小さな購読の仕組み */
export function emitter() {
  const subs = new Set();
  return { on: fn => (subs.add(fn), () => subs.delete(fn)), emit: v => subs.forEach(fn => fn(v)) };
}
