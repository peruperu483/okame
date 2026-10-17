// レジから出す（出した額 → 内訳）と、小口現金
// 内訳：仕入れ（科目・メモ）／スタッフへの支払い（名前）／小口へ／レジに戻す。内訳の合計が出した額と合ったら決定できる
// レジから減るのは「出した額 − レジに戻す分」。仕入れ・スタッフへの支払いは、GASが仕入れ・勤怠（手打ち）に写す
import { h, put, toast, uuid, yen } from '../util.js';
import { nowIso } from '../bizday.js';
import {
  LINE_BUY, LINE_STAFF, LINE_PETTY, LINE_BACK, MOVE_OUT, MOVE_PETTY_PAY, MOVE_PETTY_BACK, ST_DEL,
  checkLines, lineLabel, moveLines, moveLabel, pettyEffect, pettyBalance
} from '../calc.js';
import { openSheet } from '../ui.js';
import { fmtMD } from './common.js';

const KIND_NAME = { [LINE_BUY]: '仕入れ', [LINE_STAFF]: 'スタッフへの支払い', [LINE_PETTY]: '小口へ', [LINE_BACK]: 'レジに戻す' };
const toNum = v => (v === '' || v == null ? '' : Number(v));

/** GASが内訳を受け取れる版か（古いGASに送ると内訳が消えるため、それまでは前の入力のまま） */
export const canUseLines = app => verGte(app.serverVersion, '0.18.0');
function verGte(v, want) {
  const a = String(v || '0').split('.').map(Number), b = want.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; }
  return true;
}

/** 内訳を保存する形にそろえる（金額は数、ID を付ける） */
const cleanLines = lines => lines.map(l => ({
  id: l.id || uuid(), kind: l.kind, amount: Number(l.amount),
  ...(l.kind === LINE_BUY ? { category: l.category, note: String(l.note || '').trim() } : {}),
  ...(l.kind === LINE_STAFF ? { name: String(l.name || '').trim() } : {})
}));

/**
 * 出した額と内訳の入力欄。el をそのまま置く（描き直しても入力は消えない）
 * @param {{amount?: number|string, lines?: object[], doneLabel?: string, onDone: (r: {amount: number, lines: object[]}) => any, onCancel?: () => any}} o
 */
export function cashOutEditor(app, { amount = '', lines = [], doneLabel = '決定', onDone, onCancel }) {
  const cats = app.settings?.purchaseCategories || ['飲食物', '備品', 'その他'];
  const st = { amt: String(amount ?? ''), lines: lines.map(l => ({ ...l, amount: String(l.amount ?? '') })) };
  const el = h('div', { class: 'co' });
  const statusEl = h('div', { class: 'co-status', role: 'status' });
  const restBtn = h('button', { class: 'btn btn-sm', onclick: restToPetty }, '残りを小口へ');
  const doneBtn = h('button', { class: 'btn btn-primary', onclick: done }, doneLabel);

  function paintStatus() {
    const c = checkLines(st.amt, st.lines);
    put(statusEl,
      h('div', { class: 'row-between' }, h('span', {}, '内訳の合計'), h('b', { class: 'num' }, `${yen(c.sum)} ／ 出した額 ${yen(Number(st.amt) || 0)}`)),
      h('div', { class: 'co-msg ' + (c.ok ? 'ok' : 'bad') }, c.ok ? '合っています。「' + doneLabel + '」を押してください' : c.error));
    restBtn.hidden = !(c.diff > 0 && Number(st.amt) > 0);
    restBtn.textContent = `残り ${yen(Math.max(0, c.diff))} を小口へ`;
    doneBtn.disabled = !c.ok;
  }

  function restToPetty() {
    const c = checkLines(st.amt, st.lines);
    if (!(c.diff > 0)) return;
    const p = st.lines.find(l => l.kind === LINE_PETTY);
    if (p) p.amount = String((Number(p.amount) || 0) + c.diff);
    else st.lines.push({ id: uuid(), kind: LINE_PETTY, amount: String(c.diff) });
    paint();
  }

  function addLine(kind) {
    const c = checkLines(st.amt, st.lines);
    st.lines.push({ id: uuid(), kind, amount: c.diff > 0 && !st.lines.length ? String(c.diff) : '', category: kind === LINE_BUY ? cats[0] : undefined });
    paint();
  }

  function lineBox(l) {
    const amt = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '金額', value: l.amount, 'aria-label': `${KIND_NAME[l.kind]}の金額`, oninput: e => { l.amount = e.target.value; paintStatus(); } });
    return h('div', { class: 'co-line' },
      h('div', { class: 'row-between' }, h('b', {}, KIND_NAME[l.kind]),
        h('button', { class: 'btn btn-xs danger', onclick: () => { st.lines = st.lines.filter(x => x !== l); paint(); } }, '消す')),
      l.kind === LINE_BUY ? [
        h('div', { class: 'grid3' }, cats.map(c => h('button', { class: 'btn pick' + (l.category === c ? ' on' : ''), onclick: () => { l.category = c; paint(); } }, c))),
        h('input', { class: 'input', type: 'text', maxlength: 30, value: l.note || '', placeholder: l.category === 'その他' ? '内容（必ず。例：花）' : 'メモ（なくてもよい。例：酒屋）', 'aria-label': '仕入れのメモ', oninput: e => { l.note = e.target.value; paintStatus(); } })] : null,
      l.kind === LINE_STAFF ? h('input', { class: 'input', type: 'text', maxlength: 20, value: l.name || '', placeholder: '名前（例：一日ママ・単発のスタッフ）', 'aria-label': '支払った人の名前', oninput: e => { l.name = e.target.value; paintStatus(); } }) : null,
      amt);
  }

  function paint() {
    put(el,
      h('label', { class: 'lab' }, 'レジから出した額'),
      h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '例：2000', value: st.amt, 'aria-label': 'レジから出した額', oninput: e => { st.amt = e.target.value; paintStatus(); } }),
      h('div', { class: 'lab' }, '内訳（1行ずつ足す）'),
      st.lines.map(lineBox),
      h('div', { class: 'co-add' }, [LINE_BUY, LINE_STAFF, LINE_PETTY, LINE_BACK].map(k => h('button', { class: 'btn btn-sm', onclick: () => addLine(k) }, '＋' + KIND_NAME[k]))),
      statusEl,
      restBtn,
      h('div', { class: 'btn-row' }, onCancel ? h('button', { class: 'btn', onclick: onCancel }, 'やめる') : null, doneBtn));
    paintStatus();
  }

  async function done() {
    const c = checkLines(st.amt, st.lines);
    if (!c.ok) return paintStatus();
    doneBtn.disabled = true;
    await onDone({ amount: Number(st.amt), lines: cleanLines(st.lines) });
  }

  paint();
  return { el };
}

