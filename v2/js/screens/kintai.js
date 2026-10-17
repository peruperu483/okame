// 勤怠（その他の中・店長だけ）。店長があとで勤務時間を入れる
// - 固定のスタッフ：勤務時間（30分きざみ）×時給。交通費のある人は「交通費を足す」を押した日だけ足す（最初はオフ）
// - 固定以外：名前と金額を手打ち
// - スプシの月次：固定のスタッフは1人1行、固定以外は「人件費（その他）」の1行
import { h, put, toast, uuid, yen } from '../util.js';
import { ST_DEL, ATT_FIXED, ATT_OTHER, fmtHours, attendanceCost, attendanceSummary } from '../calc.js';
import { pickReason } from '../ui.js';
import { fmtMD, monthNav, monthRange, msgBox, subHead } from './common.js';

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const KEYS = ['bizDate', 'staffId', 'name', 'kind', 'hours', 'wage', 'transport', 'amount', 'cost'];

export function renderKintai(root, app) {
  const today = app.bizDate();
  // staffId：固定のスタッフのID／'other'＝その他（手打ち）／undefined＝まだ選んでいない（最初の人を選ぶ）
  const blank = () => ({ date: today, staffId: undefined, hours: 6, trans: false, name: '', amount: '' });
  const st = { month: today.slice(0, 7), rows: [], staff: [], f: blank(), editId: null, msg: '', bad: false, showAdd: false, ns: { name: '', wage: String(app.settings.defaultWage || ''), trans: '' } };
  const form = h('section', { class: 'dcard' });
  const right = h('div', { class: 'col-gap' });
  const headBox = h('div');
  root.append(h('section', { class: 'page wide' }, headBox, h('div', { class: 'two-col' }, form, right)));

  const cur = () => st.staff.find(s => s.id === st.f.staffId) || null;

  function paint() {
    put(headBox, subHead('勤怠', null, monthNav(st.month, m => { st.month = m; load(); })));
    paintForm();
    paintRight();
  }

  function paintForm() {
    const f = st.f;
    const s = cur();
    const isFixed = !!s;
    const staffBtns = [
      ...st.staff.map(x => h('button', { class: 'btn pick' + (f.staffId === x.id ? ' on' : ''), onclick: () => { f.staffId = x.id; st.msg = ''; paintForm(); } }, `${x.name}（固定）`)),
      h('button', { class: 'btn pick' + (!isFixed ? ' on' : ''), onclick: () => { f.staffId = 'other'; st.msg = ''; paintForm(); } }, 'その他（手打ち）')
    ];
    const cost = isFixed ? attendanceCost({ kind: ATT_FIXED, hours: f.hours, wage: s.wage, transport: f.trans ? s.transport : 0 }) : (Number(f.amount) || 0);
    put(form,
      h('h3', {}, st.editId ? '記録を直す' : '勤務時間を入れる'),
      h('label', { class: 'lab', for: 'ktDate' }, '営業日'),
      h('input', { id: 'ktDate', class: 'input', type: 'date', value: f.date, oninput: e => { f.date = e.target.value; } }),
      h('div', { class: 'lab' }, 'スタッフ'),
      h('div', { class: 'grid2' }, staffBtns),
      h('button', { class: 'btn btn-sm dashed', onclick: () => { st.showAdd = !st.showAdd; paintForm(); } }, st.showAdd ? '追加をやめる' : '＋ 固定のスタッフを追加'),
      st.showAdd ? addStaffForm() : null,
      isFixed ? [
        h('div', { class: 'lab' }, '勤務時間'),
        h('div', { class: 'stepper' },
          h('button', { class: 'btn stepper-btn', 'aria-label': '30分減らす', onclick: () => { f.hours = Math.max(0.5, f.hours - 0.5); paintForm(); } }, '−'),
          h('span', { class: 'stepper-num grow' }, fmtHours(f.hours)),
          h('button', { class: 'btn stepper-btn', 'aria-label': '30分増やす', onclick: () => { f.hours = Math.min(14, f.hours + 0.5); paintForm(); } }, '＋')),
        h('div', { class: 'grid4' }, [4, 5, 6, 7].map(x => h('button', { class: 'btn pick btn-xs' + (f.hours === x ? ' on' : ''), onclick: () => { f.hours = x; paintForm(); } }, x + '時間'))),
        Number(s.transport) > 0 ? h('button', {
          class: 'btn pick trans' + (f.trans ? ' on' : ''), 'aria-pressed': String(f.trans), onclick: () => { f.trans = !f.trans; paintForm(); }
        }, h('span', { class: 'tick' + (f.trans ? ' on' : '') }, '✓'), `交通費 ${yen(s.transport)} を足す` + (f.trans ? '' : '（今日は押していない）')) : null
      ] : [
        h('label', { class: 'lab', for: 'ktName' }, '名前（手打ち）'),
        h('input', { id: 'ktName', class: 'input', type: 'text', placeholder: '例：あいか', value: f.name, oninput: e => { f.name = e.target.value; } }),
        h('label', { class: 'lab', for: 'ktAmt' }, '金額（手打ち）'),
        h('input', { id: 'ktAmt', class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：8000', value: f.amount, oninput: e => { f.amount = e.target.value; calcEl.textContent = yen(Number(e.target.value) || 0); } })
      ],
      h('div', { class: 'calc-line' },
        h('span', { class: 'small' }, isFixed ? `${fmtHours(f.hours)} × ${yen(s.wage)}` + (f.trans ? ' ＋ 交通費' : '') : '手打ちの金額'),
        (calcEl = h('b', { class: 'num big22' }, yen(cost)))),
      msgBox(st.msg, st.bad),
      h('button', { class: 'btn btn-primary btn-save', onclick: save }, st.editId ? '直した内容で保存' : '保存する'),
      st.editId ? h('button', { class: 'btn', onclick: () => { st.editId = null; st.f = blank(); st.msg = ''; paintForm(); } }, '直すのをやめる') : null);
  }
  let calcEl = null;

  function addStaffForm() {
    const ns = st.ns;
    return h('div', { class: 'subform' },
      h('b', {}, '固定のスタッフを追加'),
      h('label', { class: 'lab' }, '名前'), h('input', { class: 'input', type: 'text', placeholder: '例：みか', value: ns.name, oninput: e => { ns.name = e.target.value; } }),
      h('label', { class: 'lab' }, '時給'), h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: ns.wage, oninput: e => { ns.wage = e.target.value; } }),
      h('label', { class: 'lab' }, '交通費（1日あたり。なければ空欄）'), h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：2000', value: ns.trans, oninput: e => { ns.trans = e.target.value; } }),
      h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const name = ns.name.trim(), wage = Number(ns.wage);
          if (!name || !(wage > 0)) { Object.assign(st, { msg: '名前と時給を入れてください', bad: true }); return paintForm(); }
          if (st.staff.some(x => x.name === name)) { Object.assign(st, { msg: '同じ名前の人がいます', bad: true }); return paintForm(); }
          const id = uuid();
          // 保存すると画面が描き直されるので、選ぶ人とお知らせは先に決めておく
          Object.assign(st, { showAdd: false, ns: { name: '', wage: String(app.settings.defaultWage || ''), trans: '' }, msg: `${name} を固定のスタッフに追加しました（スプシでは単独の行になります）`, bad: false });
          st.f.staffId = id;
          await app.sync.save('staff', id, { name, wage, transport: Number(ns.trans) || 0, active: true, order: st.staff.length + 1 });
        }
      }, '追加する'));
  }

  async function save() {
    const f = st.f, s = cur();
    if (!f.date) { Object.assign(st, { msg: '営業日を選んでください', bad: true }); return paintForm(); }
    let data;
    if (s) data = { bizDate: f.date, staffId: s.id, name: s.name, kind: ATT_FIXED, hours: f.hours, wage: Number(s.wage), transport: f.trans ? Number(s.transport) || 0 : 0, amount: null };
    else {
      const name = f.name.trim(), amount = Number(f.amount);
      if (!name || !(amount > 0)) { Object.assign(st, { msg: '名前と金額を入れてください', bad: true }); return paintForm(); }
      data = { bizDate: f.date, staffId: '', name, kind: ATT_OTHER, hours: null, wage: null, transport: 0, amount };
    }
    data.cost = attendanceCost(data);
    data.status = '有効';
    const label = `${fmtMD(f.date)} ${data.name} ${yen(data.cost)}`;
    if (st.editId) {
      const before = st.rows.find(r => r.id === st.editId);
      await app.sync.save('attendance', st.editId, { ...data, edited: true }, { log: { type: '勤怠を直す', reason: '', before: pick(before || {}, KEYS), after: pick(data, KEYS) } });
      Object.assign(st, { editId: null, msg: `直しました：${label}（修正前は履歴に残ります）`, bad: false });
    } else {
      await app.sync.save('attendance', uuid(), data);
      Object.assign(st, { msg: `保存しました：${label}`, bad: false });
    }
    st.f = { ...blank(), date: f.date, staffId: f.staffId };
    if (f.date.slice(0, 7) !== st.month) { st.month = f.date.slice(0, 7); load(); }
    paint(); // 保存で描き直したあとに変えたお知らせと入力を出す
  }

  function paintRight() {
    const live = st.rows.filter(r => r.status !== ST_DEL);
    const sum = attendanceSummary(live);
    put(right,
      h('section', { class: 'dcard' },
        h('div', { class: 'row-between' }, h('h3', {}, '今月の集計'), h('span', {}, h('span', { class: 'small muted2' }, '合計 '), h('b', { class: 'num big22' }, yen(sum.total)))),
        h('div', { class: 'grid2' },
          sum.fixed.map(x => h('div', { class: 'tile' },
            h('div', {}, h('b', {}, x.name), h('span', { class: 'sheet-badge' }, 'スプシ：単独の行')),
            h('div', { class: 'small muted2' }, `${x.days}日・${fmtHours(x.hours)}` + (x.transport ? `・交通費 ${yen(x.transport)}（${x.transportDays}日）` : '')),
            h('b', { class: 'num big20' }, yen(x.cost)))),
          h('div', { class: 'tile' },
            h('div', {}, h('b', {}, 'その他のスタッフ'), h('span', { class: 'sheet-badge' }, 'スプシ：人件費の1行')),
            h('div', { class: 'small muted2' }, `${sum.others.count}件` + (sum.others.names.length ? `（${sum.others.names.join('・')}）` : '')),
            h('b', { class: 'num big20' }, yen(sum.others.cost))))),
      h('section', { class: 'dcard' },
        h('h3', {}, '記録（新しい順）'),
        live.length ? live.sort((a, b) => b.bizDate.localeCompare(a.bizDate) || String(b.createdAt).localeCompare(String(a.createdAt))).map(r =>
          h('div', { class: 'rec-row' + (st.editId === r.id ? ' editing' : '') },
            h('span', { class: 'rec-date' }, fmtMD(r.bizDate)),
            h('b', { class: 'rec-name' }, r.name),
            h('span', { class: 'rec-detail small' }, String(r.id).startsWith('cm-') ? 'レジ・小口から' : r.kind === ATT_OTHER ? '手打ち' : fmtHours(r.hours) + (Number(r.transport) ? '＋交通費' : '')),
            h('b', { class: 'num grow' }, yen(attendanceCost(r))),
            r.edited ? h('span', { class: 'badge' }, '修正あり') : null,
            String(r.id).startsWith('cm-') ? h('span', { class: 'small muted2 rec-hint' }, '今日の画面で直す') : [ // レジの出し入れの内訳（スタッフへの支払い）から自動で入った分
              h('button', { class: 'btn btn-xs', onclick: () => edit(r) }, '直す'),
              h('button', { class: 'btn btn-xs danger', onclick: () => remove(r) }, '消す')]))
          : h('div', { class: 'muted2 pad' }, 'この月の記録はまだありません。'),
        h('div', { class: 'small muted2' }, '直した・消した記録は、修正前の内容と一緒に操作履歴に残ります。')));
  }

  function edit(r) {
    st.editId = r.id;
    st.f = r.kind === ATT_OTHER
      ? { date: r.bizDate, staffId: 'other', hours: 6, trans: false, name: r.name, amount: String(r.amount ?? '') }
      : { date: r.bizDate, staffId: r.staffId, hours: Number(r.hours) || 6, trans: Number(r.transport) > 0, name: '', amount: '' };
    st.msg = '';
    paint();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(r) {
    const reason = await pickReason(`${fmtMD(r.bizDate)} ${r.name} の記録を消す`, ['打ち間違い', '二重に入れた', 'その他'], '消しても、修正前の内容は操作履歴に残ります。');
    if (!reason) return;
    if (st.editId === r.id) { st.editId = null; st.f = blank(); }
    await app.sync.save('attendance', r.id, { status: ST_DEL }, { log: { type: '勤怠を消す', reason, before: pick(r, KEYS) } });
    toast('消しました（履歴には残ります）');
  }

  async function reload() {
    const [from, to] = monthRange(st.month);
    st.rows = await app.store.listRows('attendance', from, to);
    st.staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (st.f.staffId === undefined) st.f.staffId = st.staff.length ? st.staff[0].id : 'other';
    paint();
  }
  function load() {
    const [from, to] = monthRange(st.month);
    reload();
    Promise.all([app.sync.pull('attendance', from, to), app.sync.pull('staff')]).catch(() => {});
  }
  const off = app.sync.onChange(t => { if (t === 'attendance' || t === 'staff') reload(); });
  load();
  return off;
}
