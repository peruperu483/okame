// その他（店長だけ）：勤怠／仕入れ／固定費／設定
import { h } from '../util.js';
import { renderSettings } from './settings.js';
import { renderKintai } from './kintai.js';
import { renderShiire } from './shiire.js';
import { renderKotei } from './kotei.js';

const ITEMS = [
  { id: 'kintai', title: '勤怠', desc: '店長があとで勤務時間を入力。時給×時間で人件費を出す', render: renderKintai },
  { id: 'shiire', title: '仕入れ', desc: '科目（飲食物・備品・その他）と金額を手打ち。レシートの読み取りはあとで', render: renderShiire },
  { id: 'kotei', title: '固定費', desc: '家賃・光熱・カラオケを月1回', render: renderKotei },
  { id: 'settings', title: '設定', desc: '料金・時間・時給・目標・見せる範囲・暗証番号' }
];

export function renderMore(root, app, sub) {
  const item = ITEMS.find(x => x.id === sub);
  if (!item) {
    app.setTitle('その他');
    root.append(h('section', { class: 'page' },
      h('h1', { class: 'page-title' }, 'その他（店長のみ）'),
      h('div', { class: 'more-grid' }, ITEMS.map(x =>
        h('button', { class: 'more-item', onclick: () => { location.hash = 'more/' + x.id; } },
          h('span', { class: 'more-title' }, x.title),
          h('span', { class: 'more-desc' }, x.desc))))));
    return;
  }
  app.setTitle(item.title);
  if (item.render) return item.render(root, app);
  root.append(h('div', { class: 'subhead' },
    h('button', { class: 'btn btn-sm', onclick: () => { location.hash = 'more'; } }, '‹ その他')));
  return renderSettings(root, app);
}