/** 新しい出金を保存する */
export async function saveCashOut(app, bizDate, { amount, lines }) {
  const buy = lines.find(l => l.kind === LINE_BUY);
  await app.sync.save('cashMoves', uuid(), {
    bizDate, at: nowIso(), type: MOVE_OUT, amount, lines,
    category: buy ? buy.category : '', note: '', reason: '', purchaseId: '', status: '有効'
  });
}

/** 店長が出金の内訳を直す */
export function editCashOut(app, m) {
  openSheet(close => {
    const ed = cashOutEditor(app, {
      amount: m.amount, lines: moveLines(m).map(l => ({ ...l, id: l.id === 'old' ? '' : l.id })), doneLabel: '直す', onCancel: close,
      onDone: async r => {
        close();
        const buy = r.lines.find(l => l.kind === LINE_BUY);
        await app.sync.save('cashMoves', m.id, { amount: r.amount, lines: r.lines, category: buy ? buy.category : '' },
          { log: { type: '出金の内訳を直す', reason: '', before: { amount: m.amount, lines: moveLines(m) }, after: r } });
        toast('内訳を直しました');
      }
    });
    return [h('h2', {}, '出金の内訳を直す'), ed.el];
  }, { wide: true });
}

// ===== 小口現金 =====

/** 今日の画面の「小口現金」の欄。moves は全期間の出し入れ */
export function pettyCard(app, { moves, day, canEdit }) {
  const start = Number(app.settings?.pettyCashStart) || 0;
  const bal = pettyBalance(moves, start);
  return [
    h('h2', {}, '小口現金'),
    h('div', { class: 'row-between' }, h('span', {}, '残高'), h('b', { class: 'num big20' }, yen(bal))),
    h('div', { class: 'small muted2' }, app.settings?.pettyCashStart ? `最初の残高 ${yen(start)}（設定）から数えています。レジの現金とは別です` : '最初の残高はまだ入っていません（0から数えています。店長が設定で入れます）。レジの現金とは別です'),
    canEdit ? h('div', { class: 'grid2' },
      h('button', { class: 'btn btn-sm', onclick: () => pettyPay(app, day) }, '小口から払う'),
      h('button', { class: 'btn btn-sm', onclick: () => pettyBack(app, day, bal) }, '小口からレジに戻す')) : null,
    h('button', { class: 'linkbtn', onclick: () => pettyList(app, moves, start) }, '入った・出た記録を見る')
  ];
}

