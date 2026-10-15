// 今日（ダッシュボード）
// 売上・来客・いま店内 → 支払い方法・種類 → 精算済みの組（店内に戻す）・レジの出し入れ・閉店とレジ締め
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso, fmtHM, addDays } from '../bizday.js';
import {
  KINDS, METHODS, ST_IN, ST_OUT, ST_DEL, MOVE_IN, MOVE_OUT, MOVE_COLLECT,
  label, payLabel, total, methodSums, daySummary, pct, registerCalc, moveLabel, validateMove, closingIsStale
} from '../calc.js';
import { pickReason, seg } from '../ui.js';

const KIND_KEY = { '飲み放題': 'nomi', '単品': 'tanpin', 'イベント': 'event' };
const METHOD_KEY = { '現金': 'cash', 'キャッシュレス': 'cashless', 'ポイント': 'point' };
const SUM_KEYS = ['sales', 'guests', 'groups', 'cash', 'cashless', 'point', 'nomi', 'tanpin', 'event'];
const splitNames = s => String(s || '').split('、').map(x => x.trim()).filter(Boolean);
const signedYen = d => (d === 0 ? '0円' : (d > 0 ? '+' : '−') + yen(Math.abs(d)));
const isInt = v => v !== '' && v != null && Number.isInteger(Number(v));

