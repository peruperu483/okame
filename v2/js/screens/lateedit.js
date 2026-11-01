// 過ぎた日の売上を、店長があとから足す・直す・取り消す（打ち忘れ・金額や人数や支払い方法の間違い）
// - 店長モードのときだけ。直せる範囲は今月と先月まで（GASも断る）。GASが 0.21.0 になってから使える
// - 足す・直す・取り消すたびに、その日の締めの売上の内訳を今の記録から計算し直す。数えた現金は変えず、
//   現金売上の増減を「あとから直した分」に積んで、差額を出し直す（calc.js の lateClosingPatch）
// - 操作履歴：種別（過ぎた日の売上を足す／直す／取り消す）・理由・直す前と後（日・名前・種類・人数・合計・支払い）
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso, timeOnBizDay } from '../bizday.js';
import {
  KINDS, KIND_NOMI, KIND_REGULAR, KIND_EVENT, KIND_TANPIN, METHODS, ST_OUT, ST_DEL, REGULAR_PRICES,
  regularUnit, isUnitEvent, eventPeople, extrasTotal, total, label, nextNo, daySummary,
  lateVisitPatch, lateClosingPatch, lateSnap, inLateRange, LATE_VERSION, LATE_REASONS
} from '../calc.js';
import { openSheet, pickReason, seg, stepper } from '../ui.js';
import { unitPicker, fmtMD } from './common.js';
import { verGte } from './cashout.js';

/**
 * この日を、あとから足したり直したりできるか
 * 'ok' / 'staff'（店長モードではない）/ 'old-gas'（GASの貼り替え前）/ 'range'（先月より前・今日以降）
 */
export function lateEditState(app, date) {
  if (!date || !verGte(app.serverVersion, LATE_VERSION)) return 'old-gas';
  if (!app.auth.isMgr()) return 'staff';
  return inLateRange(date, app.bizDate()) ? 'ok' : 'range';
}

/** 締めてある日なら、売上の内訳・あるはずの現金・差額を計算し直す（数えた現金は変えない） */
export async function recloseDay(app, date) {
  let closing = await app.store.getRow('closings', date);
  if (!closing) { // 端末にまだ読み込んでいない締めがあるかもしれない
    try { await app.sync.pull('closings', date, date); } catch { /* つながっていなければ、そのまま */ }
    closing = await app.store.getRow('closings', date);
  }
  if (!closing) return false; // まだ締めていない日は、閉店のときに今の記録で締める
  const visits = (await app.store.listRows('visits', date, date)).filter(v => v.status !== ST_DEL);
  const patch = lateClosingPatch(closing, daySummary(visits, app.settings));
  if (!patch) return false;
  const keys = ['sales', 'guests', 'groups', 'cash', 'cashless', 'point', 'nomi', 'tanpin', 'event', 'regular', 'expectedCash', 'countedCash', 'diff', 'lateAdjust'];
  const before = Object.fromEntries(keys.map(k => [k, closing[k] ?? 0]));
  await app.sync.save('closings', date, patch, {
    log: { type: '締めを計算し直す（あとから直した分）', reason: 'あとから売上を直したため', before, after: { ...before, ...patch, countedCash: closing.countedCash } }
  });
  return true;
}

/**
 * 組を足す（visit なし）・直す・取り消すパネルを開く。保存したら true で解決する
 */
