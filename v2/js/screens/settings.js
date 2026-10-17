// 設定画面。開くたびに店長の暗証番号（照合はGAS）。
import { h, put, toast, uuid, yen } from '../util.js';
import { monthLabel } from './common.js';
import { renderPinGate } from './pin.js';

const STAFF_TABLES = [
  ['visits', '来客・会計'], ['closings', '閉店・レジ締め'], ['days', 'シフトの実績・開店時の現金'], ['cashMoves', 'レジの出し入れ'],
  ['events', '予定'], ['requests', '希望休']
];

export function renderSettings(root, app) {
  if (!app.auth.isMgr()) return renderPinGate(root, app, '設定', '設定を開くには、店長の暗証番号を入れてください。');
  // 店長報酬は店長にしか返らない。店長モードになったあと、1回だけ読み直す
  if (app.settings.managerFee === undefined && !app.settingsAsMgr) {
    root.replaceChildren(h('p', { class: 'help' }, '設定を読んでいます…'));
    app.settingsAsMgr = true;
    return app.refreshSettings().catch(() => {}).then(() => { root.replaceChildren(); renderForm(root, app); });
  }
  return renderForm(root, app);
}

// ===== 設定の本体 =====
function renderForm(root, app) {
  const draft = JSON.parse(JSON.stringify(app.settings));
  draft.staffEdit = draft.staffEdit || { days: 0, tables: [] }; // GASが古いときの守り
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg', onclick: save }, '変更を保存');
  const saveBar = h('div', { class: 'save-bar' }, saveBtn);
  // 変更があるときだけ保存のバーを出す
  const dirty = () => { const on = changedKeys().length > 0; saveBar.classList.toggle('show', on); saveBtn.disabled = !on; };
  const changedKeys = () => Object.keys(draft).filter(k => JSON.stringify(draft[k]) !== JSON.stringify(app.settings[k]));

  async function save() {
    const keys = changedKeys();
    if (!keys.length) return;
    saveBtn.disabled = true;
    try {
      const r = await app.post('saveSettings', { settings: Object.fromEntries(keys.map(k => [k, draft[k]])) });
      app.settings = r.settings;
      await app.store.kvSet('settings', r.settings);
      toast('保存しました');
      root.replaceChildren();
      renderForm(root, app);
    } catch (e) {
      toast(app.errorText(e), 'err');
      dirty();
    }
  }

  // --- 入力の部品 ---
  const num = (label, get, set, unit, help) => field(label, help,
    h('div', { class: 'with-unit' },
      h('input', { class: 'input num', type: 'number', inputmode: 'numeric', min: 0, value: String(get() ?? ''),
        oninput: e => { set(e.target.value === '' ? 0 : Number(e.target.value)); dirty(); } }),
      h('span', { class: 'unit' }, unit)));
  const sw = (label, get, set, help) => field(label, help,
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!get(), onchange: e => { set(e.target.checked); dirty(); } }),
      h('span', { class: 'switch-ui' }), h('span', { class: 'switch-text' }, get() ? '見せる' : '見せない')));
  const swOnOff = (label, get, set, help) => field(label, help,
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!get(), onchange: e => { set(e.target.checked); dirty(); e.target.parentNode.querySelector('.switch-text').textContent = e.target.checked ? 'はい' : 'いいえ'; } }),
      h('span', { class: 'switch-ui' }), h('span', { class: 'switch-text' }, get() ? 'はい' : 'いいえ')));

  const v = draft.visibility, tg = draft.targets;
  const page = h('section', { class: 'page settings' },
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, '設定'),
      h('button', { class: 'btn', onclick: () => { app.auth.lock(); toast('ロックしました'); } }, 'ロックする')),

    card('料金と時間',
      num('飲み放題の料金（1人）', () => draft.nomiPrice, x => { draft.nomiPrice = x; }, '円'),
      num('飲み放題の時間', () => draft.nomiMinutes, x => { draft.nomiMinutes = x; }, '分'),
      num('ラストオーダーの知らせ', () => draft.lastOrderMinutes, x => { draft.lastOrderMinutes = x; }, '分前', '飲み放題の残りがこの時間になったら、カードの色を変えます。'),
      num('営業日の切り替え', () => draft.bizDayCutoffHour, x => { draft.bizDayCutoffHour = x; }, '時', 'この時刻より前は、前日の営業日として数えます（例：12なら、深夜1時の会計は前日の営業）。'),
      field('運用開始日（完全移行の日）', 'この日より前の営業日の記録は「試運転」として、集計から外します。月の数字は、この日の前日までは管理シートの数字です。早めるときは、ここを変えます。',
        h('input', { class: 'input', type: 'date', value: draft.goLiveDate, oninput: e => { draft.goLiveDate = e.target.value; dirty(); } }))),

    card('延長', h('p', { class: 'help' }, '料金と時間が決まったら足してください。会計のときに選べるようになります。'),
      extensionsEditor(draft, dirty)),

    card('売上',
      swOnOff('ポイントを売上に含める', () => draft.pointCountsAsSales, x => { draft.pointCountsAsSales = x; })),

    card('バイトが直せる範囲',
      h('p', { class: 'help' }, '店長モードなら、いつの記録でも直せます。設定はいつも店長だけです。'),
      num('さかのぼれる日数', () => draft.staffEdit.days, x => { draft.staffEdit.days = x; }, '日前まで', '0なら、その営業日の記録だけ。先の日付の予定・希望休はいつでも入れられます。'),
      field('バイトが直せる記録', null, h('div', { class: 'checks' }, STAFF_TABLES.map(([key, label]) =>
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: draft.staffEdit.tables.includes(key),
            onchange: e => {
              const set = new Set(draft.staffEdit.tables);
              e.target.checked ? set.add(key) : set.delete(key);
              draft.staffEdit.tables = STAFF_TABLES.map(t => t[0]).filter(k => set.has(k));
              dirty();
            } }),
          h('span', {}, label)))))),

    card('レジの回収と小口現金',
      swOnOff('バイトも、オーナーの回収を入れられる', () => draft.staffCanCollect !== false, x => { draft.staffCanCollect = x; },
        'オーナーがレジから抜いた分（仕入れ・支出には入りません）。いいえにすると、店長だけが入れられます。'),
      num('小口現金の最初の残高', () => draft.pettyCashStart, x => { draft.pettyCashStart = x; }, '円',
        'アプリで小口を使い始める前に、小口にあった金額。わかったら入れてください（入れるまでは0から数えます）。レジの現金・月次には混ぜません。'),
      ),

    card('バイトに見せる範囲',
      h('p', { class: 'help' }, '今日・店内・予定はいつも見せます。分析とその他（勤怠・仕入れ・固定費・設定）は店長だけです。'),
      h('div', { class: 'vis' },
        sw('予定の幹事の連絡先', () => v.eventContact, x => { v.eventContact = x; }),
        sw('月の売上目標までの「あと」（今日の画面）', () => v.countdown !== false, x => { v.countdown = x; }),
        sw('過ぎた日の締めと会計（今日の画面の「過ぎた日を見る」）', () => v.pastDays !== false, x => { v.pastDays = x; }))),

    card('目標',
      num('月の売上（月ごとの目標がない月に使う）', () => tg.monthlySales, x => { tg.monthlySales = x; }, '円'),
      num('1日の来客数', () => tg.dailyGuests, x => { tg.dailyGuests = x; }, '人'),
      num('団体・イベントの月の数', () => tg.monthlyEvents, x => { tg.monthlyEvents = x; }, '件')),

    card('月ごとの売上目標', monthlyTargetsEditor(draft, dirty, app)),

    card('選ぶ項目',
      listEditor('仕入れの項目', draft, 'purchaseCategories', dirty),
      listEditor('予定の種類', draft, 'eventTypes', dirty),
      listEditor('固定費の項目', draft, 'fixedCostItems', dirty),
      listEditor('会計を取り消す理由', draft, 'cancelReasons', dirty),
      listEditor('入店を削除する理由', draft, 'deleteReasons', dirty)),

    card('店長モード',
      num('何もしないまま、この分数たったらバイトの画面に戻る', () => draft.mgrIdleMinutes ?? 10, x => { draft.mgrIdleMinutes = x; }, '分',
        '上の帯の「終わる」でも、いつでも戻れます。アプリが裏に回ったときも戻ります。'),
      ),

    card('店長報酬',
      num('店長報酬（月額）', () => draft.managerFee, x => { draft.managerFee = x; }, '円',
        '月次の支出に入ります（9月・10月の分も同じ金額で計算します）。店長だけが見られます。'),
      ),

    card('スタッフと時給',
      field('店長の名前', 'シフトの選び方（予定・閉店・スプシの月のタブ）に出ます。勤怠の対象ではありません。',
        h('input', { class: 'input', type: 'text', value: draft.managerName || '', oninput: e => { draft.managerName = e.target.value.trim(); dirty(); } })),
      num('時給の初期値', () => draft.defaultWage, x => { draft.defaultWage = x; }, '円', '新しく足すスタッフの時給です。人ごとに変えられます。'),
      staffEditor(app)),

    card('暗証番号を変える', pinChanger(app)),

    saveBar
  );
  // 見せる／見せないの文字も切り替える
  page.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'checkbox' && t.closest('.vis')) t.parentNode.querySelector('.switch-text').textContent = t.checked ? '見せる' : '見せない';
  });
  root.append(page);
}