export function renderToday(root, app) {
  const S = () => app.settings;
  const day = () => app.bizDate();
  const from = () => addDays(day(), -31); // 開店時の現金を引き継ぐために、前の締めを探す範囲
  const st = {
    visits: [], moves: [], closings: [], dayRow: null, staff: [],
    regForm: null, rOutKind: '買い出し', rAmt: '', rCat: '飲食物', rNote: '', rReason: 'オーナーの補充', rDate: '', rMsg: '', rBad: false,
    counted: '', members: null, last: null, closeMsg: ''
  };

  const top = h('div', { class: 'dash-top' });
  const breakdown = h('div', { class: 'dash-two' });
  const doneBox = h('section', { class: 'dcard' });
  const regBox = h('section', { class: 'dcard' });
  const closeBox = h('section', { class: 'dcard' });
  root.append(h('section', { class: 'page dash' },
    top, breakdown,
    h('div', { class: 'dash-bottom' }, doneBox, h('div', { class: 'dash-side' }, regBox, closeBox))));

  // ===== 上の3枚 =====
  function paintTop(sum) {
    const target = Number(S().targets?.dailyGuests) || 0;
    const left = Math.max(0, target - sum.guests);
    put(top,
      h('div', { class: 'dcard hero' },
        h('div', { class: 'hero-lab' }, '今日の売上（精算済み）'),
        h('div', { class: 'hero-big num' }, yen(sum.sales)),
        h('div', { class: 'hero-sub' }, `${sum.groups}組・${sum.guests}名` + (sum.guests ? `　客単価 ${yen(sum.avg)}` : '')),
        h('div', { class: 'hero-note' }, '退店して精算が終わった分だけを足しています')),
      h('div', { class: 'dcard' },
        h('div', { class: 'lab' }, '来客（精算済み）'),
        h('div', { class: 'big38 num' }, sum.guests + '名'),
        target ? [h('div', { class: 'bar' }, h('div', { class: 'bar-in', style: { width: Math.min(100, pct(sum.guests, target)) + '%' } })),
          h('div', { class: 'small' }, left ? `1日の目標 ${target}名まで あと${left}名` : `1日の目標 ${target}名を達成`)] : null),
      h('div', { class: 'dcard col' },
        h('div', { class: 'lab' }, 'いま店内'),
        h('div', { class: 'big30 num' }, `${sum.inStore}組・${sum.inStorePeople}名`),
        h('div', { class: 'small muted2' }, `見込み ${yen(sum.expected)}（退店したら売上に加算）`),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm', onclick: () => app.go('store') }, '店内を見る')));
  }

  // ===== 支払い方法・種類 =====
  function paintBreakdown(sum) {
    const methodTotal = sum.cash + sum.cashless + sum.point;
    const rows = (items, whole) => items.map(([lbl, v]) => h('div', { class: 'brow' },
      h('div', { class: 'brow-top' }, h('span', { class: 'grow' }, lbl), h('span', { class: 'pct' }, pct(v, whole) + '%'), h('b', { class: 'num amt' }, yen(v))),
      h('div', { class: 'bar' }, h('div', { class: 'bar-in', style: { width: pct(v, whole) + '%' } }))));
    put(breakdown,
      h('section', { class: 'dcard' }, h('h2', {}, '支払い方法'), rows(METHODS.map(m => [m, sum[METHOD_KEY[m]]]), methodTotal)),
      h('section', { class: 'dcard' }, h('h2', {}, '種類'), rows(KINDS.map(k => [k, sum[KIND_KEY[k]]]), sum.sales)));
  }

  // ===== 精算済みの組 =====
  function paintDone() {
    const done = st.visits.filter(v => v.status === ST_OUT).sort((a, b) => String(b.outAt).localeCompare(String(a.outAt)));
    const canEdit = app.canEdit('visits', day());
    put(doneBox,
      h('h2', {}, '精算済みの組（新しい順）'),
      done.length ? done.map(v => h('div', { class: 'drow' },
        h('div', { class: 'drow-time num' }, v.outAt ? fmtHM(v.outAt) : ''),
        h('div', { class: 'drow-main' },
          h('div', { class: 'drow-name' }, `${label(v)}　${v.people}名`),
          h('div', { class: 'small muted2' }, `${v.kind}・${payLabel(v)}`)),
        h('b', { class: 'num' }, yen(total(v))),
        canEdit ? h('button', { class: 'btn btn-xs', onclick: () => undo(v) }, '店内に戻す') : null))
        : h('div', { class: 'muted2 pad' }, 'まだ退店した組はありません'));
  }

  async function undo(v) {
    const reason = await pickReason(`${label(v)}を店内に戻す`, S().cancelReasons, '受け取った分は消えて、もう一度会計します。「操作履歴」に理由と一緒に残ります。');
    if (!reason) return;
    await app.sync.save('visits', v.id, { status: ST_IN, outAt: '', pays: [], ...methodSums([]) },
      { log: { type: '会計の取り消し', reason, before: { status: v.status, outAt: v.outAt, pays: v.pays, total: total(v) } } });
    toast(`${label(v)}を店内に戻しました`);
  }

  // ===== レジの出し入れ =====
  function paintRegister() {
    const mgr = app.auth.isMgr();
    const canEdit = app.canEdit('cashMoves', day());
    const today = st.moves.filter(m => m.bizDate === day() && m.status !== ST_DEL).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const canCollect = mgr || S().staffCanCollect !== false; // バイトが回収を入れられるかは設定
    const pickBtns = (opts, cur, onPick) => opts.map(o => h('button', { class: 'btn pick' + (cur === o ? ' on' : ''), onclick: () => onPick(o) }, o));
    const amtInput = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '金額', value: st.rAmt, 'aria-label': st.regForm === 'out' ? '出す金額' : '入れる金額', oninput: e => { st.rAmt = e.target.value; } });
    let form = null;
    if (st.regForm === 'out' && st.rOutKind === 'オーナーが回収' && canCollect) {
      form = h('div', { class: 'subform' },
        h('div', { class: 'grid2' }, pickBtns(['買い出し', 'オーナーが回収'], st.rOutKind, k => { st.rOutKind = k; paintRegister(); })),
        h('div', { class: 'small' }, 'オーナーがレジから抜いた分。仕入れ・支出には入りません（レジの「あるはずの現金」からだけ引きます）'),
        amtInput,
        h('input', { class: 'input', type: 'text', placeholder: 'メモ（なくてもよい）', value: st.rNote, 'aria-label': 'メモ', oninput: e => { st.rNote = e.target.value; } }),
        mgr ? [h('label', { class: 'lab' }, '日付（閉店後や休みの日の回収。店長だけ）'),
          h('input', { class: 'input', type: 'date', max: day(), value: st.rDate || day(), oninput: e => { st.rDate = e.target.value; } })] : null,
        h('button', { class: 'btn btn-primary', onclick: () => saveMove(MOVE_COLLECT) }, '回収を記録'));
    } else if (st.regForm === 'out') {
      form = h('div', { class: 'subform' },
        canCollect ? h('div', { class: 'grid2' }, pickBtns(['買い出し', 'オーナーが回収'], st.rOutKind, k => { st.rOutKind = k; paintRegister(); })) : null,
        h('div', { class: 'small' }, '買い出しなど。仕入れにも「レジから」として自動で入ります'),
        amtInput,
        h('div', { class: 'grid3' }, pickBtns(S().purchaseCategories || ['飲食物', '備品', 'その他'], st.rCat, c => { st.rCat = c; paintRegister(); })),
        st.rCat === 'その他' ? h('input', { class: 'input', type: 'text', placeholder: 'その他の内容（例：花）', value: st.rNote, 'aria-label': 'その他の内容', oninput: e => { st.rNote = e.target.value; } }) : null,
        h('button', { class: 'btn btn-primary', onclick: () => saveMove(MOVE_OUT) }, '出金（買い出し）を記録'));
    } else if (st.regForm === 'in') {
      form = h('div', { class: 'subform' },
        amtInput,
        h('div', { class: 'grid2' }, pickBtns(S().cashInReasons || ['オーナーの補充', 'その他'], st.rReason, r => { st.rReason = r; paintRegister(); })),
        mgr ? [h('label', { class: 'lab' }, '日付（閉店後や休みの日の補充。店長だけ）'),
          h('input', { class: 'input', type: 'date', max: day(), value: st.rDate || day(), oninput: e => { st.rDate = e.target.value; } })] : null,
        h('button', { class: 'btn btn-primary', onclick: () => saveMove(MOVE_IN) }, '入金を記録'));
    }
    put(regBox,
      h('h2', {}, 'レジの出し入れ'),
      canEdit ? h('div', { class: 'grid2' },
        h('button', { class: 'btn pick' + (st.regForm === 'out' ? ' on' : ''), onclick: () => toggleForm('out') }, 'レジから出す'),
        h('button', { class: 'btn pick' + (st.regForm === 'in' ? ' on' : ''), onclick: () => toggleForm('in') }, 'レジに入れる')) : null,
      form,
      st.rMsg ? h('div', { class: 'pay-msg ' + (st.rBad ? 'bad' : 'good'), role: 'status' }, st.rMsg) : null,
      today.map(m => h('div', { class: 'mrow' },
        h('span', { class: 'num muted2 mtime' }, fmtHM(m.at)),
        h('span', { class: 'grow' }, moveLabel(m)),
        h('b', { class: 'num ' + (m.type === MOVE_IN ? 'pos' : 'neg') }, (m.type === MOVE_IN ? '＋' : '−') + yen(m.amount)),
        canEdit && (m.type !== MOVE_COLLECT || canCollect) ? h('button', { class: 'btn btn-xs danger', onclick: () => delMove(m) }, '消す') : null)));
  }

  function toggleForm(f) {
    Object.assign(st, { regForm: st.regForm === f ? null : f, rOutKind: '買い出し', rAmt: '', rNote: '', rDate: '', rMsg: '' });
    paintRegister();
  }

  async function saveMove(type) {
    const m = { type, amount: st.rAmt, category: st.rCat, note: st.rNote.trim() };
    const err = validateMove(m);
    if (err) { Object.assign(st, { rMsg: err, rBad: true }); return paintRegister(); }
    const bizDate = type !== MOVE_OUT && app.auth.isMgr() && st.rDate ? st.rDate : day(); // 閉店後・休みの日の入金と回収は、店長が日付を選べる
    if (bizDate > day()) { Object.assign(st, { rMsg: '先の日付には入れられません。', rBad: true }); return paintRegister(); }
    const id = uuid();
    const amount = Number(st.rAmt);
    const data = type === MOVE_OUT
      ? { bizDate, at: nowIso(), type, amount, category: m.category, note: m.category === 'その他' ? m.note : '', reason: '', purchaseId: 'cm-' + id, status: '有効' }
      : type === MOVE_COLLECT
        ? { bizDate, at: nowIso(), type, amount, category: '', note: m.note, reason: '', purchaseId: '', status: '有効' }
        : { bizDate, at: nowIso(), type, amount, category: '', note: '', reason: st.rReason, purchaseId: '', status: '有効' };
    const when = bizDate !== day() ? `（${bizDate.slice(5).replace('-', '/')}の分）` : '';
    Object.assign(st, {
      regForm: null, rAmt: '', rNote: '', rDate: '', rBad: false,
      rMsg: type === MOVE_OUT ? `出金（買い出し）${yen(amount)} を記録しました（仕入れにも入りました）`
        : type === MOVE_COLLECT ? `オーナーの回収 ${yen(amount)} を記録しました（仕入れ・支出には入りません）` + when
          : `入金 ${yen(amount)} を記録しました` + when
    });
    await app.sync.save('cashMoves', id, data);
  }

  async function delMove(m) {
    Object.assign(st, { rMsg: '消しました（履歴には残ります）', rBad: false });
    await app.sync.save('cashMoves', m.id, { status: ST_DEL }, { log: { type: '出し入れを消す', reason: '', before: m } });
  }

  // ===== 閉店・レジ締め =====
  function paintClose(sum) {
    const closing = st.closings.find(c => c.bizDate === day()) || null;
    const inStore = st.visits.filter(v => v.status === ST_IN);
    const reg = registerCalc({ day: day(), closings: st.closings, moves: st.moves, dayRow: st.dayRow, cashSales: sum.cash });
    const canEdit = app.canEdit('closings', day());
    const mgr = app.auth.isMgr();
    if (st.counted === '' && closing && !st.touched) st.counted = String(closing.countedCash ?? '');
    const row = (k, v, strong) => h('div', { class: 'crow' + (strong ? ' strong' : '') }, h('span', {}, k), h('span', { class: 'num' }, v));

    // 開店時のレジの現金：引き継ぎ／手で入れた値／まだない（最初の1回）
    let openLine;
    if (reg.openFrom === 'none' || st.editOpen) {
      const inp = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：30000', value: st.dayRow?.openCash ?? '' });
      openLine = h('div', { class: 'subform' },
        h('div', { class: 'small' }, reg.openFrom === 'none' ? '開店時のレジの現金を入れてください（最初の1回だけ。次からは前の締めの金額を引き継ぎます）' : '開店時のレジの現金を直す（店長）'),
        h('div', { class: 'inline-add' }, inp, h('button', { class: 'btn btn-primary', onclick: () => saveOpenCash(inp.value) }, '保存')),
        st.editOpen ? h('button', { class: 'btn btn-sm', onclick: () => { st.editOpen = false; paintAll(); } }, 'やめる') : null);
    }
    const memberNames = [...new Set([...(S().managerName ? [S().managerName] : []), ...st.staff.map(x => x.name), ...splitNames(st.dayRow?.shiftActual || st.dayRow?.shiftPlan)])];
    if (st.members == null) st.members = new Set(splitNames(st.dayRow?.shiftActual || st.dayRow?.shiftPlan));
    if (st.last == null) st.last = st.dayRow?.lastActual || st.dayRow?.lastPlan || '';
    const chosen = memberNames.filter(n => st.members.has(n));
    if (!chosen.includes(st.last)) st.last = '';
    const counted = st.counted;
    const diff = counted === '' ? null : Number(counted) - reg.expected;

    put(closeBox,
      h('h2', {}, '閉店・レジ締め'),
      inStore.length ? h('div', { class: 'alert', role: 'alert' }, `店内に${inStore.length}組残っています。全員退店すると閉店できます`) : null,
      closing && (closingIsStale(closing, sum) || Number(closing.cashIn) !== reg.cashIn || Number(closing.cashOut) !== reg.cashOut || Number(closing.collected || 0) !== reg.collected)
        ? h('div', { class: 'alert warn', role: 'alert' }, '閉店のあとに会計やレジの出し入れが変わりました。締め直してください。') : null,
      openLine,
      row('開店時のレジの現金' + (reg.openFrom === 'carry' ? '（前日から引き継ぎ）' : reg.openFrom === 'manual' ? '（手で入れた金額）' : ''), reg.openCash == null ? '—' : yen(reg.openCash)),
      mgr && reg.openFrom !== 'none' && !st.editOpen ? h('button', { class: 'linkbtn', onclick: () => { st.editOpen = true; paintAll(); } }, '開店時の現金を直す') : null,
      row('＋ 今日の現金売上', yen(sum.cash)),
      row('＋ 入金', yen(reg.cashIn)),
      row('− 出金（買い出し）', yen(reg.cashOut)),
      row('− 回収（オーナーが抜いた分）', yen(reg.collected)),
      row('＝ あるはずの現金', yen(reg.expected), true),
      h('label', { class: 'lab', for: 'regCash' }, 'レジの現金（数えた金額）'),
      h('input', {
        id: 'regCash', class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：45000', value: counted,
        oninput: e => { st.counted = e.target.value; st.touched = true; diffEl.replaceWith(diffEl = diffLine(st.counted === '' ? null : Number(st.counted) - reg.expected)); }
      }),
      (diffEl = diffLine(diff)),
      memberNames.length ? [h('div', { class: 'lab' }, '今日入った人'),
        h('div', { class: 'checks' }, memberNames.map(n => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: st.members.has(n), onchange: e => { e.target.checked ? st.members.add(n) : st.members.delete(n); paintAll(); } }),
          h('span', {}, n)))),
        st.dayRow?.shiftPlan ? h('div', { class: 'small muted2' }, `予定：${st.dayRow.shiftPlan}（違っていたら直してください）`) : null,
        h('div', { class: 'lab' }, 'ラストの担当'),
        chosen.length ? seg(chosen, st.last, v => { st.last = v; }) : h('div', { class: 'small muted2' }, '入った人を選ぶと、ここで選べます。')] : null,
      canEdit ? h('button', { class: 'btn btn-primary btn-close', disabled: inStore.length > 0 || reg.openCash == null, onclick: () => doClose(sum, reg, closing) }, closing ? '締め直す' : '閉店する') : h('div', { class: 'small' }, '前の日の締めは、店長モードで直せます。'),
      st.closeMsg ? h('div', { class: 'pay-msg good', role: 'status' }, st.closeMsg) : null,
      closing && !st.closeMsg ? h('div', { class: 'small accent' }, `${fmtHM(closing.closedAt)}に閉店しました（数えた現金 ${yen(closing.countedCash)}・差額 ${signedYen(Number(closing.diff) || 0)}）`) : null,
      h('div', { class: 'small muted2' }, '数えた金額が、次の営業日の開店時の現金になります。'));
  }
  let diffEl = null;
  function diffLine(diff) {
    if (diff == null || Number.isNaN(diff)) return h('div', { class: 'diff' }, 'レジの現金を入れると差額が出ます');
    if (diff === 0) return h('div', { class: 'diff ok' }, '差額なし');
    return h('div', { class: 'diff bad' }, diff > 0 ? `差額 ${yen(diff)} 多い` : `差額 ${yen(-diff)} 足りない`);
  }

  async function saveOpenCash(v) {
    if (!isInt(v) || Number(v) < 0) return toast('金額を入れてください', 'err');
    const before = st.dayRow?.openCash ?? null;
    st.editOpen = false;
    await app.sync.save('days', day(), { bizDate: day(), openCash: Number(v) },
      { log: { type: before == null ? '開店時の現金を入れる' : '開店時の現金を直す', reason: '', before: { openCash: before }, after: { openCash: Number(v) } } });
    toast('開店時の現金を保存しました');
  }

  async function doClose(sum, reg, closing) {
    if (!isInt(st.counted) || Number(st.counted) < 0) return toast('レジの現金（数えた金額）を入れてください', 'err');
    const counted = Number(st.counted);
    const data = {
      bizDate: day(), closedAt: nowIso(),
      ...Object.fromEntries(SUM_KEYS.map(k => [k, sum[k]])),
      openCash: reg.openCash, cashIn: reg.cashIn, cashOut: reg.cashOut, collected: reg.collected, expectedCash: reg.expected,
      countedCash: counted, diff: counted - reg.expected, trial: app.isTrial(day())
    };
    st.closeMsg = `閉店しました。差額 ${signedYen(data.diff)}。数えた ${yen(counted)} が次の営業日の開店時の現金になります`;
    await app.sync.save('closings', day(), data, closing ? { log: { type: '締めのやり直し', reason: '', before: closing, after: data } } : {});
    const names = [...st.members];
    await app.sync.save('days', day(), { bizDate: day(), shiftActual: names.join('、'), lastActual: st.last || '' });
    toast(closing ? '締め直しました' : '閉店しました');
  }

  // ===== 描く・読み込む =====
  function paintAll() {
    const sum = daySummary(st.visits.filter(v => v.status !== ST_DEL), S());
    paintTop(sum);
    paintBreakdown(sum);
    paintDone();
    paintRegister();
    paintClose(sum);
  }

  async function load() {
    st.visits = await app.store.listRows('visits', day(), day());
    st.moves = await app.store.listRows('cashMoves', from(), day());
    st.closings = await app.store.listRows('closings', from(), day());
    st.dayRow = await app.store.getRow('days', day());
    st.staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    paintAll();
  }

  const TABLES = ['visits', 'cashMoves', 'closings', 'days', 'staff'];
  const offChange = app.sync.onChange(t => { if (TABLES.includes(t)) load(); });
  const timer = setInterval(() => { if (!document.activeElement?.matches('input')) load(); }, 30e3);
  load();
  Promise.all([
    app.sync.pull('visits', day(), day()), app.sync.pull('cashMoves', from(), day()),
    app.sync.pull('closings', from(), day()), app.sync.pull('days', day(), day())
  ]).catch(() => {});
  return () => { offChange(); clearInterval(timer); };
}
