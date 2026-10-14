// 固定費（その他の中・店長だけ）。家賃・ガス・電気・カラオケなどを月1回入れる
// - 項目は設定の「固定費の項目」。1か月・1項目で1行（ID＝月|項目）
// - 先月の金額を目安に出し、「先月と同じにする」で空の欄に入れられる
import { h, put, toast, yen } from '../util.js';
import { ST_DEL } from '../calc.js';
import { addMonths, monthLabel, monthNav, msgBox, subHead } from './common.js';

export function renderKotei(root, app) {
  const today = app.bizDate();
  const st = { month: today.slice(0, 7), rows: [], prev: [], draft: {}, msg: '', bad: false };
  const headBox = h('div');
  const box = h('section', { class: 'dcard kotei' });
  root.append(h('section', { class: 'page' }, headBox, box));

  const items = () => app.settings.fixedCostItems || [];
  const valueOf = (rows, item) => { const r = rows.find(x => x.item === item && x.status !== ST_DEL); return r ? Number(r.amount) : null; };

  function paint() {
    put(headBox, subHead('固定費', null, monthNav(st.month, m => { st.month = m; load(); })));
    const total = items().reduce((a, it) => a + (Number(st.draft[it]) || 0), 0);
    put(box,
      h('div', { class: 'row-between' }, h('h3', {}, `${monthLabel(st.month)}の固定費`),
        h('button', {
          class: 'btn btn-sm', onclick: () => {
            for (const it of items()) if ((st.draft[it] ?? '') === '' && valueOf(st.prev, it) != null) st.draft[it] = String(valueOf(st.prev, it));
            paint();
          }
        }, '先月と同じにする')),
      items().map(it => {
        const prev = valueOf(st.prev, it);
        return h('div', { class: 'kotei-row' },
          h('span', { class: 'kotei-item' }, it),
          h('input', {
            class: 'input num', type: 'number', inputmode: 'numeric', value: st.draft[it] ?? '', placeholder: prev != null ? `先月 ${yen(prev)}` : '金額',
            oninput: e => { st.draft[it] = e.target.value; totalEl.textContent = yen(items().reduce((a, x) => a + (Number(st.draft[x]) || 0), 0)); }
          }),
          st.rows.find(x => x.item === it && x.edited && x.status !== ST_DEL) ? h('span', { class: 'badge' }, '修正あり') : null);
      }),
      h('div', { class: 'calc-line' }, h('span', { class: 'small' }, '合計'), (totalEl = h('b', { class: 'num big22' }, yen(total)))),
      msgBox(st.msg, st.bad),
      h('button', { class: 'btn btn-primary btn-save', onclick: save }, '保存する'),
      h('div', { class: 'small muted2' }, '項目は「設定 → 選ぶ項目 → 固定費の項目」で増やしたり減らしたりできます。直した・消した金額は操作履歴に残ります。'));
  }
  let totalEl = null;

  async function save() {
    // 1つ保存するたびに画面が読み直されて入力が戻るので、先に入力と今の記録を写しておく
    const draft = { ...st.draft };
    const rows = st.rows.slice();
    const month = st.month;
    for (const it of items()) {
      const raw = String(draft[it] ?? '');
      const amount = Number(raw);
      if (raw !== '' && (!Number.isInteger(amount) || amount < 0)) { Object.assign(st, { msg: `「${it}」の金額を直してください。`, bad: true }); return paint(); }
    }
    let changed = 0;
    for (const it of items()) {
      const raw = String(draft[it] ?? '');
      const cur = rows.find(x => x.item === it && x.status !== ST_DEL);
      const id = `${month}|${it}`;
      if (raw === '') {
        if (cur) { await app.sync.save('fixedCosts', id, { status: ST_DEL }, { log: { type: '固定費を消す', reason: '', before: { month, item: it, amount: cur.amount } } }); changed++; }
        continue;
      }
      const amount = Number(raw);
      if (cur && Number(cur.amount) === amount) continue;
      await app.sync.save('fixedCosts', id, { month, item: it, amount, status: '有効', ...(cur ? { edited: true } : {}) },
        cur ? { log: { type: '固定費を直す', reason: '', before: { amount: cur.amount }, after: { amount } } } : {});
      changed++;
    }
    Object.assign(st, { msg: changed ? `${monthLabel(month)}の固定費を保存しました` : '変わったところはありません', bad: false });
    toast(st.msg);
    paint();
  }

  async function reload() {
    st.rows = await app.store.listRows('fixedCosts', st.month, st.month);
    st.prev = await app.store.listRows('fixedCosts', addMonths(st.month, -1), addMonths(st.month, -1));
    st.draft = Object.fromEntries(items().map(it => [it, valueOf(st.rows, it) != null ? String(valueOf(st.rows, it)) : '']));
    paint();
  }
  function load() {
    st.msg = '';
    reload();
    Promise.all([app.sync.pull('fixedCosts', st.month, st.month), app.sync.pull('fixedCosts', addMonths(st.month, -1), addMonths(st.month, -1))]).catch(() => {});
  }
  const off = app.sync.onChange(t => { if (t === 'fixedCosts') reload(); });
  load();
  return off;
}
