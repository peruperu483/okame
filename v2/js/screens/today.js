// 今日（ダッシュボード）
// 売上・来客・いま店内 → 支払い方法・種類 → 精算済みの組（店内に戻す）・レジの出し入れ・閉店とレジ締め
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso, fmtHM, addDays } from '../bizday.js';
import {
  KINDS, METHODS, ST_IN, ST_OUT, ST_DEL, MOVE_IN, MOVE_OUT, MOVE_COLLECT, MOVE_PETTY_PAY,
  label, payLabel, total, methodSums, unitLabel, livePays, markAllDeleted, daySummary, pct, registerCalc, registerEffect, moveLabel, validateMove, closingIsStale
} from '../calc.js';
import { pickReason } from '../ui.js';
import { fmtMD, mountCountdown } from './common.js';
import { canUseLines, cashOutEditor, saveCashOut, editCashOut, pettyCard } from './cashout.js';

const PETTY_FROM = '2026-10-01'; // 小口現金の残高を数えるために読む範囲の始め

const KIND_KEY = { '飲み放題': 'nomi', '単品': 'tanpin', 'イベント': 'event' };
const METHOD_KEY = { '現金': 'cash', 'キャッシュレス': 'cashless', 'ポイント': 'point' };
const SUM_KEYS = ['sales', 'guests', 'groups', 'cash', 'cashless', 'point', 'nomi', 'tanpin', 'event'];
const splitNames = s => String(s || '').split('、').map(x => x.trim()).filter(Boolean);
const signedYen = d => (d === 0 ? '0円' : (d > 0 ? '+' : '−') + yen(Math.abs(d)));
const isInt = v => v !== '' && v != null && Number.isInteger(Number(v));

