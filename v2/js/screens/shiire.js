// 仕入れ（その他の中・店長だけ）。手打ち。科目は 飲食物／備品／その他（内容）
// - その他は内容が必須で「その他（花）」のように残す。店名は空でもよい
// - スプシの月次：科目ごとに行を分ける
// - 「レジから」の行は、今日の画面のレジの出し入れ（出金）から自動で入ったもの。ここでは直さない
// - レシートの読み取りは、あとでこの画面に足す
import { h, put, toast, uuid, yen } from '../util.js';
import { ST_DEL, PURCHASE_CATS, validatePurchase, purchaseSummary, purchaseLabel } from '../calc.js';
import { pickReason } from '../ui.js';
import { fmtMD, monthNav, monthRange, msgBox, subHead } from './common.js';

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const KEYS = ['date', 'category', 'note', 'label', 'shop', 'amount'];

export function renderShiire(root, app) {
  const today = app.bizDate();
  const blank = (date = today) => ({ date, category: '飲食物', note: '', shop: '', amount: '' });
  const st = { month: today.slice(0, 7), rows: [], f: blank(), editId: null, msg: '', bad: false };
  const headBox = h('div');
  const form = h('section', { class: 'dcard' });
  const right = h('div', { class: 'col-gap' });
  root.append(h('section', { class: 'page wide' }, headBox, h('div', { class: 'two-col' }, form, right)));

  function paint() {
    put(headBox, subHead('仕入れ', null, monthNav(st.month, m => { st.month = m; load(); })));
    paintForm();
    paintRight();
  }

  function paintForm() {
    const f = st.f;
    put(form,
      h('h3', {}, st.editId ? '記録を直す' : '仕入れを入れる'),
      h('label', { class: 'lab', for: 'shDate' }, '日付'),
      h('input', { id: 'shDate', class: 'input', type: 'date', value: f.date, oninput: e => { f.date = e.target.value; } }),
      h('div', { class: 'lab' }, '科目'),
      h('div', { class: 'grid3' }, PURCHASE_CATS.map(c => h('button', { class: 'btn pick' + (f.category === c ? ' on' : ''), onclick: () => { f.category = c; st.msg = ''; paintForm(); } }, c))),
      f.category === 'その他' ? [h('label', { class: 'lab', for: 'shNote' }, 'その他の内容（かっこの中に入ります）'),
        h('input', { id: 'shNote', class: 'input', type: 'text', placeholder: '例：花・修理代', value: f.note, oninput: e => { f.note = e.target.value; } })] : null,
      h('label', { class: 'lab', for: 'shShop' }, '店名（空でもよい）'),
      h('input', { id: 'shShop', class: 'input', type: 'text', placeholder: '例：酒屋・業務スーパー', value: f.shop, oninput: e => { f.shop = e.target.value; } }),
      h('label', { class: 'lab', for: 'shAmt' }, '金額'),
      h('input', { id: 'shAmt', class: 'input input-big', type: 'number', inputmode: 'numeric', placeholder: '例：12000', value: f.amount, oninput: e => { f.amount = e.target.value; } }),
      msgBox(st.msg, st.bad),
      h('button', { class: 'btn btn-primary btn-save', onclick: save }, st.editId ? '直した内容で保存' : '保存する'),
      st.editId ? h('button', { class: 'btn', onclick: () => { st.editId = null; st.f = blank(); st.msg = ''; paintForm(); } }, '直すのをやめる') : null,
      h('div', { class: 'small muted2' }, 'レシートの写真の読み取りは、あとでこの画面に足します。'));
  }

  async function save() {
    const f = st.f;
    const err = !f.date ? '日付を選んでください。' : validatePurchase(f);
    if (err) { Object.assign(st, { msg: err, bad: true }); return paintForm(); }
    const note = f.category === 'その他' ? f.note.trim() : '';
    const data = { date: f.date, category: f.category, note, label: purchaseLabel(f.category, note), shop: f.shop.trim(), amount: Number(f.amount), paidFrom: '', source: '手入力', status: '有効' };
    const label = `${data.label} ${yen(data.amount)}`;
    if (st.editId) {
      const before = st.rows.find(r => r.id === st.editId) || {};
      await app.sync.save('purchases', st.editId, { ...data, edited: true }, { log: { type: '仕入れを直す', reason: '', before: pick(before, KEYS), after: pick(data, KEYS) } });
      Object.assign(st, { editId: null, msg: `直しました：${label}（修正前は履歴に残ります）`, bad: false });
    } else {
      await app.sync.save('purchases', uuid(), data);
      Object.assign(st, { msg: `保存しました：${label}`, bad: false });
    }
    st.f = blank(f.date);
    if (f.date.slice(0, 7) !== st.month) { st.month = f.date.slice(0, 7); load(); }
    paint(); // 保存で描き直したあとに変えたお知らせと入力を出す
  }

  function paintRight() {
    const live = st.rows.filter(r => r.status !== ST_DEL);
    const sum = purchaseSummary(live);
    put(right,
      h('section', { class: 'dcard' },
        h('div', { class: 'row-between' }, h('h3', {}, '今月の集計'), h('span', {}, h('span', { class: 'small muted2' }, '合計 '), h('b', { class: 'num big22' }, yen(sum.total)))),
        h('div', { class: 'grid3' }, PURCHASE_CATS.map(c => h('div', { class: 'tile' },
          h('b', {}, c), h('span', { class: 'sheet-badge' }, `スプシ：${c}の行`),
          h('div', { class: 'small muted2' }, `${sum.by[c].count}件` + (sum.by[c].notes.length ? `（${sum.by[c].notes.join('・')}）` : '')),
          h('b', { class: 'num big20' }, yen(sum.by[c].amount)))))),
      h('section', { class: 'dcard' },
        h('h3', {}, '記録（新しい順）'),
        live.length ? live.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).map(r => {
          const fromRegister = r.paidFrom === 'レジから' || r.paidFrom === '小口から'; // レジの出し入れ（出金の内訳・小口から払う）から自動で入った分
          return h('div', { class: 'rec-row' + (st.editId === r.id ? ' editing' : '') },
            h('span', { class: 'rec-date' }, fmtMD(r.date)),
            h('b', { class: 'rec-cat' }, r.label || purchaseLabel(r.category, r.note)),
            h('span', { class: 'rec-shop small grow' }, r.shop || '', fromRegister ? h('span', { class: 'sheet-badge' }, r.paidFrom) : null),
            h('b', { class: 'num rec-amt' }, yen(r.amount)),
            r.edited ? h('span', { class: 'badge' }, '修正あり') : null,
            fromRegister ? h('span', { class: 'small muted2 rec-hint' }, '今日の画面で直す') : [
              h('button', { class: 'btn btn-xs', onclick: () => edit(r) }, '直す'),
              h('button', { class: 'btn btn-xs danger', onclick: () => remove(r) }, '消す')]);
        }) : h('div', { class: 'muted2 pad' }, 'この月の記録はまだありません。'),
        h('div', { class: 'small muted2' }, '直した・消した記録は、修正前の内容と一緒に操作履歴に残ります。「レジから」はレジの出し入れ（出金）から自動で入ったもので、今日の画面で直します。')));
  }

  function edit(r) {
    st.editId = r.id;
    st.f = { date: r.date, category: PURCHASE_CATS.includes(r.category) ? r.category : 'その他', note: r.note || '', shop: r.shop || '', amount: String(r.amount ?? '') };
    st.msg = '';
    paint();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(r) {
    const reason = await pickReason(`${fmtMD(r.date)} ${r.label} ${yen(r.amount)} を消す`, ['打ち間違い', '二重に入れた', '返品', 'その他'], '消しても、修正前の内容は操作履歴に残ります。');
    if (!reason) return;
    if (st.editId === r.id) { st.editId = null; st.f = blank(); }
    await app.sync.save('purchases', r.id, { status: ST_DEL }, { log: { type: '仕入れを消す', reason, before: pick(r, KEYS) } });
    toast('消しました（履歴には残ります）');
  }

  async function reload() {
    const [from, to] = monthRange(st.month);
    st.rows = await app.store.listRows('purchases', from, to);
    paint();
  }
  function load() {
    const [from, to] = monthRange(st.month);
    reload();
    app.sync.pull('purchases', from, to).catch(() => {});
  }
  const off = app.sync.onChange(t => { if (t === 'purchases') reload(); });
  load();
  return off;
}