// 月ごとの売上目標：月を選んで金額を入れる。ない月は「月の売上」を使う（0にすると、その月は決めていない扱い）
function monthlyTargetsEditor(draft, dirty, app) {
  draft.monthlyTargets = draft.monthlyTargets || {};
  const box = h('div', { class: 'targets-ed' });
  const nextMonth = new Date(Date.UTC(Number(app.bizDate().slice(0, 4)), Number(app.bizDate().slice(5, 7)), 1)).toISOString().slice(0, 7);
  const add = { month: nextMonth, amount: '' };
  const paint = () => {
    const keys = Object.keys(draft.monthlyTargets).sort();
    put(box,
      h('p', { class: 'help' }, '月ごとに違う金額を入れられます。入れていない月は、上の「月の売上」を使います。0にすると、その月は決めていない扱いです。今日の画面の「あと」と、予定の画面の月の上に出ます。'),
      keys.map(k => h('div', { class: 'with-unit target-row' },
        h('span', { class: 'tg-month' }, monthLabel(k)),
        h('input', { class: 'input num', type: 'number', inputmode: 'numeric', min: 0, value: String(draft.monthlyTargets[k] ?? ''),
          oninput: e => { draft.monthlyTargets[k] = e.target.value === '' ? 0 : Number(e.target.value); dirty(); } }),
        h('span', { class: 'unit' }, '円'))),
      h('div', { class: 'with-unit target-row' },
        h('input', { class: 'input', type: 'month', value: add.month, 'aria-label': '月', oninput: e => { add.month = e.target.value; } }),
        h('input', { class: 'input num', type: 'number', inputmode: 'numeric', min: 0, placeholder: '金額', 'aria-label': '目標の金額', oninput: e => { add.amount = e.target.value; } }),
        h('span', { class: 'unit' }, '円'),
        h('button', { class: 'btn btn-sm', onclick: () => {
          if (!/^\d{4}-\d{2}$/.test(add.month) || !(Number(add.amount) > 0)) return toast('月と金額を入れてください', 'err');
          draft.monthlyTargets[add.month] = Number(add.amount);
          add.amount = '';
          paint(); dirty();
        } }, '足す')));
  };
  paint();
  return box;
}

