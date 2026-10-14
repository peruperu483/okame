// 今日（ダッシュボード）。順番5で、雛形どおりに作る（売上・来客・店内・支払い方法・種類・精算済みの組・レジの出し入れ・閉店）
import { h, yen } from '../util.js';
import { daySummary } from '../calc.js';

export function renderToday(root, app) {
  const box = h('div', { class: 'empty' });
  root.append(h('section', { class: 'page' }, h('h1', { class: 'page-title' }, '今日'), box));
  const paint = async () => {
    const sum = daySummary(await app.store.listRows('visits', app.bizDate(), app.bizDate()), app.settings);
    box.replaceChildren(
      h('p', {}, `今日の売上（精算済み）${yen(sum.sales)}・${sum.groups}組・${sum.guests}名`),
      h('p', {}, `いま店内 ${sum.inStore}組・${sum.inStorePeople}名（見込み ${yen(sum.expected)}）`),
      h('p', { class: 'help' }, 'この画面は順番5で、雛形どおりに作ります。'),
      h('button', { class: 'btn', onclick: () => app.go('store') }, '店内を見る'));
  };
  const off = app.sync.onChange(t => { if (t === 'visits') paint(); });
  paint();
  return off;
}
