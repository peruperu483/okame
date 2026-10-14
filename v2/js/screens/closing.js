// 閉店・レジ締め
// - 店内に組が残っていたら閉店できず、残りの組を出す
// - レジの現金を入れると「レジの現金 − 釣り銭の準備金 − 現金の売上」の差額を出して記録する
// - その日に入った人とラストの担当（実績）を残す。前もって入れた予定があれば、それを最初に選んでおく
import { h, toast, yen } from '../util.js';
import { nowIso, fmtDay, fmtTime } from '../bizday.js';
import { ST_IN, ST_DEL, label, daySummary, cashDiff } from '../calc.js';
import { openSheet, seg, amountInput } from '../ui.js';

const SUM_KEYS = ['sales', 'cash', 'cashless', 'point', 'normal', 'group', 'guests', 'groups'];
const splitNames = s => String(s || '').split('、').map(x => x.trim()).filter(Boolean);
const signedYen = d => (d === 0 ? '0円' : (d > 0 ? '+' : '−') + yen(Math.abs(d)));
const field = (labelText, control, help) => h('div', { class: 'field' },
  h('div', { class: 'field-label' }, labelText), control, help ? h('p', { class: 'help' }, help) : null);

export async function openClosing(app, day) {
  const s = app.settings;
  const visits = (await app.store.listRows('visits', day, day)).filter(v => v.status !== ST_DEL);
  const closing = await app.store.getRow('closings', day);
  const dayRow = await app.store.getRow('days', day);
  const inStore = visits.filter(v => v.status === ST_IN);

  if (inStore.length) {
    openSheet(close => [
      h('h2', {}, 'まだ閉店できません'),
      h('p', {}, `店内に${inStore.length}組残っています。会計するか、入店を削除してから閉店してください。`),
      h('ul', { class: 'plain-list' }, inStore.map(v => h('li', {}, `${label(v)}・${v.people}人（${fmtTime(v.inAt)}入店）`))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: close }, '戻る'))
    ]);
    return;
  }

  const canEdit = app.canEdit('closings', day);
  const sum = daySummary(visits, s);
  const float = Number(s.changeFloat) || 0;
  let drawer = closing?.drawerCash ?? '';

  // --- レジの現金と差額 ---
  const diffEl = h('div', { class: 'diff', 'aria-live': 'polite' });
  const paintDiff = () => {
    if (drawer === '' || drawer == null) { diffEl.className = 'diff'; diffEl.textContent = 'レジの現金を数えて入れてください。'; return; }
    const d = cashDiff(drawer, float, sum.cash);
    diffEl.className = 'diff ' + (d === 0 ? 'ok' : 'warn');
    diffEl.textContent = d === 0 ? '差額 0円（ぴったり）' : `差額 ${signedYen(d)}（${d > 0 ? '多い' : '足りない'}）`;
  };
  const drawerInput = amountInput(drawer, { onInput: x => { drawer = x; paintDiff(); } });
  drawerInput.placeholder = 'レジの現金';
  paintDiff();

  // --- その日に入った人・ラストの担当 ---
  const staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const members = new Set(splitNames(dayRow?.shiftActual || dayRow?.shiftPlan));
  let last = dayRow?.lastActual || dayRow?.lastPlan || '';
  const names = [...new Set([...staff.map(x => x.name), ...members])];
  const lastBox = h('div');
  const paintLast = () => {
    const chosen = names.filter(n => members.has(n));
    if (!chosen.includes(last)) last = '';
    lastBox.replaceChildren(chosen.length ? seg(chosen, last, v => { last = v; }) : h('p', { class: 'muted' }, '入った人を選ぶと、ここで選べます。'));
  };
  const staffBox = names.length
    ? h('div', { class: 'checks' }, names.map(n => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: members.has(n), onchange: e => { e.target.checked ? members.add(n) : members.delete(n); paintLast(); } }),
      h('span', {}, n))))
    : h('p', { class: 'muted' }, 'スタッフは、設定で登録すると選べます。');
  paintLast();

  const memo = h('textarea', { class: 'input textarea', rows: 2, placeholder: 'メモ（あれば）' });
  memo.value = closing?.memo || '';

  const row = (k, v, strong) => h('tr', { class: strong ? 'strong' : '' }, h('th', {}, k), h('td', {}, v));

  async function submit(close) {
    if (drawer === '' || drawer == null || !Number.isFinite(Number(drawer)) || Number(drawer) < 0) {
      toast('レジの現金を入れてください', 'err');
      drawerInput.classList.add('bad');
      return;
    }
    const diff = cashDiff(drawer, float, sum.cash);
    const data = {
      bizDate: day, closedAt: nowIso(),
      ...Object.fromEntries(SUM_KEYS.map(k => [k, sum[k]])),
      drawerCash: Number(drawer), diff, trial: app.isTrial(day), memo: memo.value.trim()
    };
    const opt = closing ? { log: { type: '締めのやり直し', reason: '', before: closing, after: data } } : {};
    await app.sync.save('closings', day, data, opt);
    await app.sync.save('days', day, { bizDate: day, shiftActual: names.filter(n => members.has(n)).join('、'), lastActual: last });
    close();
    toast(`${closing ? '締め直しました' : '閉店しました'}。レジの差額 ${signedYen(diff)}`);
  }

  openSheet(close => [
    h('h2', {}, `${fmtDay(day)}の閉店・レジ締め`),
    closing ? h('p', { class: 'help' }, `${fmtTime(closing.closedAt)}に締めています。もう一度締めると「締めのやり直し」として履歴に残ります。`) : null,
    h('table', { class: 'sum-table' }, h('tbody', {},
      row('売上', yen(sum.sales), true),
      row('現金', yen(sum.cash)),
      row('キャッシュレス', yen(sum.cashless)),
      row(s.pointCountsAsSales === false ? 'ポイント（売上に含めない）' : 'ポイント', yen(sum.point)),
      row('通常', yen(sum.normal)),
      row('団体', yen(sum.group)),
      row('来客数', sum.guests + '人'),
      row('組数', sum.groups + '組'))),
    field('レジの現金', drawerInput,
      float ? `釣り銭の準備金 ${yen(float)} を引いて、現金の売上 ${yen(sum.cash)} と比べます。` : `現金の売上 ${yen(sum.cash)} と比べます。`),
    diffEl,
    field('今日入った人', staffBox, dayRow?.shiftPlan ? `予定：${dayRow.shiftPlan}（違っていたら直してください）` : null),
    field('ラストの担当', lastBox),
    field('メモ', memo),
    canEdit
      ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', { class: 'btn btn-primary', onclick: () => submit(close) }, closing ? '締め直す' : '閉店する'))
      : [h('p', { class: 'help' }, '前の日の締めは、店長モードで直せます。'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, '閉じる'))]
  ], { wide: true });
}