function card(title, ...children) {
  return h('div', { class: 'card' }, h('h2', { class: 'card-title' }, title), ...children);
}

function field(label, help, control) {
  return h('div', { class: 'field' },
    h('div', { class: 'field-label' }, label),
    control,
    help ? h('p', { class: 'help' }, help) : '');
}

/** 文字のリスト（追加・削除） */
function listEditor(label, draft, key, dirty) {
  const wrap = h('div', { class: 'chips' });
  const input = h('input', { class: 'input', type: 'text', placeholder: '足す項目' });
  const paint = () => wrap.replaceChildren(...draft[key].map((item, i) =>
    h('span', { class: 'chip' }, item,
      h('button', { class: 'chip-x', 'aria-label': item + 'を消す', onclick: () => { draft[key].splice(i, 1); paint(); dirty(); } }, '×'))));
  const add = () => {
    const val = input.value.trim();
    if (!val || draft[key].includes(val)) return;
    draft[key].push(val);
    input.value = '';
    paint();
    dirty();
  };
  paint();
  return field(label, null, h('div', {}, wrap,
    h('div', { class: 'inline' }, input, h('button', { class: 'btn', onclick: add }, '足す'))));
}

/** 延長の種類（名前・料金・時間） */
function extensionsEditor(draft, dirty) {
  const list = h('div', { class: 'rows' });
  const paint = () => list.replaceChildren(...(draft.extensions.length ? draft.extensions.map((x, i) =>
    h('div', { class: 'row' },
      h('span', { class: 'row-main' }, x.label),
      h('span', {}, `${yen(x.price)} ・ ${x.minutes}分`),
      h('button', { class: 'btn btn-sm', onclick: () => { draft.extensions.splice(i, 1); paint(); dirty(); } }, '消す')))
    : [h('p', { class: 'muted' }, 'まだありません。')]));
  const label = h('input', { class: 'input', type: 'text', placeholder: '名前（例：延長30分）' });
  const price = h('input', { class: 'input num', type: 'number', inputmode: 'numeric', placeholder: '料金（1人・円）' });
  const minutes = h('input', { class: 'input num', type: 'number', inputmode: 'numeric', placeholder: '時間（分）' });
  paint();
  return h('div', {}, list, h('div', { class: 'inline' }, label, price, minutes,
    h('button', {
      class: 'btn', onclick: () => {
        if (!label.value.trim() || !price.value || !minutes.value) { toast('名前・料金・時間を入れてください', 'err'); return; }
        draft.extensions.push({ id: uuid(), label: label.value.trim(), price: Number(price.value), minutes: Number(minutes.value) });
        label.value = price.value = minutes.value = '';
        paint();
        dirty();
      }
    }, '足す')));
}