export function openLateVisit(app, { date, visit = null }) {
  const S = app.settings || {};
  const isNew = !visit;
  const unitEv = !!visit && isUnitEvent(visit);
  const extras = visit ? extrasTotal(visit) : 0;
  const regPrices = S.regularPrices || REGULAR_PRICES;
  const defaultUnit = kind => (kind === KIND_NOMI ? Number(S.nomiPrice) || 3000 : '');
  const s = {
    kind: visit ? visit.kind : KIND_NOMI,
    name: visit?.name || '',
    people: visit ? (unitEv ? eventPeople(visit) : Number(visit.people) || 1) : 2,
    unit: '',
    total: visit ? String(total(visit)) : '',
    totalTouched: false,
    pays: visit ? (visit.pays || []).filter(p => p && !p.del).map(p => ({ method: p.method, amount: String(p.amount) })) : [{ method: '現金', amount: '' }],
    paysTouched: !!visit,
    time: '21:00',
    msg: ''
  };
  if (visit) {
    if (visit.kind === KIND_NOMI) s.unit = Number(visit.people) ? Math.round(Number(visit.base) / Number(visit.people)) || defaultUnit(KIND_NOMI) : defaultUnit(KIND_NOMI);
    else if (visit.kind === KIND_REGULAR) s.unit = regularUnit(visit) || '';
    else if (unitEv) s.unit = Number(visit.unitPrice);
  } else s.unit = defaultUnit(s.kind);

  const hasUnitField = () => s.kind === KIND_NOMI || s.kind === KIND_REGULAR || (s.kind === KIND_EVENT && (isNew || unitEv));
  const autoTotal = () => {
    const u = Number(s.unit) || 0;
    return hasUnitField() && u > 0 ? s.people * u + extras : null;
  };

  const totalInput = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：170000', 'aria-label': '合計金額', value: s.total,
    oninput: e => { s.total = e.target.value; s.totalTouched = true; refresh(false); }
  });
  const unitBox = h('div', { class: 'field' });
  const paysBox = h('div', { class: 'late-pays' });
  const statusEl = h('div', { class: 'late-status', role: 'status' });
  const saveBtn = h('button', { class: 'btn btn-primary', onclick: save }, '保存');

  function paintUnit() {
    unitBox.hidden = !hasUnitField();
    if (unitBox.hidden) return;
    const onUnit = u => { s.unit = u; refresh(true); };
    if (s.kind === KIND_NOMI) {
      put(unitBox, h('div', { class: 'field-label' }, '1人の料金（金額＝人数×料金）'),
        h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: String(s.unit), 'aria-label': '1人の料金', oninput: e => onUnit(e.target.value === '' ? '' : Number(e.target.value)) }));
    } else if (s.kind === KIND_REGULAR) {
      put(unitBox, h('div', { class: 'field-label' }, '1人の料金（金額＝人数×料金）'), unitPicker(app, s.unit, onUnit, regPrices));
    } else {
      put(unitBox, h('div', { class: 'field-label' }, '1人の単価（金額＝人数×単価）'), unitPicker(app, s.unit, onUnit));
    }
  }

  function paintPays() {
    put(paysBox, s.pays.map((p, i) => h('div', { class: 'lp-row' },
      h('select', {
        class: 'input lp-method', 'aria-label': '支払い方法',
        onchange: e => { p.method = e.target.value; s.paysTouched = true; refresh(false); }
      }, METHODS.map(m => h('option', { value: m, selected: p.method === m }, m))),
      h('input', {
        class: 'input lp-amt', type: 'number', inputmode: 'numeric', placeholder: '金額', 'aria-label': '受け取った金額', value: p.amount,
        oninput: e => { p.amount = e.target.value; s.paysTouched = true; refresh(false, true); }
      }),
      s.pays.length > 1 ? h('button', { class: 'btn btn-xs danger', onclick: () => { s.pays.splice(i, 1); s.paysTouched = true; refresh(false); } }, '消す') : null)),
    h('button', { class: 'btn btn-sm', onclick: () => { s.pays.push({ method: '現金', amount: '' }); s.paysTouched = true; paintPays(); } }, '＋ 支払いを足す（分けて受け取った）'));
  }

  const input = () => ({ kind: s.kind, name: s.name, people: s.people, unit: s.unit, total: s.total, pays: s.pays, inAt: timeOnBizDay(date, s.time, S.bizDayCutoffHour ?? 12) });

  /** keepPays：受け取りの金額の欄に打っている最中は、欄を作り直さない */
  function refresh(fromUnitOrPeople, keepPays = false) {
    if (fromUnitOrPeople && !s.totalTouched) {
      const a = autoTotal();
      if (a != null) { s.total = String(a); totalInput.value = s.total; }
    }
    if (!s.paysTouched) s.pays = [{ method: s.pays[0]?.method || '現金', amount: s.total }];
    if (!keepPays) paintPays();
    const res = lateVisitPatch(visit, input(), S, uuid, nowIso());
    const paid = s.pays.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    put(statusEl,
      h('div', { class: 'row-between' }, h('span', {}, '合計金額 ／ 受け取り'), h('b', { class: 'num' }, `${yen(Number(s.total) || 0)} ／ ${yen(paid)}`)),
      h('div', { class: 'co-msg ' + (res.ok ? 'ok' : 'bad') }, res.ok ? '合っています。「保存」を押してください' : res.error));
    saveBtn.disabled = !res.ok;
  }

  async function save() {
    const res = lateVisitPatch(visit, input(), S, uuid, nowIso());
    if (!res.ok) return;
    const reason = await pickReason(isNew ? 'この組を足す理由' : `${label(visit)}を直す理由`, LATE_REASONS, '操作履歴に、日・直す前と後の内容と一緒に残ります。');
    if (!reason) return; // 選ばなかったら、パネルはそのまま
    done = true;
    close();
    if (isNew) {
      const id = uuid();
      const all = await app.store.listRows('visits', date, date);
      const inAt = input().inAt;
      const v = {
        bizDate: date, no: nextNo(all), kind: s.kind, inAt, endAt: '', status: ST_OUT, outAt: inAt, extras: [], eventId: '', trial: app.isTrial(date), ...res.patch
      };
      await app.sync.save('visits', id, v, { log: { type: '過ぎた日の売上を足す', reason, before: null, after: lateSnap(v) } });
      toast(`${fmtMD(date)}に ${label(v)}（${v.people}名・${yen(v.total)}）を足しました`);
    } else {
      await app.sync.save('visits', visit.id, res.patch, { log: { type: '過ぎた日の売上を直す', reason, before: lateSnap(visit), after: lateSnap({ ...visit, ...res.patch }) } });
      toast(`${label(visit)}を直しました`);
    }
    await recloseDay(app, date);
  }

  async function cancelGroup() {
    const reason = await pickReason(`${label(visit)}を取り消す`, LATE_REASONS, '売上から外れます。記録は消えず、操作履歴に残ります。');
    if (!reason) return;
    done = true;
    close();
    await app.sync.save('visits', visit.id, { status: ST_DEL }, { log: { type: '過ぎた日の売上を取り消す', reason, before: lateSnap(visit), after: { bizDate: date, status: ST_DEL } } });
    toast(`${label(visit)}を取り消しました`);
    await recloseDay(app, date);
  }

  let done = false;
  let close = () => {};
  return new Promise(resolve => {
    close = openSheet(c => [
      h('h2', {}, isNew ? `${fmtMD(date)}に組を足す` : `${label(visit)}を直す（${fmtMD(date)}）`),
      h('p', { class: 'help' }, '店長があとから直します。この日の締めの数字は自動で計算し直し、数えた現金は変えません。操作履歴に残ります。'),
      isNew ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, '種類'),
        seg(KINDS, s.kind, k => {
          s.kind = k; s.unit = defaultUnit(k); s.totalTouched = false; s.total = ''; totalInput.value = '';
          paintUnit(); refresh(true);
        }, { size: 'lg' })) : null,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '名前（空でもよい）'),
        h('input', { class: 'input', type: 'text', maxlength: 20, value: s.name, placeholder: '苗字か仮名', oninput: e => { s.name = e.target.value; } })),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '人数'),
        stepper(s.people, { min: unitEv ? 0 : 1, max: 99, onChange: v => { s.people = v; refresh(true); } })),
      unitBox,
      isNew ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, '入店した時刻（並び順に使います）'),
        h('input', { class: 'input', type: 'time', value: s.time, oninput: e => { s.time = e.target.value || '21:00'; } })) : null,
      extras > 0 ? h('div', { class: 'help' }, `追加・延長が ${yen(extras)} 入っています（そのまま残します）。合計金額は、追加・延長を含めた金額です。`) : null,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '合計金額'), totalInput,
        h('p', { class: 'help' }, '人数×料金から自動で入ります。違う金額のときは、ここを打ち直します。')),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, '支払い方法と受け取った金額'), paysBox),
      statusEl,
      h('div', { class: 'btn-row' },
        !isNew ? h('button', { class: 'btn btn-danger', onclick: cancelGroup }, 'この組を取り消す') : null,
        h('button', { class: 'btn', onclick: c }, 'やめる'),
        saveBtn)
    ], { wide: true, onClose: () => resolve(done) });
    paintUnit();
    refresh(!visit); // 足すときは、人数×料金を入れる。直すときは、今の金額のまま
  });
}
