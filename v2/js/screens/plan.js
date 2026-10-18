// 予定：月のカレンダーと一覧。イベント・団体の予定、店休日、希望休、シフト（予定）を入れる
// - イベント・団体：表 events。今日の予定は店内の入店で選べる
// - 店休日：表 days の closed。シフト（予定）も days
// - 希望休：表 requests
import { h, put, toast, uuid, yen } from '../util.js';
import { ST_DEL } from '../calc.js';
import { openSheet, pickReason, seg } from '../ui.js';
import { fmtMD, monthLabel, monthNav, monthRange, msgBox, mountCountdown, unitPicker } from './common.js';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const T_CLOSED = '店休日';
const T_REQUEST = '希望休';
const splitNames = s => String(s || '').split('、').map(x => x.trim()).filter(Boolean);

export function renderPlan(root, app) {
  const today = app.bizDate();
  const st = { month: today.slice(0, 7), view: 'cal', selected: today, events: [], days: [], requests: [], staff: [] };
  const head = h('div', { class: 'plan-head' });
  const body = h('div', { class: 'plan-body' });
  const cd = mountCountdown(app, st.month);
  const goalBox = h('div', { class: 'plan-goal' });
  root.append(h('section', { class: 'page plan' }, head, goalBox, body));

  // 月の売上目標（店長だけ打てる。月ごとに違う金額を入れられる）と、減算カウンター
  function paintGoal() {
    const mine = app.settings.monthlyTargets?.[st.month];
    const input = h('input', { class: 'input num', type: 'number', inputmode: 'numeric', min: 0, placeholder: String(app.settings.targets?.monthlySales || ''), value: mine ? String(mine) : '', 'aria-label': `${monthLabel(st.month)}の売上目標` });
    const save = async () => {
      const v = input.value === '' ? 0 : Number(input.value);
      if (!Number.isInteger(v) || v < 0) return toast('金額を入れてください', 'err');
      try {
        const r = await app.post('saveSettings', { settings: { monthlyTargets: { [st.month]: v } } });
        app.settings = r.settings;
        await app.store.kvSet('settings', r.settings);
        toast(v ? `${monthLabel(st.month)}の売上目標を保存しました` : '目標を空にしました（設定の「月の売上」を使います）');
        cd.refresh(st.month);
        paintGoal();
      } catch (e) { toast(app.errorText(e), 'err'); }
    };
    put(goalBox, cd.el,
      app.auth.isMgr() ? h('div', { class: 'dcard goal-edit' },
        h('div', { class: 'lab' }, `${monthLabel(st.month)}の売上目標（店長）`),
        h('div', { class: 'inline-add' }, input, h('span', { class: 'unit' }, '円'), h('button', { class: 'btn btn-primary', onclick: save }, '保存')),
        h('div', { class: 'small muted2' }, mine ? '月ごとに変えられます。空にすると、設定の「月の売上」になります。' : '入れていない月は、設定の「月の売上」を使います。')) : null);
  }

  const live = arr => arr.filter(x => x.status !== ST_DEL);
  const eventsOn = d => live(st.events).filter(e => e.date === d).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  const requestsOn = d => live(st.requests).filter(r => r.date === d);
  const dayRow = d => st.days.find(x => x.bizDate === d) || null;
  const canEdit = d => app.canEdit('events', d);
  const showContact = () => app.canSee('eventContact');

  function paint() {
    put(head,
      h('h1', { class: 'page-title' }, '予定'),
      monthNav(st.month, m => { st.month = m; st.selected = m === today.slice(0, 7) ? today : `${m}-01`; load(); }),
      st.month !== today.slice(0, 7) ? h('button', { class: 'btn btn-sm', onclick: () => { st.month = today.slice(0, 7); st.selected = today; load(); } }, '今月') : null,
      h('span', { class: 'grow' }),
      seg(['カレンダー', '一覧'], st.view === 'cal' ? 'カレンダー' : '一覧', v => { st.view = v === 'カレンダー' ? 'cal' : 'list'; paint(); }),
      h('button', { class: 'btn btn-primary', onclick: () => editItem({ date: st.selected >= today ? st.selected : today }) }, '予定を追加'));
    paintGoal();
    put(body, st.view === 'cal' ? [calendar(), dayPanel(st.selected)] : list());
  }

  // ===== カレンダー =====
  function calendar() {
    const [first, last] = monthRange(st.month);
    const startDow = new Date(first + 'T00:00:00Z').getUTCDay();
    const n = Number(last.slice(8));
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell blank' }));
    for (let d = 1; d <= n; d++) {
      const ymd = `${st.month}-${String(d).padStart(2, '0')}`;
      const row = dayRow(ymd);
      const evs = eventsOn(ymd);
      const reqs = requestsOn(ymd);
      cells.push(h('button', {
        class: 'cal-cell' + (ymd === today ? ' today' : '') + (ymd === st.selected ? ' sel' : '') + (row?.closed ? ' closed' : ''),
        onclick: () => { st.selected = ymd; paint(); }, 'aria-label': fmtMD(ymd)
      },
        h('span', { class: 'cal-d' }, String(d)),
        row?.closed ? h('span', { class: 'cal-tag gray' }, '店休') : null,
        evs.slice(0, 2).map(e => h('span', { class: 'cal-tag green' }, e.title || e.type)),
        evs.length > 2 ? h('span', { class: 'cal-more' }, `ほか${evs.length - 2}件`) : null,
        reqs.length ? h('span', { class: 'cal-tag amber' }, '休 ' + reqs.map(r => r.name).join('・')) : null,
        row?.shiftPlan ? h('span', { class: 'cal-shift' }, splitNames(row.shiftPlan).join('・')) : null));
    }
    return h('div', { class: 'dcard cal' },
      h('div', { class: 'cal-grid' }, DOW.map((w, i) => h('div', { class: 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, w)), cells));
  }

  // ===== 選んだ日 =====
  function dayPanel(d) {
    const row = dayRow(d);
    const editable = canEdit(d);
    const evs = eventsOn(d);
    const reqs = requestsOn(d);
    return h('div', { class: 'dcard day-panel' },
      h('div', { class: 'row-between' }, h('h2', {}, fmtMD(d) + (d === today ? '（今日）' : '')),
        editable ? h('button', { class: 'btn btn-sm', onclick: () => editItem({ date: d }) }, 'この日に予定を足す') : null),
      row?.closed ? h('div', { class: 'note' }, '店休日です。', editable ? h('button', { class: 'linkbtn', onclick: () => setClosed(d, false) }, '店休日をやめる') : null) : null,
      evs.length ? evs.map(itemRow) : h('div', { class: 'muted2 small' }, 'イベント・団体の予定はありません。'),
      reqs.length ? h('div', {}, h('div', { class: 'lab' }, '希望休'),
        reqs.map(r => h('div', { class: 'mrow' }, h('span', { class: 'grow' }, r.name),
          editable ? h('button', { class: 'btn btn-xs danger', onclick: () => removeRequest(r) }, '消す') : null))) : null,
      shiftBox(d, row, editable));
  }

  function itemRow(e) {
    const editable = canEdit(e.date);
    const detail = [e.people ? e.people + '名' : '', showContact() && e.contactName ? '幹事 ' + e.contactName : '', showContact() && e.contactInfo ? e.contactInfo : '', e.memo || ''].filter(Boolean).join('・');
    return h('div', { class: 'plan-item' },
      h('div', { class: 'plan-when' }, h('b', {}, fmtMD(e.date)), h('div', { class: 'small muted2' }, e.startTime ? `${e.startTime}〜${e.endTime || ''}` : '—')),
      h('span', { class: 'pbadge' }, e.type),
      h('div', { class: 'grow plan-what' }, h('b', {}, e.title || e.type), detail ? h('div', { class: 'small muted2' }, detail) : null),
      e.expectedAmount ? h('b', { class: 'num plan-amt' }, '見込み ' + yen(e.expectedAmount) + (Number(e.unitPrice) > 0 && Number(e.people) > 0 ? `（${yen(e.unitPrice)} × ${e.people}人）` : '')) : null,
      editable ? h('button', { class: 'btn btn-xs', onclick: () => editItem(e) }, '直す') : null);
  }

  // シフト（予定）。閉店のときに、実績として直せる
  function shiftBox(d, row, editable) {
    const boss = app.settings.managerName;
    const names = [...new Set([...(boss ? [boss] : []), ...st.staff.map(s => s.name), ...splitNames(row?.shiftPlan)])];
    if (!names.length) return h('div', { class: 'small muted2' }, 'シフトは、設定でスタッフを登録すると入れられます。');
    const members = new Set(splitNames(row?.shiftPlan));
    return h('div', { class: 'shift-box' },
      h('div', { class: 'lab' }, 'シフト（予定）'),
      h('div', { class: 'checks' }, names.map(nm => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: members.has(nm), disabled: !editable, onchange: ev => { ev.target.checked ? members.add(nm) : members.delete(nm); } }),
        h('span', {}, nm)))),
      editable ? h('button', {
        class: 'btn btn-sm', onclick: async () => {
          await app.sync.save('days', d, { bizDate: d, shiftPlan: names.filter(x => members.has(x)).join('、') });
          toast('シフトを保存しました');
        }
      }, 'シフトを保存') : null);
  }

  // ===== 一覧 =====
  function list() {
    const items = [
      ...live(st.events).map(e => ({ date: e.date, sort: e.startTime || '', el: () => itemRow(e) })),
      ...st.days.filter(x => x.closed).map(x => ({ date: x.bizDate, sort: '', el: () => h('div', { class: 'plan-item' },
        h('div', { class: 'plan-when' }, h('b', {}, fmtMD(x.bizDate)), h('div', { class: 'small muted2' }, '終日')),
        h('span', { class: 'pbadge gray' }, T_CLOSED), h('div', { class: 'grow plan-what' }, h('b', {}, T_CLOSED))) })),
      ...live(st.requests).map(r => ({ date: r.date, sort: 'z', el: () => h('div', { class: 'plan-item' },
        h('div', { class: 'plan-when' }, h('b', {}, fmtMD(r.date)), h('div', { class: 'small muted2' }, '—')),
        h('span', { class: 'pbadge amber' }, T_REQUEST), h('div', { class: 'grow plan-what' }, h('b', {}, `${r.name} 希望休`))) }))
    ].sort((a, b) => (a.date + a.sort).localeCompare(b.date + b.sort));
    return h('div', { class: 'plan-list' },
      items.length ? items.map(x => x.el()) : h('div', { class: 'empty' }, `${monthLabel(st.month)}の予定はありません。`),
      h('div', { class: 'small muted2' }, '今日の予定は「店内」の入店（イベント）で選べます。'));
  }

  // ===== 予定を足す・直す =====
  function editItem(e) {
    const isNew = !e.id;
    const types = [...(app.settings.eventTypes || []), ...(isNew ? [T_CLOSED, T_REQUEST] : [])];
    let type = e.type || types[0];
    const date = h('input', { class: 'input', type: 'date', value: e.date || today, min: app.auth.isMgr() ? undefined : today });
    const fields = h('div');
    const v = { title: e.title || '', people: e.people ?? '', unitPrice: e.unitPrice ?? '', contactName: e.contactName || '', contactInfo: e.contactInfo || '', expectedAmount: e.expectedAmount ?? '', startTime: e.startTime || '', endTime: e.endTime || '', memo: e.memo || '', name: '' };
    // 見込み＝人数×1人の単価。単価がまだないとき（管理シートから取り込んだ合計の金額など）は、金額のまま
    const unitExpected = () => (Number(v.unitPrice) > 0 && Number(v.people) > 0 ? Number(v.unitPrice) * Number(v.people) : null);
    const expBox = h('div');
    const paintExp = () => put(expBox, unitExpected() != null
      ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, '売上見込み'), h('b', { class: 'num' }, `${yen(unitExpected())}（${yen(v.unitPrice)} × ${v.people}人）`))
      : inp('売上見込み（円。単価が決まっていないとき）', 'expectedAmount', { type: 'number', inputmode: 'numeric', placeholder: '団体の合計。月の目標の「あと」に入ります' }));
    const msg = h('div');
    const inp = (label, key, attrs = {}) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label),
      h('input', { class: 'input', value: String(v[key]), ...attrs, oninput: ev => { v[key] = ev.target.value; } }));
    const paintFields = () => {
      if (type === T_CLOSED) return put(fields, h('p', { class: 'help' }, 'この日を店休日にします。カレンダーに出ます。'));
      if (type === T_REQUEST) {
        const names = st.staff.map(s => s.name);
        return put(fields, h('div', { class: 'field' }, h('div', { class: 'field-label' }, '名前'),
          names.length ? seg(names, v.name, x => { v.name = x; }) : null,
          h('input', { class: 'input', placeholder: names.length ? 'ほかの人（手打ち）' : '名前', oninput: ev => { v.name = ev.target.value; } })));
      }
      put(fields,
        inp('内容', 'title', { placeholder: '例：日本酒の会・町内会' }),
        h('div', { class: 'grid2' }, inp('開始', 'startTime', { type: 'time' }), inp('終了', 'endTime', { type: 'time' })),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, '人数'),
          h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: String(v.people), oninput: ev => { v.people = ev.target.value; paintExp(); } })),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, '1人の単価'), unitPicker(app, v.unitPrice, u => { v.unitPrice = u; paintExp(); })),
        expBox,
        showContact() ? [inp('幹事の名前', 'contactName'), inp('幹事の連絡先', 'contactInfo', { type: 'tel' })] : h('p', { class: 'help' }, '幹事の名前と連絡先は、店長だけが見て入れられます。'),
        inp('メモ', 'memo'));
      paintExp();
    };
    paintFields();
    openSheet(close => [
      h('h2', {}, isNew ? '予定を追加' : '予定を直す'),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '種類'), seg(types, type, t => { type = t; paintFields(); })),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '日付'), date),
      fields, msg,
      h('div', { class: 'btn-row' },
        !isNew ? h('button', { class: 'btn btn-danger', onclick: async () => { close(); await removeEvent(e); } }, '消す') : null,
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            const d = date.value;
            if (d && !canEdit(d) && !(await app.requireMgr('前の日の予定は、店長だけが直せます。店長の暗証番号を押してください。'))) return put(msg, msgBox('前の日の予定は、店長モードで直せます。', true));
            const err = !d ? '日付を選んでください。'
              : !canEdit(d) ? '前の日の予定は、店長モードで直せます。'
                : type === T_REQUEST && !v.name.trim() ? '名前を入れてください。' : '';
            if (err) return put(msg, msgBox(err, true));
            close();
            if (type === T_CLOSED) await setClosed(d, true);
            else if (type === T_REQUEST) { await app.sync.save('requests', uuid(), { date: d, name: v.name.trim(), status: '有効' }); toast('希望休を入れました'); }
            else {
              const data = {
                date: d, type, title: v.title.trim() || type, people: v.people === '' ? null : Number(v.people),
                unitPrice: Number(v.unitPrice) > 0 ? Number(v.unitPrice) : null,
                expectedAmount: unitExpected() ?? (v.expectedAmount === '' ? null : Number(v.expectedAmount)), startTime: v.startTime, endTime: v.endTime,
                memo: v.memo.trim(), status: '有効', ...(showContact() ? { contactName: v.contactName.trim(), contactInfo: v.contactInfo.trim() } : {})
              };
              await app.sync.save('events', e.id || uuid(), data, isNew ? {} : { log: { type: '予定を直す', reason: '', before: e, after: data } });
              toast(isNew ? '予定を追加しました' : '予定を直しました');
            }
            st.selected = d;
            if (d.slice(0, 7) !== st.month) { st.month = d.slice(0, 7); load(); }
          }
        }, '保存'))
    ]);
  }

  async function removeEvent(e) {
    const reason = await pickReason(`「${e.title || e.type}」を消す`, ['日にちが変わった', '取りやめ', '打ち間違い', 'その他']);
    if (!reason) return;
    await app.sync.save('events', e.id, { status: ST_DEL }, { log: { type: '予定を消す', reason, before: e } });
    toast('予定を消しました');
  }

  async function removeRequest(r) {
    await app.sync.save('requests', r.id, { status: ST_DEL }, { log: { type: '希望休を消す', reason: '', before: r } });
    toast('希望休を消しました');
  }

  async function setClosed(d, closed) {
    await app.sync.save('days', d, { bizDate: d, closed }, { log: { type: closed ? '店休日にする' : '店休日をやめる', reason: '', after: { bizDate: d } } });
    toast(closed ? '店休日にしました' : '店休日をやめました');
  }

  // ===== 読み込み =====
  async function load() {
    const [from, to] = monthRange(st.month);
    st.events = await app.store.listRows('events', from, to);
    st.days = await app.store.listRows('days', from, to);
    st.requests = await app.store.listRows('requests', from, to);
    st.staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    paint();
    cd.refresh(st.month);
    Promise.all(['events', 'days', 'requests'].map(t => app.sync.pull(t, from, to))).catch(() => {});
  }

  const off0 = app.sync.onChange(t => { if (['events', 'days', 'requests', 'staff'].includes(t)) reload(); if (['events', 'closings', 'visits'].includes(t)) cd.schedule(); });
  const off = () => { off0(); cd.destroy(); };
  async function reload() {
    const [from, to] = monthRange(st.month);
    st.events = await app.store.listRows('events', from, to);
    st.days = await app.store.listRows('days', from, to);
    st.requests = await app.store.listRows('requests', from, to);
    st.staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    paint();
  }
  load();
  return off;
}
