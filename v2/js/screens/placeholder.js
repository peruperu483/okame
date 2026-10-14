import { h } from '../util.js';

export function renderPlaceholder(root, title, when) {
  root.append(h('section', { class: 'page' },
    h('h1', { class: 'page-title' }, title),
    h('div', { class: 'empty' }, h('p', {}, 'この画面はまだありません。'), h('p', {}, when))));
}
