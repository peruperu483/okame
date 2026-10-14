// 来客・会計（いちばん大事な画面）
// 入店：人数をタップするだけ → 店内のカード（入店順）→ カードをタップで会計 → 会計済み
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso, fmtDay, fmtTime, addDays } from '../bizday.js';
import {
  PLAN_NOMI, PLAN_SINGLE, PAYS, KINDS, ST_IN, ST_PAID, ST_DEL,
  nextNo, label, timeState, fmtMin, defaultAmount, validAmount, daySummary, closingIsStale
} from '../calc.js';
import { openSheet, seg, pickReason, stepper, amountInput } from '../ui.js';
import { openClosing } from './closing.js';

const SNAP_KEYS = ['name', 'people', 'plan', 'status', 'amount', 'pay', 'kind', 'paidAt', 'extensions'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const field = (labelText, control, help) => h('div', { class: 'field' },
  h('div', { class: 'field-label' }, labelText), control, help ? h('p', { class: 'help' }, help) : null);

export function renderVisits(root, app) {
  const st = { day: app.bizDate(), followToday: true, tab: 'in', plan: PLAN_NOMI, all: [], closing: null, busy: false };
  const S = () => app.settings;
  const isToday = () => st.day === app.bizDate();
  const editable = () => app.canEdit('visits', st.day);
  const shown = () => st.all.filter(v => v.status !== ST_DEL);
  const readOnlyToast = () => toast('前の日の記録は、店長モードで直せます', 'err');

  // ===== 入店 =====
  const nameInput = h('input', { class: 'input', type: 'text', placeholder: '名前（空なら番号）', maxlength: 20, autocomplete: 'off' });
  const planSeg = seg([PLAN_NOMI, PLAN_SINGLE], st.plan, v => { st.plan = v; });
  const entry = h('div', { class: 'card entry' },
    h('h2', { class: 'card-title' }, '入店'),
    h('div', { class: 'entry-row' }, nameInput, planSeg),
    h('div', { class: 'people-grid' },
      [1, 2, 3, 4, 5, 6, 7, 8].map(k => h('button', { class: 'people-btn', onclick: () => enter(k) }, h('b', {}, String(k)), '人')),
      h('button', { class: 'people-btn more', onclick: enterMany }, '9人〜')));

  const summary = h('div', { class: 'card summary' });
  const dayNav = h('div', { class: 'day-nav' });
  const banner = h('div', { class: 'banner-slot' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const list = h('div', { class: 'vlist' });

  root.append(h('section', { class: 'page visits' },
    h('div', { class: 'visits-grid' },
      h('div', { class: 'area-main' }, dayNav, banner, tabs, list),
      h('div', { class: 'area-entry' }, entry),
      h('div', { class: 'area-summary' }, summary))));

  async function enter(people) {
    if (st.busy) return; // 2回押し防止
    st.busy = true;
    setTimeout(() => { st.busy = false; }, 700);
    const v = {
      bizDate: st.day, no: nextNo(st.all), name: nameInput.value.trim(), people, plan: st.plan,
      inAt: nowIso(), extensions: [], status: ST_IN, trial: app.isTrial(st.day)
    };
    nameInput.value = '';
    st.plan = PLAN_NOMI;
    planSeg.set(PLAN_NOMI);
    st.tab = 'in'; // 保存で描き直す前に切り替えておく
    await app.sync.save('visits', uuid(), v);
    toast(`${label(v)}・${people}人 入店`);
  }

  function enterMany() {
    const step = stepper(9, { min: 1, max: 99 });
    openSheet(close => [
      h('h2', {}, '人数を選ぶ'),
      field('人数', step),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', { class: 'btn btn-primary', onclick: () => { close(); enter(step.value()); } }, '入店にする'))
    ]);
  }

  // ===== 会計 =====
  function checkout(v, { edit = false } = {}) {
    if (!editable()) return readOnlyToast();
    const s = S();
    let amount = edit ? v.amount : defaultAmount(v, s);
    const err = h('p', { class: 'help err' });
    const amt = amountInput(amount, { onInput: x => { amount = x; err.textContent = ''; amt.classList.remove('bad'); } });
    const paySeg = seg(PAYS, edit ? v.pay || '現金' : '現金', null, { size: 'lg' });
    const kindSeg = seg(KINDS, edit ? v.kind || '通常' : '通常', null, { size: 'lg' });
    const extPrice = (v.extensions || []).reduce((a, e) => a + (Number(e.price) || 0), 0);
    const hint = v.plan === PLAN_NOMI
      ? `${v.people}人 × ${yen(s.nomiPrice + extPrice)} = ${yen(defaultAmount(v, s))}（手で直せます）`
      : '単品なので、金額を入れてください。';

    openSheet(close => [
      h('h2', {}, `${label(v)}・${v.people}人`, h('span', { class: 'sheet-sub' }, `${v.plan}・${fmtTime(v.inAt)}入店`)),
      field('金額', amt, hint), err,
      field('支払い方法', paySeg),
      field('区分', kindSeg),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            if (!validAmount(amount)) {
              err.textContent = '金額を入れてください。0円や空のままでは会計できません。';
              amt.classList.add('bad');
              return;
            }
            const patch = { status: ST_PAID, paidAt: edit && v.paidAt ? v.paidAt : nowIso(), amount: Number(amount), pay: paySeg.value(), kind: kindSeg.value() };
            const opt = edit ? { log: { type: '会計の修正', reason: '', before: pick(v, ['amount', 'pay', 'kind']), after: pick(patch, ['amount', 'pay', 'kind']) } } : {};
            await app.sync.save('visits', v.id, patch, opt);
            close();
            toast(edit ? '会計を直しました' : `${label(v)} 会計済み（${yen(patch.amount)}）`);
          }
        }, edit ? '直す' : '会計済みにする'))
    ]);
  }

  // ===== 店内の組を直す・延長・削除 =====
  function editInStore(v) {
    if (!editable()) return readOnlyToast();
    const name = h('input', { class: 'input', type: 'text', value: v.name || '', placeholder: `空なら ${v.no}番`, maxlength: 20 });
    const people = stepper(v.people, { min: 1, max: 99 });
    const plan = seg([PLAN_NOMI, PLAN_SINGLE], v.plan);
    const exts = S().extensions || [];
    const now = v.extensions || [];
    openSheet(close => [
      h('h2', {}, `${label(v)}を直す`),
      field('名前', name),
      field('人数', people),
      field('プラン', plan),
      field('延長',
        exts.length
          ? h('div', { class: 'inline' }, exts.map(x => h('button', {
            class: 'btn', onclick: async () => {
              await app.sync.save('visits', v.id, { extensions: [...now, { id: x.id, label: x.label, price: x.price, minutes: x.minutes, at: nowIso() }] });
              close();
              toast(`${label(v)}に${x.label}を足しました`);
            }
          }, `${x.label}（${yen(x.price)}・${x.minutes}分）`)))
          : h('p', { class: 'muted' }, '延長は、設定で料金と時間を登録すると選べます。'),
        now.length ? `今の延長：${now.map(e => e.label).join('、')}` : null),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-danger', onclick: async () => {
            close();
            const reason = await pickReason(`${label(v)}の入店を削除`, S().deleteReasons, '削除しても記録は消えず、「操作履歴」に理由と一緒に残ります。');
            if (!reason) return;
            await app.sync.save('visits', v.id, { status: ST_DEL }, { log: { type: '入店の削除', reason, before: pick(v, SNAP_KEYS) } });
            toast('入店を削除しました');
          }
        }, '入店を削除'),
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            await app.sync.save('visits', v.id, { name: name.value.trim(), people: people.value(), plan: plan.value() });
            close();
            toast('直しました');
          }
        }, '保存'))
    ]);
  }

  // ===== 会計済みの組 =====
  function paidMenu(v) {
    openSheet(close => [
      h('h2', {}, `${label(v)}・${v.people}人`),
      h('dl', { class: 'kv' },
        h('dt', {}, '金額'), h('dd', {}, yen(v.amount)),
        h('dt', {}, '支払い方法'), h('dd', {}, v.pay || '—'),
        h('dt', {}, '区分'), h('dd', {}, v.kind || '—'),
        h('dt', {}, 'プラン'), h('dd', {}, v.plan),
        h('dt', {}, '入店・会計'), h('dd', {}, `${fmtTime(v.inAt)} ・ ${v.paidAt ? fmtTime(v.paidAt) : '—'}`)),
      editable()
        ? h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn', onclick: async () => {
              close();
              const reason = await pickReason('会計を取り消して店内に戻す', S().cancelReasons, '取り消しは「操作履歴」に理由と一緒に残ります。');
              if (!reason) return;
              st.tab = 'in'; // 保存で描き直す前に切り替えておく
              await app.sync.save('visits', v.id, { status: ST_IN, paidAt: '', amount: null, pay: '', kind: '' },
                { log: { type: '会計の取り消し', reason, before: pick(v, SNAP_KEYS) } });
              toast('店内に戻しました');
            }
          }, '店内に戻す'),
          h('button', { class: 'btn btn-primary', onclick: () => { close(); checkout(v, { edit: true }); } }, '金額・支払いを直す'))
        : h('p', { class: 'help' }, '前の日の記録は、店長モードで直せます。'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, '閉じる'))
    ]);
  }

  // ===== 描く =====
  function paint() {
    paintDayNav();
    paintBanner();
    paintTabs();
    paintList();
    paintSummary();
    entry.hidden = !isToday() || !editable();
  }

  function paintDayNav() {
    put(dayNav,
      h('button', { class: 'btn btn-sm', onclick: () => go(-1) }, '‹ 前の日'),
      h('div', { class: 'day-label' }, fmtDay(st.day), isToday() ? h('span', { class: 'muted' }, '（今日）') : null),
      h('button', { class: 'btn btn-sm', disabled: isToday(), onclick: () => go(1) }, '次の日 ›'),
      !isToday() ? h('button', { class: 'btn btn-sm', onclick: () => go(0) }, '今日に戻る') : null);
  }

  function paintBanner() {
    const sum = daySummary(shown(), S());
    const items = [];
    if (!isToday() && !editable()) items.push(h('div', { class: 'banner' }, 'この日の記録は見るだけです（直すには店長モード）。'));
    if (st.closing) {
      const d = Number(st.closing.diff) || 0;
      items.push(h('div', { class: 'banner ' + (closingIsStale(st.closing, sum) ? 'warn' : 'done') },
        h('span', {}, closingIsStale(st.closing, sum)
          ? '閉店のあとに会計が変わりました。締め直してください。'
          : `閉店済み（${fmtTime(st.closing.closedAt)}）・レジの差額 ${d === 0 ? '0円' : (d > 0 ? '+' : '−') + yen(Math.abs(d))}`),
        h('button', { class: 'btn btn-sm', onclick: () => openClosing(app, st.day) }, '締めを見る')));
    }
    put(banner, items);
  }

  function paintTabs() {
    const inN = shown().filter(v => v.status === ST_IN).length;
    const paidN = shown().filter(v => v.status === ST_PAID).length;
    const tab = (id, text) => h('button', {
      class: 'tab' + (st.tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(st.tab === id),
      onclick: () => { st.tab = id; paintTabs(); paintList(); }
    }, text);
    put(tabs, tab('in', `店内 ${inN}組`), tab('paid', `会計済み ${paidN}組`));
  }

  function paintList() {
    if (st.tab === 'in') {
      const rows = shown().filter(v => v.status === ST_IN);
      put(list, rows.length ? rows.map(card) : h('div', { class: 'empty' }, '店内にお客さんはいません。'));
    } else {
      const rows = shown().filter(v => v.status === ST_PAID).sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
      put(list, rows.length ? rows.map(paidRow) : h('div', { class: 'empty' }, 'まだ会計済みの組はありません。'));
    }
  }

  function card(v) {
    const t = timeState(v, S());
    const [tLabel, tVal] = {
      single: ['単品・経過', fmtMin(t.elapsed)],
      over: ['時間超過', '+' + fmtMin(-t.left)],
      lo: ['ラストオーダー', '残り ' + fmtMin(t.left)],
      ok: ['残り', fmtMin(t.left)]
    }[t.kind];
    const extN = (v.extensions || []).length;
    return h('div', { class: 'vcard k-' + t.kind },
      h('button', { class: 'vcard-main', onclick: () => checkout(v), 'aria-label': `${label(v)} ${v.people}人 会計する` },
        h('div', { class: 'vcard-people' }, String(v.people), h('small', {}, '人')),
        h('div', { class: 'vcard-info' },
          h('div', { class: 'vcard-name' }, label(v)),
          h('div', { class: 'vcard-sub' }, `${v.plan}・${fmtTime(v.inAt)}入店${extN ? `・延長${extN}回` : ''}`)),
        h('div', { class: 'vcard-time' }, h('div', { class: 't-label' }, tLabel), h('div', { class: 't-val' }, tVal)),
        h('div', { class: 'vcard-go' }, '会計')),
      h('button', { class: 'vcard-more', onclick: () => editInStore(v) }, '直す'));
  }

  function paidRow(v) {
    return h('button', { class: 'prow', onclick: () => paidMenu(v) },
      h('span', { class: 'prow-name' }, label(v)),
      h('span', { class: 'prow-people' }, v.people + '人'),
      h('span', { class: 'prow-pay' }, v.pay || '', v.kind === '団体' ? h('span', { class: 'badge' }, '団体') : null),
      h('span', { class: 'prow-time' }, v.paidAt ? fmtTime(v.paidAt) : ''),
      h('span', { class: 'prow-amount' }, yen(v.amount)));
  }

  function paintSummary() {
    const s = S();
    const sum = daySummary(shown(), s);
    const target = s.targets?.dailyGuests;
    const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    put(summary,
      h('h2', { class: 'card-title' }, isToday() ? '今日の合計' : fmtDay(st.day) + 'の合計'),
      h('div', { class: 'sum-main' }, h('span', { class: 'sum-label' }, '売上'), h('span', { class: 'sum-big' }, yen(sum.sales))),
      h('div', { class: 'sum-pair' },
        h('div', {}, h('span', { class: 'sum-label' }, '来客'), h('b', {}, sum.guests + '人'), target ? h('small', { class: 'muted' }, ` / 目標${target}人`) : null),
        h('div', {}, h('span', { class: 'sum-label' }, '組数'), h('b', {}, sum.groups + '組'))),
      h('dl', { class: 'kv sum-kv' },
        kv('現金', yen(sum.cash)),
        kv('キャッシュレス', yen(sum.cashless)),
        kv(s.pointCountsAsSales === false ? 'ポイント（売上に含めない）' : 'ポイント', yen(sum.point)),
        kv('通常', yen(sum.normal)),
        kv('団体', yen(sum.group))),
      sum.inStore ? h('p', { class: 'help' }, `店内 ${sum.inStore}組・${sum.inStorePeople}人（会計前）`) : null,
      h('button', { class: 'btn btn-lg ' + (st.closing ? '' : 'btn-outline'), onclick: () => openClosing(app, st.day) },
        st.closing ? '締めを見る・締め直す' : '閉店・レジ締め'));
  }

  // ===== 読み込み =====
  async function load() {
    st.all = (await app.store.listRows('visits', st.day, st.day)).sort((a, b) => String(a.inAt).localeCompare(String(b.inAt)));
    st.closing = await app.store.getRow('closings', st.day);
    paint();
  }

  function pull() {
    Promise.all([
      app.sync.pull('visits', st.day, st.day),
      app.sync.pull('closings', st.day, st.day),
      app.sync.pull('days', st.day, st.day)
    ]).catch(() => {});
  }

  function go(delta) {
    const today = app.bizDate();
    st.day = delta === 0 ? today : addDays(st.day, delta);
    if (st.day > today) st.day = today;
    st.followToday = st.day === today;
    st.tab = 'in';
    load();
    pull();
  }

  const offChange = app.sync.onChange(t => { if (t === 'visits' || t === 'closings') load(); });
  // 残り時間を進める。営業日が変わったら今日に合わせる
  const timer = setInterval(() => {
    if (st.followToday && st.day !== app.bizDate()) return go(0);
    if (st.tab === 'in') paintList();
  }, 20e3);

  load();
  pull();
  return () => { offChange(); clearInterval(timer); };
}