function pettyPay(app, day) {
  const cats = app.settings?.purchaseCategories || ['飲食物', '備品', 'その他'];
  const l = { kind: LINE_BUY, category: cats[0], note: '', name: '', amount: '' };
  openSheet(close => {
    const box = h('div', { class: 'co' });
    const msg = h('div', { class: 'co-msg bad', role: 'status' });
    const paint = () => put(box,
      h('div', { class: 'grid2' }, [LINE_BUY, LINE_STAFF].map(k => h('button', { class: 'btn pick' + (l.kind === k ? ' on' : ''), onclick: () => { l.kind = k; paint(); } }, KIND_NAME[k]))),
      l.kind === LINE_BUY ? [
        h('div', { class: 'grid3' }, cats.map(c => h('button', { class: 'btn pick' + (l.category === c ? ' on' : ''), onclick: () => { l.category = c; paint(); } }, c))),
        h('input', { class: 'input', type: 'text', maxlength: 30, value: l.note, placeholder: l.category === 'その他' ? '内容（必ず。例：花）' : 'メモ（なくてもよい）', 'aria-label': 'メモ', oninput: e => { l.note = e.target.value; } })]
        : h('input', { class: 'input', type: 'text', maxlength: 20, value: l.name, placeholder: '名前', 'aria-label': '名前', oninput: e => { l.name = e.target.value; } }),
      h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: l.amount, placeholder: '金額', 'aria-label': '金額', oninput: e => { l.amount = e.target.value; } }),
      msg,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            const c = checkLines(l.amount, [l]);
            if (!c.ok) { msg.textContent = c.error.replace('出した額', '金額'); return; }
            close();
            const lines = cleanLines([l]);
            await app.sync.save('cashMoves', uuid(), { bizDate: day, at: nowIso(), type: MOVE_PETTY_PAY, amount: lines[0].amount, lines, category: l.kind === LINE_BUY ? l.category : '', note: '', reason: '', purchaseId: '', status: '有効' });
            toast(`小口から ${yen(lines[0].amount)} 払いました`);
          }
        }, '払う')));
    paint();
    return [h('h2', {}, '小口から払う'), h('p', { class: 'help' }, 'レジの現金は変わりません。仕入れ・スタッフへの支払いとして月次にも入ります。'), box];
  });
}

function pettyBack(app, day, bal) {
  openSheet(close => {
    const inp = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '金額', 'aria-label': '金額' });
    const msg = h('div', { class: 'co-msg bad', role: 'status' });
    return [h('h2', {}, '小口からレジに戻す'), h('p', { class: 'help' }, `小口の残高 ${yen(bal)}。戻した分は、レジの「あるはずの現金」に足されます。`), inp, msg,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            const a = Number(inp.value);
            if (!Number.isInteger(a) || a <= 0) { msg.textContent = '金額を入れてください。'; return; }
            close();
            await app.sync.save('cashMoves', uuid(), { bizDate: day, at: nowIso(), type: MOVE_PETTY_BACK, amount: a, category: '', note: '', reason: '', purchaseId: '', status: '有効' });
            toast(`小口から ${yen(a)} をレジに戻しました`);
          }
        }, '戻す'))];
  });
}

function pettyList(app, moves, start) {
  const rows = moves.filter(m => m.status !== ST_DEL && pettyEffect(m) !== 0)
    .sort((a, b) => String(b.bizDate).localeCompare(String(a.bizDate)) || String(b.at).localeCompare(String(a.at)));
  openSheet(close => [
    h('h2', {}, '小口現金の記録（新しい順）'),
    h('div', { class: 'row-between' }, h('span', {}, '残高'), h('b', { class: 'num' }, yen(pettyBalance(moves, start)))),
    rows.length ? rows.map(m => {
      const e = pettyEffect(m);
      const canDel = m.type !== MOVE_OUT && app.canEdit('cashMoves', m.bizDate);
      return h('div', { class: 'mrow' },
        h('span', { class: 'num muted2 mtime' }, fmtMD(m.bizDate).slice(0, -3)),
        h('span', { class: 'grow' }, m.type === MOVE_OUT ? 'レジから出した分を小口へ' : moveLabel(m)),
        h('b', { class: 'num ' + (e > 0 ? 'pos' : 'neg') }, (e > 0 ? '＋' : '−') + yen(Math.abs(e))),
        canDel ? h('button', {
          class: 'btn btn-xs danger', onclick: async () => {
            close();
            await app.sync.save('cashMoves', m.id, { status: ST_DEL }, { log: { type: '小口の記録を消す', reason: '', before: m } });
            toast('消しました（履歴には残ります）');
          }
        }, '消す') : null);
    }) : h('div', { class: 'muted2 pad' }, 'まだ記録はありません'),
    h('div', { class: 'small muted2' }, `最初の残高 ${yen(start)}。「レジから出した分を小口へ」は、今日の画面のレジの出し入れで直します。`),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, '閉じる'))
  ]);
}