/** スタッフ（表「スタッフ」に保存。店長モードで送る） */
function staffEditor(app) {
  const list = h('div', { class: 'rows' }, h('p', { class: 'muted' }, '読み込み中…'));
  const paint = async () => {
    const rows = (await app.store.listRows('staff')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    list.replaceChildren(...(rows.length ? rows.map(s =>
      h('div', { class: 'row' },
        h('span', { class: 'row-main' + (s.active === false ? ' muted' : '') }, s.name),
        h('div', { class: 'with-unit' },
          h('input', { class: 'input num sm', type: 'number', inputmode: 'numeric', value: String(s.wage ?? ''),
            onchange: e => app.sync.save('staff', s.id, { wage: Number(e.target.value) || 0 }).then(() => toast(s.name + 'の時給を保存しました')) }),
          h('span', { class: 'unit' }, '円')),
        h('label', { class: 'switch' },
          h('input', { type: 'checkbox', checked: s.active !== false,
            onchange: e => app.sync.save('staff', s.id, { active: e.target.checked }).then(paint) }),
          h('span', { class: 'switch-ui' }), h('span', { class: 'switch-text' }, s.active !== false ? '在籍' : 'やめた'))))
      : [h('p', { class: 'muted' }, 'まだいません。岡本さん（店長）は勤怠の対象外なので、足さなくて大丈夫です。')]));
  };
  const name = h('input', { class: 'input', type: 'text', placeholder: '名前' });
  const add = async () => {
    const n = name.value.trim();
    if (!n) return;
    const rows = await app.store.listRows('staff');
    if (rows.some(r => r.name === n)) { toast('同じ名前の人がいます', 'err'); return; }
    await app.sync.save('staff', uuid(), { name: n, wage: app.settings.defaultWage, active: true, order: rows.length + 1 });
    name.value = '';
    paint();
  };
  app.sync.pull('staff').catch(() => {}).finally(paint);
  return h('div', {}, list, h('div', { class: 'inline' }, name, h('button', { class: 'btn', onclick: add }, 'スタッフを足す')));
}

function pinChanger(app) {
  const a = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', placeholder: '新しい暗証番号（4〜8桁）' });
  const b = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', placeholder: 'もう一度' });
  return h('div', {}, h('div', { class: 'inline' }, a, b,
    h('button', {
      class: 'btn', onclick: async () => {
        if (!/^\d{4,8}$/.test(a.value)) { toast('4〜8桁の数字にしてください', 'err'); return; }
        if (a.value !== b.value) { toast('2つが合っていません', 'err'); return; }
        try {
          await app.post('changePin', { newPin: a.value });
          a.value = b.value = '';
          toast('暗証番号を変えました');
        } catch (e) { toast(app.errorText(e), 'err'); }
      }
    }, '変える')));
}
