// 店内：左に入店、右に店内の組（通常／イベントの2ページ）。
// カードをタップすると、その卓が店内の欄いっぱいに広がる（左が追加、右が会計）
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso, fmtHM, timeOnBizDay, addDays } from '../bizday.js';
import {
  KIND_NOMI, KIND_TANPIN, KIND_EVENT, KINDS, METHODS, ST_IN, ST_OUT, ST_DEL, EXTRA_ADD, EXTRA_EXT,
  nextNo, label, baseAmount, extrasTotal, total, paidTotal, remaining, overpaid, methodSums, receive,
  timeState, timeText, liveExtras, livePays, markDeleted, extensionExtra, extraLabel
} from '../calc.js';
import { openSheet, pickReason, stepper } from '../ui.js';

const BADGE = { lo: 'ラストオーダー', over: '時間超過' };
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const lab = (text, forId) => h('label', { class: 'lab', for: forId }, text);

export function renderStore(root, app) {
  const S = () => app.settings;
  const day = () => app.bizDate();
  const st = {
    size: 2, kind: KIND_NOMI, name: '', evAmount: '', evEnd: '', evId: '', err: '',
    pane: 0, all: [], events: [], openId: null, busy: false,
    det: null // 広げた卓の入力（追加の金額・直している追加・支払い方法・受け取る金額・お知らせ）
  };
  const inStore = () => st.all.filter(v => v.status === ST_IN).sort((a, b) => String(a.inAt).localeCompare(String(b.inAt)));
  const editable = () => app.canEdit('visits', day());

  // ===== 入店 =====
  const sizeGrid = h('div', { class: 'size-grid' });
  const kindGrid = h('div', { class: 'kind-grid' });
  const eventBox = h('div', { class: 'event-box' });
  const tanpinNote = h('div', { class: 'note' }, '単品は0円で入店。注文のたびに卓をタップして「追加」で足します。');
  const nameInput = h('input', { id: 'gName', class: 'input', type: 'text', placeholder: '苗字か仮名', maxlength: 20, autocomplete: 'off', oninput: e => { st.name = e.target.value; } });
  const errEl = h('div', { class: 'form-err', role: 'alert' });
  const enterBtn = h('button', { class: 'btn btn-primary btn-enter', onclick: enter });
  const entry = h('section', { class: 'card entry', 'aria-label': '入店' },
    h('h2', { class: 'card-title' }, '入店'),
    h('div', { class: 'lab' }, '人数'), sizeGrid,
    h('div', { class: 'lab' }, '種類'), kindGrid,
    eventBox, tanpinNote,
    lab('名前（空でもよい）', 'gName'), nameInput,
    errEl, enterBtn);

  function paintEntry() {
    put(sizeGrid, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => h('button', {
      class: 'btn pick' + (st.size === n ? ' on' : ''), onclick: () => { st.size = n; paintEntry(); }
    }, String(n))), h('button', { class: 'btn pick' + (st.size >= 10 ? ' on' : ''), onclick: pickMany }, st.size >= 10 ? `${st.size}` : '10〜'));
    put(kindGrid, KINDS.map(k => h('button', {
      class: 'btn pick' + (st.kind === k ? ' on' : ''), onclick: () => { st.kind = k; st.err = ''; paintEntry(); }
    }, k)));
    eventBox.hidden = st.kind !== KIND_EVENT;
    tanpinNote.hidden = st.kind !== KIND_TANPIN;
    if (st.kind === KIND_EVENT) paintEventBox();
    errEl.textContent = st.err;
    enterBtn.textContent = `入店する（${st.size}名・${yen(baseAmount(st.kind, st.size, S(), st.evAmount))}）`;
  }

  function paintEventBox() {
    const todays = st.events.filter(e => e.status !== ST_DEL);
    put(eventBox,
      todays.length ? [h('div', { class: 'lab' }, '今日の予定から選ぶ'),
        todays.map(e => h('button', {
          class: 'btn pick left' + (st.evId === e.id ? ' on' : ''), onclick: () => {
            Object.assign(st, { evId: e.id, name: e.title || '', evAmount: String(e.expectedAmount || ''), evEnd: e.endTime || '', size: Number(e.people) || st.size, err: '' });
            nameInput.value = st.name;
            paintEntry();
          }
        }, [e.startTime, e.title, e.people ? e.people + '名' : ''].filter(Boolean).join('　')))] : null,
      lab('金額（団体の合計）', 'evAmt'),
      h('input', { id: 'evAmt', class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：54000', value: st.evAmount, oninput: e => { st.evAmount = e.target.value; st.err = ''; enterBtn.textContent = `入店する（${st.size}名・${yen(st.evAmount)}）`; } }),
      lab('終了の予定時刻（イベントごとに違う）', 'evEnd'),
      h('input', { id: 'evEnd', class: 'input', type: 'time', value: st.evEnd, oninput: e => { st.evEnd = e.target.value; st.err = ''; } }));
  }

  function pickMany() {
    const step = stepper(Math.max(10, st.size), { min: 1, max: 99 });
    openSheet(close => [
      h('h2', {}, '人数を選ぶ'), step,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', { class: 'btn btn-primary', onclick: () => { st.size = step.value(); close(); paintEntry(); } }, '決める'))
    ]);
  }

  async function enter() {
    if (st.busy) return; // 2回押し防止
    if (!editable()) { st.err = 'この営業日の記録は、店長モードで直せます。'; return paintEntry(); }
    const isEv = st.kind === KIND_EVENT;
    const endAt = isEv ? timeOnBizDay(day(), st.evEnd, S().bizDayCutoffHour ?? 12) : '';
    if (isEv && (!(Number(st.evAmount) > 0) || !endAt)) { st.err = 'イベントは、金額と終了の予定時刻を入れてください。'; return paintEntry(); }
    st.busy = true;
    setTimeout(() => { st.busy = false; }, 700);
    const base = baseAmount(st.kind, st.size, S(), st.evAmount);
    const v = {
      bizDate: day(), no: nextNo(st.all.filter(x => x.bizDate === day())), name: st.name.trim(), people: st.size, kind: st.kind,
      inAt: nowIso(), endAt, status: ST_IN, base, extras: [], pays: [], total: base, cash: 0, cashless: 0, point: 0,
      eventId: isEv ? st.evId : '', trial: app.isTrial(day())
    };
    Object.assign(st, { size: 2, kind: KIND_NOMI, name: '', evAmount: '', evEnd: '', evId: '', err: '' });
    nameInput.value = '';
    paintEntry();
    await app.sync.save('visits', uuid(), v);
    scrollPane(isEv ? 1 : 0);
    toast(`${label(v)}（${v.people}名）が入店しました`);
  }

  // ===== 店内の組 =====
  const area = h('section', { class: 'store-area', 'aria-label': '店内' });
  const summaryEl = h('div', { class: 'store-sum' });
  const paneBar = h('div', { class: 'seg' });
  const panes = [h('div', { class: 'pane' }), h('div', { class: 'pane' })];
  const paneBox = h('div', { class: 'panes', onscroll: () => {
    const i = Math.round(paneBox.scrollLeft / (paneBox.clientWidth || 1));
    if (i !== st.pane) { st.pane = i; paintPaneBar(); }
  } }, panes);
  area.append(
    h('div', { class: 'store-head' },
      h('h2', { class: 'card-title' }, '店内'), summaryEl, h('span', { class: 'grow' }),
      h('span', { class: 'chip lo' }, `残り${S().lastOrderMinutes}分＝ラストオーダー`),
      h('span', { class: 'chip over' }, '時間超過')),
    h('div', { class: 'pane-head' }, paneBar, h('span', { class: 'hint' }, '横にスワイプでも切り替え。卓をタップすると追加・会計')),
    paneBox);

  function scrollPane(i) {
    st.pane = i;
    paneBox.scrollTo({ left: i * paneBox.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
    paintPaneBar();
  }

  function paintPaneBar() {
    const list = inStore();
    const counts = [list.filter(v => v.kind !== KIND_EVENT).length, list.filter(v => v.kind === KIND_EVENT).length];
    put(paneBar, ['通常', 'イベント'].map((l, i) => h('button', {
      class: st.pane === i ? 'on' : '', role: 'tab', 'aria-selected': String(st.pane === i), onclick: () => scrollPane(i)
    }, `${l} ${counts[i]}組`)));
  }

  function paintPanes() {
    const list = inStore();
    summaryEl.textContent = `${list.length}組・${list.reduce((a, v) => a + (Number(v.people) || 0), 0)}名`;
    const groups = [list.filter(v => v.kind !== KIND_EVENT), list.filter(v => v.kind === KIND_EVENT)];
    const empty = ['通常の組はいません', 'イベントの組はいません'];
    groups.forEach((g, i) => put(panes[i], g.length ? g.map(card) : h('div', { class: 'pane-empty' }, empty[i])));
    paintPaneBar();
  }

  function metaLine(v) {
    const ex = extrasTotal(v);
    const amt = yen(total(v)) + (ex > 0 ? `（追加 ${yen(ex)}）` : '');
    const old = v.bizDate !== day() ? `${Number(v.bizDate.slice(5, 7))}/${Number(v.bizDate.slice(8, 10))}の組　·　` : ''; // 前の営業日に残った組
    return old + (v.kind === KIND_EVENT && v.endAt ? `${fmtHM(v.inAt)}〜${fmtHM(v.endAt)}　·　${amt}` : `入店 ${fmtHM(v.inAt)}　·　${amt}`);
  }

  function card(v) {
    const t = timeState(v, S());
    const paid = paidTotal(v);
    return h('button', {
      class: 'gcard k-' + t.kind, 'data-id': v.id, onclick: e => openDetail(v.id, e.currentTarget),
      'aria-label': `${label(v)} ${v.people}名 ${timeText(v, t)}。タップで追加・会計`
    },
      h('div', { class: 'g-top' },
        h('span', { class: 'g-name' }, label(v)), h('span', { class: 'kchip' }, v.kind), h('span', { class: 'grow' }),
        BADGE[t.kind] ? h('span', { class: 'sbadge ' + t.kind }, BADGE[t.kind]) : null),
      h('div', { class: 'g-mid' }, h('span', { class: 'g-time' }, timeText(v, t)), h('span', { class: 'g-people' }, v.people + '名')),
      h('div', { class: 'g-meta' }, metaLine(v)),
      paid > 0 ? h('div', { class: 'g-paid' }, `受け取り済み ${yen(paid)}　残り ${yen(remaining(v))}`) : null);
  }

  // ===== 広げた卓 =====
  let back = null, panel = null;

  function openDetail(id, cardEl) {
    if (panel) return;
    st.openId = id;
    st.det = { addAmt: '', editId: null, method: '現金', payAmt: '', msg: '', bad: false };
    back = h('div', { class: 'det-back', onclick: closeDetail });
    panel = h('div', { class: 'det-panel', role: 'dialog' });
    area.append(back, panel);
    paintDetail();
    if (reduceMotion()) return;
    const to = panel.getBoundingClientRect(), from = cardEl.getBoundingClientRect();
    const fromT = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    panel.animate([{ transform: fromT, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.9,.25,1)' });
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
  }

  function closeDetail() {
    if (!panel) return;
    const p = panel, b = back, id = st.openId;
    panel = back = null;
    st.openId = st.det = null;
    // 閉じかけの卓は触れないようにする。画面が裏に回ると動きが止まることがあるので、動きが終わらなくても消す
    p.inert = true;
    p.style.pointerEvents = b.style.pointerEvents = 'none';
    let removed = false;
    const done = () => { if (removed) return; removed = true; p.remove(); b.remove(); };
    setTimeout(done, 300);
    if (reduceMotion()) return done();
    const cardEl = area.querySelector(`.gcard[data-id="${CSS.escape(id)}"]`);
    const from = p.getBoundingClientRect();
    let toT = 'scale(.3)';
    if (cardEl) {
      const c = cardEl.getBoundingClientRect();
      toT = `translate(${c.left - from.left}px, ${c.top - from.top}px) scale(${c.width / from.width}, ${c.height / from.height})`;
    }
    p.animate([{ transform: 'none', opacity: 1 }, { transform: toT, opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = done;
    b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
  }

  /** 保存（合計と支払い方法ごとの受け取りも一緒に直す）。計算は端末の最新の行から */
  async function saveVisit(v, patch, log) {
    const cur = (await app.store.getRow('visits', v.id)) || v;
    const next = { ...cur, ...patch };
    await app.sync.save('visits', v.id, { ...patch, total: total(next), ...methodSums(next.pays) }, log ? { log } : {});
  }

  /** いま開いている卓の最新の行。閉じた卓・退店した組なら null（古い画面からの操作を無視する） */
  async function liveVisit(v) {
    if (!panel || !st.det || st.openId !== v.id) return null;
    const cur = await app.store.getRow('visits', v.id);
    if (cur && cur.status === ST_IN && !app.canEdit('visits', cur.bizDate)) { // 前の営業日の組は、バイトには直せない
      toast('前の営業日の組は、店長モードで直せます', 'err');
      return null;
    }
    return cur && cur.status === ST_IN ? cur : null;
  }

  function paintDetail() {
    if (!panel) return;
    const v = st.all.find(x => x.id === st.openId);
    if (!v || v.status !== ST_IN) return closeDetail();
    const d = st.det;
    const t = timeState(v, S());
    const rem = remaining(v);

    // --- 追加 ---
    const addInput = h('input', {
      class: 'input', type: 'number', inputmode: 'numeric', 'aria-label': '追加の金額', placeholder: '金額を入力', value: d.addAmt,
      oninput: e => { d.addAmt = e.target.value; }
    });
    const extras = liveExtras(v).map(x => h('div', { class: 'xrow' + (d.editId === x.id ? ' editing' : '') },
      h('span', { class: 'xlabel' }, x.type === EXTRA_EXT ? `${extraLabel(x)}　${yen(x.amount)}` : yen(x.amount), d.editId === x.id ? '　← 直している' : ''),
      x.type === EXTRA_EXT
        ? h('button', { class: 'btn btn-xs', onclick: () => pickExtension(v, x) }, '人数を直す')
        : h('button', { class: 'btn btn-xs', onclick: () => { d.editId = x.id; d.addAmt = String(x.amount); paintDetail(); } }, '直す'),
      h('button', { class: 'btn btn-xs danger', onclick: () => delExtra(v, x) }, '消す')));
    const exts = S().extensions || [];
    const addBox = h('div', { class: 'det-box' },
      h('h3', {}, '追加'),
      extras.length ? h('div', { class: 'xlist' }, extras) : null,
      h('div', { class: 'quick' }, (S().quickAdds || [500, 800, 1000]).map(a =>
        h('button', { class: 'btn', onclick: () => addExtra(v, a) }, '+' + yen(a)))),
      h('div', { class: 'inline-add' }, addInput,
        h('button', { class: 'btn btn-primary', onclick: () => addCustom(v) }, d.editId ? '直す' : '足す')),
      d.editId ? h('button', { class: 'btn btn-sm', onclick: () => { d.editId = null; d.addAmt = ''; paintDetail(); } }, '直すのをやめる') : null,
      exts.length && v.kind === KIND_NOMI ? [h('div', { class: 'lab' }, '延長'),
        h('div', { class: 'quick' }, exts.map(x => h('button', { class: 'btn', onclick: () => pickExtension(v, null, x) }, `${x.label}（1人 ${yen(x.price)}）`)))] : null);

    // --- 会計 ---
    const payInput = h('input', {
      class: 'input', type: 'number', inputmode: 'numeric', 'aria-label': '受け取る金額', placeholder: `空欄なら残り ${yen(rem)}`, value: d.payAmt,
      oninput: e => { d.payAmt = e.target.value; d.msg = ''; msgEl.hidden = true; recvBtn.textContent = recvLabel(); }
    });
    const recvLabel = () => (rem === 0 ? '0円で退店する' : `${d.method}で受け取る（${yen(d.payAmt === '' ? rem : Number(d.payAmt) || 0)}）`);
    const recvBtn = h('button', { class: 'btn btn-primary btn-recv', onclick: () => doReceive(v) }, recvLabel());
    const over = overpaid(v);
    const msgEl = h('div', { class: 'pay-msg ' + (d.bad || over ? 'bad' : 'good'), role: 'status' }, over ? `受け取り済みが合計より ${yen(over)} 多くなっています。受け取りを消して直してください。` : d.msg);
    msgEl.hidden = !(d.msg || over);
    const pays = livePays(v);
    const payBox = h('div', { class: 'det-box' },
      h('h3', {}, '会計（割り勘・併用OK）'),
      h('div', { class: 'row-between' }, h('span', {}, '受け取り済み'), h('b', { class: 'num' }, yen(paidTotal(v)))),
      h('div', { class: 'row-between' }, h('span', {}, '残り'), h('span', { class: 'rem num' }, yen(rem))),
      pays.length ? h('div', { class: 'plist' }, pays.map((p, i) => h('div', { class: 'prow2' },
        h('span', { class: 'grow' }, `${i + 1}回目・${p.method}`), h('b', { class: 'num' }, yen(p.amount)),
        h('button', { class: 'btn btn-xs danger', onclick: () => delPay(v, p) }, '消す')))) : null,
      h('div', { class: 'methods' }, METHODS.map(m => h('button', {
        class: 'btn pick' + (d.method === m ? ' on' : ''), onclick: () => { d.method = m; d.msg = ''; d.bad = false; paintDetail(); }
      }, m))),
      payInput, msgEl, recvBtn,
      h('div', { class: 'fine' }, '空欄のまま押すと残りの全額。合計に達すると自動で退店します。'));

    put(panel,
      h('div', { class: 'det-head' },
        h('span', { class: 'det-name' }, label(v)), h('span', { class: 'kchip' }, v.kind),
        BADGE[t.kind] ? h('span', { class: 'sbadge ' + t.kind }, BADGE[t.kind]) : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm', onclick: () => editGroup(v) }, '直す'),
        h('button', { class: 'btn btn-sm', onclick: closeDetail }, '× 閉じる')),
      h('div', { class: 'det-sum' },
        h('div', {}, h('div', { class: 'det-time' }, timeText(v, t)), h('div', { class: 'det-meta' }, metaLine(v))),
        h('div', { class: 'det-people' }, v.people + '名'),
        h('span', { class: 'grow' }),
        h('div', { class: 'det-total' }, h('div', { class: 'lab' }, '合計'), h('div', { class: 'num' }, yen(total(v))))),
      h('div', { class: 'det-grid' }, addBox, payBox));
  }

  // --- 追加の操作 ---
  async function addExtra(v, amount) {
    v = await liveVisit(v);
    if (!v) return;
    if (!(Number(amount) > 0)) return;
    st.det.addAmt = '';
    await saveVisit(v, { extras: [...(v.extras || []), { id: uuid(), type: EXTRA_ADD, amount: Number(amount), at: nowIso() }] });
  }

  async function addCustom(v) {
    v = await liveVisit(v);
    if (!v) return;
    const d = st.det, amt = Number(d.addAmt);
    if (!Number.isInteger(amt) || amt <= 0) return;
    if (!d.editId) return addExtra(v, amt);
    const before = liveExtras(v).find(x => x.id === d.editId);
    const extras = (v.extras || []).map(x => (x.id === d.editId ? { ...x, amount: amt } : x));
    d.editId = null;
    d.addAmt = '';
    await saveVisit(v, { extras }, { type: '追加を直す', reason: '', before: { amount: before?.amount }, after: { amount: amt } });
  }

  async function delExtra(v, x) {
    v = await liveVisit(v);
    if (!v) return;
    if (st.det.editId === x.id) { st.det.editId = null; st.det.addAmt = ''; }
    await saveVisit(v, { extras: markDeleted(v.extras, x.id) }, { type: x.type === EXTRA_EXT ? '延長を外す' : '追加を消す', reason: '', before: x });
  }

  /**
   * 延長する人数を選ぶ（初期値は卓の人数）。cur を渡すと、足した延長の人数を直す
   * 金額＝1人の延長料金×人数。卓の時間は、1人でも延長すれば延びる（同じ卓で2回目の延長もできる）
   */
  function pickExtension(v, cur, x) {
    const people = Math.max(1, Number(v.people) || 1);
    const unit = cur ? (Number(cur.unit) || Math.round((Number(cur.amount) || 0) / (Number(cur.count) || people))) : Number(x.price) || 0;
    const name = cur ? cur.label : x.label;
    const start = cur ? (Number(cur.count) || people) : people;
    const sum = h('div', { class: 'ext-sum num' });
    const paintSum = c => { sum.textContent = `${name} ×${c}人 ＝ ${yen(unit * c)}`; };
    const step = stepper(Math.min(start, Math.max(people, start)), { min: 1, max: Math.max(people, start), onChange: paintSum });
    paintSum(step.value());
    openSheet(close => [
      h('h2', {}, cur ? `${name}の人数を直す` : `${name}（1人 ${yen(unit)}）`),
      h('p', { class: 'help' }, `延長する人数（卓は${people}名）。1人でも延長すれば、卓の時間は延びます。`),
      step, sum,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', { class: 'btn btn-primary', onclick: async () => { close(); await saveExtension(v, cur, x, step.value(), unit); } }, cur ? '直す' : '延長する'))
    ]);
  }

  async function saveExtension(v, cur, x, count, unit) {
    v = await liveVisit(v);
    if (!v) return;
    if (!cur) {
      await saveVisit(v, { extras: [...(v.extras || []), { id: uuid(), ...extensionExtra(x, count), at: nowIso() }] });
      toast(`${x.label} ×${count}人を足しました`);
      return;
    }
    const before = liveExtras(v).find(e => e.id === cur.id);
    if (!before) return;
    const after = { ...before, unit, count, amount: unit * count };
    const extras = (v.extras || []).map(e => (e.id === cur.id ? after : e));
    await saveVisit(v, { extras }, { type: '延長の人数を直す', reason: '', before: { label: before.label, count: before.count ?? '', amount: before.amount }, after: { label: after.label, count, amount: after.amount } });
    toast('延長の人数を直しました');
  }

  // --- 会計の操作 ---
  async function doReceive(v) {
    v = await liveVisit(v);
    if (!v) return;
    const d = st.det;
    const r = receive(v, d.method, d.payAmt);
    if (!r.ok) { d.msg = r.error; d.bad = true; return paintDetail(); }
    const pays = r.pay ? [...(v.pays || []), { id: uuid(), ...r.pay, at: nowIso() }] : (v.pays || []);
    d.payAmt = '';
    if (r.finished) {
      closeDetail();
      await saveVisit(v, { pays, status: ST_OUT, outAt: nowIso() });
      toast(`${label(v)} 精算完了・退店しました` + (r.change > 0 ? `（お釣り ${yen(r.change)}）` : ''));
      return;
    }
    d.msg = `${r.pay.method} ${yen(r.pay.amount)} を受け取りました。残り ${yen(remaining(v) - r.pay.amount)}`;
    d.bad = false;
    await saveVisit(v, { pays });
  }

  async function delPay(v, p) {
    v = await liveVisit(v);
    if (!v) return;
    st.det.msg = '';
    await saveVisit(v, { pays: markDeleted(v.pays, p.id) }, { type: '受け取りを消す', reason: '', before: p });
  }

  // --- 組を直す・入店を削除 ---
  function editGroup(v) {
    const name = h('input', { class: 'input', type: 'text', value: v.name || '', placeholder: `空なら ${v.no}組目`, maxlength: 20 });
    const people = stepper(Number(v.people) || 1, { min: 1, max: 99 });
    const isEv = v.kind === KIND_EVENT;
    const evAmt = h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: String(v.base ?? '') });
    const evEnd = h('input', { class: 'input', type: 'time', value: v.endAt ? fmtHM(v.endAt) : '' });
    openSheet(close => [
      h('h2', {}, `${label(v)}を直す`),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '名前'), name),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '人数'), people,
        v.kind === KIND_NOMI ? h('p', { class: 'help' }, `飲み放題は、人数×${yen(S().nomiPrice)} に基本の金額も直します。`) : null),
      isEv ? [h('div', { class: 'field' }, h('div', { class: 'field-label' }, '金額（団体の合計）'), evAmt),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, '終了の予定時刻'), evEnd)] : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-danger', onclick: async () => {
            close();
            const reason = await pickReason(`${label(v)}の入店を削除`, S().deleteReasons, '削除しても記録は消えず、「操作履歴」に理由と一緒に残ります。');
            if (!reason) return;
            closeDetail();
            await app.sync.save('visits', v.id, { status: ST_DEL }, { log: { type: '入店の削除', reason, before: { ...pick(v, ['name', 'people', 'kind', 'base']), extras: liveExtras(v), pays: livePays(v) } } });
            toast('入店を削除しました');
          }
        }, '入店を削除'),
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            const patch = { name: name.value.trim(), people: people.value() };
            if (v.kind === KIND_NOMI) patch.base = baseAmount(KIND_NOMI, patch.people, S());
            if (isEv) {
              const endAt = timeOnBizDay(v.bizDate, evEnd.value, S().bizDayCutoffHour ?? 12);
              if (!(Number(evAmt.value) > 0) || !endAt) { toast('金額と終了の予定時刻を入れてください', 'err'); return; }
              Object.assign(patch, { base: Number(evAmt.value), endAt });
            }
            close();
            const keys = Object.keys(patch);
            await saveVisit(v, patch, { type: '組を直す', reason: '', before: pick(v, keys), after: patch });
            toast('直しました');
          }
        }, '保存'))
    ]);
  }

  // ===== 読み込み =====
  root.append(h('section', { class: 'page store' }, h('div', { class: 'store-grid' }, entry, area)));

  async function load() {
    st.all = await app.store.listRows('visits', addDays(day(), -3), day()); // 前の営業日に店内に残った組も出す（今日の組と、店内の組だけ）
    st.all = st.all.filter(v => v.bizDate === day() || v.status === ST_IN);
    st.events = await app.store.listRows('events', day(), day());
    paintPanes();
    paintDetail();
    if (st.kind === KIND_EVENT) paintEventBox();
  }

  const offChange = app.sync.onChange(t => { if (t === 'visits' || t === 'events') load(); });
  const timer = setInterval(() => { paintPanes(); if (panel && !document.activeElement?.matches('input')) paintDetail(); }, 15e3);
  // ほかの端末（店長のスマホなど）の変更を取り込む。開きっぱなしの端末が古いままにならないように
  const pullAll = () => Promise.all([app.sync.pull('visits', addDays(day(), -3), day()), app.sync.pull('events', day(), day())]).catch(() => {});
  const pullTimer = setInterval(pullAll, 30e3);
  const onVisible = () => { if (!document.hidden) pullAll(); };
  document.addEventListener('visibilitychange', onVisible);
  paintEntry();
  load();
  pullAll();
  return () => { offChange(); clearInterval(timer); clearInterval(pullTimer); document.removeEventListener('visibilitychange', onVisible); };
}