export function renderToday(root, app) {
  const S = () => app.settings;
  const realDay = () => app.bizDate();
  const day = () => st.date || realDay(); // st.date：前の営業日・過ぎた日を見ているときだけ入る
  const from = () => addDays(day(), -31); // 開店時の現金を引き継ぐために、前の締めを探す範囲
  const st = {
    visits: [], moves: [], closings: [], dayRow: null, staff: [],
    date: null, stale: [], membersKey: null,
    regForm: null, co: null, allMoves: [], rOutKind: '買い出し', rAmt: '', rCat: '飲食物', rNote: '', rReason: 'オーナーの補充', rDate: '', rMsg: '', rBad: false,
    counted: '', members: null, closeMsg: ''
  };

  const staleBox = h('div', { class: 'col-gap' });
  const top = h('div', { class: 'dash-top' });
  const breakdown = h('div', { class: 'dash-two' });
  const doneBox = h('section', { class: 'dcard' });
  const staffBox = h('section', { class: 'dcard' });
  const cd = mountCountdown(app, realDay().slice(0, 7));
  const regBox = h('section', { class: 'dcard' });
  const pettyBox = h('section', { class: 'dcard' });
  const closeBox = h('section', { class: 'dcard' });
  root.append(h('section', { class: 'page dash' },
    staleBox, top, cd.el, breakdown,
    h('div', { class: 'dash-bottom' }, h('div', { class: 'dash-side' }, staffBox, doneBox), h('div', { class: 'dash-side' }, regBox, pettyBox, closeBox))));

  // ===== 上の3枚 =====
  function paintTop(sum) {
    const target = Number(S().targets?.dailyGuests) || 0;
    const left = Math.max(0, target - sum.guests);
    put(top,
      h('div', { class: 'dcard hero' },
        h('div', { class: 'hero-lab' }, st.date ? `${fmtMD(st.date)}の売上（精算済み）` : '今日の売上（精算済み）'),
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

  // ===== 前の営業日の未締め・店内に残った組：気づけるように出して、その日を開いて閉店・精算できるようにする =====
  function openDay(d) {
    Object.assign(st, { date: d, redo: false, counted: '', touched: false, members: null, membersKey: null, membersTouched: false, regForm: null, co: null, closeMsg: '', rMsg: '' });
    load();
    if (d) { // 端末にない日の記録も、GASから読む（読めたら描き直す）
      Promise.all([app.sync.pull('visits', d, d), app.sync.pull('closings', addDays(d, -31), d), app.sync.pull('cashMoves', addDays(d, -31), d), app.sync.pull('days', d, d)])
        .then(() => { if (st.date === d) load(); }).catch(() => {});
    }
    window.scrollTo?.({ top: 0 });
  }
  function paintStale() {
    if (st.date) {
      const ro = !app.canEdit('visits', st.date);
      return put(staleBox, h('div', { class: 'alert warn row-between', role: 'status' },
        h('span', {}, `${fmtMD(st.date)}を見ています。` + (ro ? '見るだけです（直すのは店長。上の「店長モード」から）。' : '')),
        h('button', { class: 'btn btn-sm', onclick: () => openDay(null) }, '今日に戻る')));
    }
    // 過ぎた日の締めと会計を見る（バイトに見せるかは設定「バイトに見せる範囲」）
    const yesterday = addDays(realDay(), -1);
    const picker = h('input', { class: 'input past-date', type: 'date', max: yesterday, value: st.pastPick || yesterday, 'aria-label': '見る日', oninput: e => { st.pastPick = e.target.value; } });
    put(staleBox, st.stale.map(x => h('div', { class: 'alert warn row-between', role: 'alert' },
      h('span', {}, `${fmtMD(x.date)}：` + [x.inStore ? `店内に${x.inStore}組残っています` : '', x.unclosed ? '閉店（レジ締め）がまだです' : ''].filter(Boolean).join('。')
        + (app.canEdit('visits', x.date) ? '' : '（店長に知らせてください。店長モードで直せます）')),
      h('button', { class: 'btn btn-sm', onclick: () => openDay(x.date) }, 'その日を開く'))),
      app.canSee('pastDays') ? h('div', { class: 'past-pick' },
        h('span', { class: 'small muted2' }, '過ぎた日の締めと会計を見る'), picker,
        h('button', { class: 'btn btn-sm', onclick: () => { const d = picker.value; if (d && d <= yesterday) openDay(d); } }, '見る')) : null);
  }

  // ===== 今日の出勤：シフト（予定）。閉店で実績が入ったら実績 =====
  function paintStaff() {
    const row = st.dayRow;
    const actual = splitNames(row?.shiftActual), plan = splitNames(row?.shiftPlan);
    const names = actual.length ? actual : plan;
    const boss = S().managerName;
    const ordered = [...names].sort((a, b) => (a === boss ? 0 : 1) - (b === boss ? 0 : 1));
    put(staffBox,
      h('h2', {}, st.date ? `${fmtMD(st.date)}の出勤` : '今日の出勤'),
      row?.closed ? h('div', { class: 'muted2 pad' }, '今日は店休日です')
        : names.length ? [
          h('div', { class: 'staff-chips' }, ordered.map(nm => h('span', { class: 'staff-chip' }, nm))),
          h('div', { class: 'small muted2' }, actual.length ? '実績（閉店で入れた分）' : 'シフトの予定')]
          : h('div', { class: 'muted2 pad' }, 'まだ入っていません（予定の画面か、閉店のときに入れます）'));
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
          h('div', { class: 'small muted2' }, `${v.kind}` + (unitLabel(v) ? `（${unitLabel(v)}）` : '') + `・${payLabel(v)}`)),
        h('b', { class: 'num' }, yen(total(v))),
        canEdit ? h('button', { class: 'btn btn-xs', onclick: () => undo(v) }, '店内に戻す') : null))
        : h('div', { class: 'muted2 pad' }, 'まだ退店した組はありません'));
  }

  async function undo(v) {
    const reason = await pickReason(`${label(v)}を店内に戻す`, S().cancelReasons, '受け取った分は消えて、もう一度会計します。「操作履歴」に理由と一緒に残ります。');
    if (!reason) return;
    await app.sync.save('visits', v.id, { status: ST_IN, outAt: '', pays: markAllDeleted(v.pays), ...methodSums([]) },
      { log: { type: '会計の取り消し', reason, before: { status: v.status, outAt: v.outAt, pays: livePays(v), total: total(v) } } });
    toast(`${label(v)}を店内に戻しました`);
  }

  // ===== レジの出し入れ =====
  function paintRegister() {
    const mgr = app.auth.isMgr();
    const canEdit = app.canEdit('cashMoves', day());
    const lines = canUseLines(app); // GASが内訳を受け取れる版になってから、出金を「出した額 → 内訳」にする
    const onReg = m => m.type !== MOVE_PETTY_PAY; // 小口から払った分はレジの現金が変わらないので、小口の欄にだけ出す
    const today = st.moves.filter(m => m.bizDate === day() && m.status !== ST_DEL && onReg(m)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const carried = (registerCalc({ day: day(), closings: st.closings, moves: st.moves, dayRow: st.dayRow, cashSales: 0 }).carried || []).filter(onReg);
    const outLabel = lines ? '内訳を入れて出す' : '買い出し';
    const outPick = () => pickBtns([outLabel, 'オーナーが回収'], st.rOutKind === 'オーナーが回収' ? 'オーナーが回収' : outLabel, k => { st.rOutKind = k === 'オーナーが回収' ? k : '買い出し'; paintRegister(); });
    const signedMove = m => { const e = registerEffect(m); return h('b', { class: 'num ' + (e >= 0 ? 'pos' : 'neg') }, (e >= 0 ? '＋' : '−') + yen(Math.abs(e))); };
    const fixBtn = m => (lines && mgr && m.type === MOVE_OUT ? h('button', { class: 'btn btn-xs', onclick: () => editCashOut(app, m) }, '内訳を直す') : null);
    const canCollect = mgr || S().staffCanCollect !== false; // バイトが回収を入れられるかは設定
    const pickBtns = (opts, cur, onPick) => opts.map(o => h('button', { class: 'btn pick' + (cur === o ? ' on' : ''), onclick: () => onPick(o) }, o));
    const amtInput = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '金額', value: st.rAmt, 'aria-label': st.regForm === 'out' ? '出す金額' : '入れる金額', oninput: e => { st.rAmt = e.target.value; } });
    let form = null;
    if (st.regForm === 'out' && st.rOutKind === 'オーナーが回収' && canCollect) {
      form = h('div', { class: 'subform' },
        outPick(),
        h('div', { class: 'small' }, 'オーナーがレジから抜いた分。仕入れ・支出には入りません（レジの「あるはずの現金」からだけ引きます）'),
        amtInput,
        h('input', { class: 'input', type: 'text', placeholder: 'メモ（なくてもよい）', value: st.rNote, 'aria-label': 'メモ', oninput: e => { st.rNote = e.target.value; } }),
        mgr ? [h('label', { class: 'lab' }, '日付（閉店後や休みの日の回収。店長だけ）'),
          h('input', { class: 'input', type: 'date', max: day(), value: st.rDate || day(), oninput: e => { st.rDate = e.target.value; } })] : null,
        h('button', { class: 'btn btn-primary', onclick: () => saveMove(MOVE_COLLECT) }, '回収を記録'));
    } else if (st.regForm === 'out' && lines) {
      if (!st.co) {
        st.co = cashOutEditor(app, {
          onDone: async r => {
            Object.assign(st, { regForm: null, co: null, rBad: false, rMsg: `レジから ${yen(r.amount)} を出しました（内訳：${r.lines.length}行）` });
            await saveCashOut(app, day(), r);
          }
        });
      }
      form = h('div', { class: 'subform' },
        canCollect ? h('div', { class: 'grid2' }, outPick()) : null,
        h('div', { class: 'small' }, '出した額を入れて、何に使ったかを1行ずつ足します。仕入れは仕入れに、スタッフへの支払いは人件費に入ります。レジに戻した分はレジから減りません'),
        st.co.el);
    } else if (st.regForm === 'out') {
      form = h('div', { class: 'subform' },
        canCollect ? h('div', { class: 'grid2' }, outPick()) : null,
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
      carried.length ? h('div', { class: 'small muted2' }, 'このあとの営業日に入れた分（開店時の現金に入っています）') : null,
      carried.map(m => h('div', { class: 'mrow' },
        h('span', { class: 'num muted2 mtime' }, fmtMD(m.bizDate).slice(0, -3)),
        h('span', { class: 'grow' }, moveLabel(m)),
        signedMove(m), fixBtn(m),
        app.canEdit('cashMoves', m.bizDate) ? h('button', { class: 'btn btn-xs danger', onclick: () => delMove(m) }, '消す') : null)),
      today.map(m => h('div', { class: 'mrow' },
        h('span', { class: 'num muted2 mtime' }, fmtHM(m.at)),
        h('span', { class: 'grow' }, moveLabel(m)),
        signedMove(m), fixBtn(m),
        canEdit && (m.type !== MOVE_COLLECT || canCollect) ? h('button', { class: 'btn btn-xs danger', onclick: () => delMove(m) }, '消す') : null)));
    if (lines) put(pettyBox, pettyCard(app, { moves: st.allMoves, day: day(), canEdit }));
    pettyBox.hidden = !lines;
  }

  function toggleForm(f) {
    Object.assign(st, { regForm: st.regForm === f ? null : f, co: null, rOutKind: '買い出し', rAmt: '', rNote: '', rDate: '', rMsg: '' });
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
    // 過ぎた日で締めてある日は、締めたときの数字をそのまま出す（見るだけ。店長は「締め直す」で今の記録から締め直せる）
    if (st.date && closing && !st.redo) {
      const c = closing, y = v => yen(Number(v) || 0);
      return put(closeBox,
        h('h2', {}, `${fmtMD(st.date)}の締め`),
        closingIsStale(c, sum) ? h('div', { class: 'alert warn', role: 'alert' }, '締めたあとに会計が変わっています（下の数字は締めたときのもの）。') : null,
        row('売上', y(c.sales)), row('組数・来客数', `${Number(c.groups) || 0}組・${Number(c.guests) || 0}名`),
        row('現金・キャッシュレス・ポイント', `${y(c.cash)}・${y(c.cashless)}・${y(c.point)}`),
        row('飲み放題・単品・イベント', `${y(c.nomi)}・${y(c.tanpin)}・${y(c.event)}`),
        h('div', { class: 'lab' }, 'レジの計算'),
        row('開店時のレジの現金', y(c.openCash)),
        row('＋ 現金売上', y(c.cash)),
        row('＋ 入金', y(c.cashIn)),
        row('− 出金', y(c.cashOut)),
        row('− 回収（オーナーが抜いた分）', y(c.collected)),
        row('＝ あるはずの現金', y(c.expectedCash), true),
        row('数えた現金', y(c.countedCash)),
        row('差額', signedYen(Number(c.diff) || 0), true),
        h('div', { class: 'small muted2' }, `${fmtHM(c.closedAt)}に閉店` + (st.dayRow?.shiftActual ? `・入った人：${st.dayRow.shiftActual}` : '')),
        h('button', { class: 'btn btn-sm', onclick: async () => { if (!(await app.requireMgr('締め直すのは店長だけです。店長の暗証番号を押してください。'))) return; st.redo = true; paintAll(); } }, canEdit ? '締め直す（店長）' : '店長モードで締め直す'));
    }

    // 開店時のレジの現金：引き継ぎ／手で入れた値／まだない（最初の1回）
    let openLine;
    if (canEdit && (reg.openFrom === 'none' || st.editOpen)) {
      const inp = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：30000', value: st.dayRow?.openCash ?? '' });
      openLine = h('div', { class: 'subform' },
        h('div', { class: 'small' }, reg.openFrom === 'none' ? '開店時のレジの現金を入れてください（最初の1回だけ。次からは前の締めの金額を引き継ぎます）' : '開店時のレジの現金を直す（店長）'),
        h('div', { class: 'inline-add' }, inp, h('button', { class: 'btn btn-primary', onclick: () => saveOpenCash(inp.value) }, '保存')),
        st.editOpen ? h('button', { class: 'btn btn-sm', onclick: () => { st.editOpen = false; paintAll(); } }, 'やめる') : null);
    }
    const memberNames = [...new Set([...(S().managerName ? [S().managerName] : []), ...st.staff.map(x => x.name), ...splitNames(st.dayRow?.shiftActual || st.dayRow?.shiftPlan)])];
    const memberKey = st.dayRow?.shiftActual || st.dayRow?.shiftPlan || '';
    if (st.members == null || (!st.membersTouched && st.membersKey !== memberKey)) { st.members = new Set(splitNames(memberKey)); st.membersKey = memberKey; }
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
      row('＋ 入金' + (canUseLines(app) ? '（小口から戻した分も）' : ''), yen(reg.cashIn)),
      row(canUseLines(app) ? '− 出金（出した額 − レジに戻した分）' : '− 出金（買い出し）', yen(reg.cashOut)),
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
          h('input', { type: 'checkbox', checked: st.members.has(n), onchange: e => { st.membersTouched = true; e.target.checked ? st.members.add(n) : st.members.delete(n); paintAll(); } }),
          h('span', {}, n)))),
        st.dayRow?.shiftPlan ? h('div', { class: 'small muted2' }, `予定：${st.dayRow.shiftPlan}（違っていたら直してください）`) : null] : null,
      canEdit ? h('button', { class: 'btn btn-primary btn-close', disabled: inStore.length > 0 || reg.openCash == null, onclick: () => doClose(sum, reg, closing) }, closing ? '締め直す' : '閉店する')
        : h('button', { class: 'btn btn-sm', onclick: async () => { if (await app.requireMgr('前の日の締めは、店長だけができます。店長の暗証番号を押してください。')) paintAll(); } }, '店長モードで締める'),
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
    await app.sync.save('days', day(), { bizDate: day(), shiftActual: names.join('、') });
    toast(closing ? '締め直しました' : '閉店しました');
  }

  // ===== 描く・読み込む =====
  function paintAll() {
    const sum = daySummary(st.visits.filter(v => v.status !== ST_DEL), S());
    paintStale();
    paintTop(sum);
    paintBreakdown(sum);
    paintStaff();
    paintDone();
    paintRegister();
    paintClose(sum);
  }

  async function load() {
    const real = realDay();
    const recent = await app.store.listRows('visits', addDays(real, -3), real); // 前の営業日の未締めに気づくため、3日前から読む
    st.visits = day() >= addDays(real, -3) ? recent.filter(v => v.bizDate === day()) : await app.store.listRows('visits', day(), day()); // 過ぎた日を見ているとき
    st.allMoves = await app.store.listRows('cashMoves', [PETTY_FROM, from()].sort()[0], real); // 小口現金の残高は全期間で数える
    st.moves = st.allMoves.filter(m => m.bizDate >= from());
    st.closings = await app.store.listRows('closings', from(), real);
    st.stale = [];
    for (let k = 1; k <= 3; k++) {
      const d = addDays(real, -k);
      const vs = recent.filter(v => v.bizDate === d && v.status !== ST_DEL);
      if (!vs.length) continue;
      const inStore = vs.filter(v => v.status === ST_IN).length;
      const unclosed = vs.some(v => v.status === ST_OUT) && !st.closings.some(c => c.bizDate === d);
      if (inStore || unclosed) st.stale.push({ date: d, inStore, unclosed });
    }
    st.dayRow = await app.store.getRow('days', day());
    st.staff = (await app.store.listRows('staff')).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    paintAll();
  }

  const TABLES = ['visits', 'cashMoves', 'closings', 'days', 'staff'];
  const offChange = app.sync.onChange(t => {
    if (TABLES.includes(t)) load();
    if (['visits', 'closings', 'events'].includes(t)) cd.schedule(); // 売上・閉店・予定が変わったら、カウンターも読み直す
  });
  const pullAll = () => Promise.all([
    app.sync.pull('visits', addDays(realDay(), -3), realDay()), app.sync.pull('cashMoves', from(), realDay()),
    app.sync.pull('closings', from(), realDay()), app.sync.pull('days', day(), day())
  ]).catch(() => {});
  const timer = setInterval(() => { pullAll(); if (!document.activeElement?.matches('input')) load(); }, 30e3); // ほかの端末の変更も30秒ごとに取り込む
  const onVisible = () => { if (!document.hidden) pullAll(); };
  document.addEventListener('visibilitychange', onVisible);
  const cdTimer = setInterval(() => cd.refresh(realDay().slice(0, 7)), 120e3);
  cd.refresh();
  load();
  pullAll();
  app.sync.pull('cashMoves', PETTY_FROM, realDay()).catch(() => {}); // 小口現金の残高のため、前の分も1回だけ読む
  return () => { offChange(); clearInterval(timer); clearInterval(cdTimer); cd.destroy(); document.removeEventListener('visibilitychange', onVisible); };
}
