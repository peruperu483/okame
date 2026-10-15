// 分析（店長だけ）
// - 月次：GASが計算した数字（スプシの「月次」タブと同じ）。つながっているときだけ
// - 傾向：期間（今日・今週・今月・指定）の来客から、端末で計算する（雛形どおり）
import { h, put, toast, yen } from '../util.js';
import { addDays, dowOf } from '../bizday.js';
import { KINDS, ST_OUT, ST_DEL, total, pct, nomiMinutes, fmtHours } from '../calc.js';
import { seg } from '../ui.js';
import { fmtMD, monthLabel, monthNav, monthRange } from './common.js';

const JST_MS = 9 * 3600e3;
const hourOf = iso => { let x = new Date(Date.parse(iso) + JST_MS).getUTCHours(); if (x < 12) x += 24; return x; };
const signedPct = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round((a - b) / b * 100))}%` : '—');

export function renderAna(root, app) {
  const today = app.bizDate();
  const st = { tab: '月次', month: today.slice(0, 7), period: '今月', from: today, to: today, data: null, err: '', loading: false, visits: [] };
  const head = h('div', { class: 'ana-head' });
  const body = h('div', { class: 'col-gap' });
  root.append(h('section', { class: 'page wide' }, head, body));

  function paintHead() {
    put(head,
      h('h1', { class: 'page-title' }, '分析'),
      seg(['月次', '傾向'], st.tab, t => { st.tab = t; paintHead(); st.tab === '月次' ? loadMonthly() : loadTrend(); }),
      h('span', { class: 'grow' }),
      st.tab === '月次'
        ? monthNav(st.month, m => { st.month = m; loadMonthly(); }, { max: today.slice(0, 7) })
        : seg(['今日', '今週', '今月', '指定'], st.period, p => { st.period = p; setPeriod(); paintHead(); loadTrend(); }));
    if (st.tab === '傾向' && st.period === '指定') {
      head.append(h('div', { class: 'inline-add range' },
        h('input', { class: 'input', type: 'date', value: st.from, onchange: e => { st.from = e.target.value; loadTrend(); } }),
        h('span', {}, '〜'),
        h('input', { class: 'input', type: 'date', value: st.to, onchange: e => { st.to = e.target.value; loadTrend(); } })));
    }
  }

  // ===== 月次 =====
  async function loadMonthly() {
    put(body, h('div', { class: 'empty' }, '読み込んでいます…（GASから月次を計算します）'));
    try {
      const r = await app.post('monthly', { month: st.month });
      paintMonthly(r.summary, r.prev);
    } catch (e) {
      put(body, h('div', { class: 'empty' }, '月次を読めませんでした。', h('div', { class: 'small' }, app.errorText(e)),
        h('button', { class: 'btn', onclick: loadMonthly }, 'もう一度')));
    }
  }

  function paintMonthly(s, p) {
    const row = (k, v, cls = '') => h('div', { class: 'crow ' + cls }, h('span', {}, k), h('span', { class: 'num' }, v));
    const bars = (items, whole) => items.map(([k, v]) => h('div', { class: 'brow' },
      h('div', { class: 'brow-top' }, h('span', { class: 'grow' }, k), h('span', { class: 'pct' }, pct(v, whole) + '%'), h('b', { class: 'num amt' }, yen(v))),
      h('div', { class: 'bar' }, h('div', { class: 'bar-in', style: { width: pct(v, whole) + '%' } }))));
    const t = s.target;
    put(body,
      s.legacy ? h('div', { class: 'note' }, 'この月は、管理シートから取り込んだ数字です（「過去の月次」タブ）。') : null,
      h('div', { class: 'dash-top' },
        h('div', { class: 'dcard hero' },
          h('div', { class: 'hero-lab' }, `${monthLabel(s.month)}の売上`),
          h('div', { class: 'hero-big num' }, yen(s.sales)),
          h('div', { class: 'hero-sub' }, `${s.groups}組・${s.guests}名` + (s.guests ? `　客単価 ${yen(s.avgPerGuest)}` : '')),
          h('div', { class: 'hero-note' }, `前月比 ${signedPct(s.sales, p.sales)}（前月 ${yen(p.sales)}）`)),
        h('div', { class: 'dcard' },
          h('div', { class: 'lab' }, '目標'),
          t.monthlySales ? [h('div', { class: 'small' }, `月の売上 ${yen(t.monthlySales)} の ${t.salesRate}%`),
            h('div', { class: 'bar' }, h('div', { class: 'bar-in', style: { width: Math.min(100, t.salesRate) + '%' } }))] : null,
          h('div', { class: 'small' }, `1日の来客 平均 ${t.avgGuestsPerDay}名（目標 ${t.dailyGuests}名）`),
          h('div', { class: 'small' }, `団体・イベント ${t.events}組` + (t.monthlyEvents ? `（目標 ${t.monthlyEvents}件）` : '') + (s.plannedEvents ? `・予定 ${s.plannedEvents}件` : ''))),
        h('div', { class: 'dcard' },
          h('div', { class: 'lab' }, '差し引き'),
          h('div', { class: 'big30 num ' + (s.profit < 0 ? 'neg' : '') }, yen(s.profit)),
          h('div', { class: 'small muted2' }, `売上 ${yen(s.sales)} − 支出 ${yen(s.expenses)}`),
          h('div', { class: 'small muted2' }, '支出に店長報酬を含みます'))),
      h('div', { class: 'dash-two' },
        h('section', { class: 'dcard' }, h('h2', {}, '支払い方法'), bars([['現金', s.cash], ['キャッシュレス', s.cashless], ['ポイント', s.point]], s.cash + s.cashless + s.point)),
        h('section', { class: 'dcard' }, h('h2', {}, '種類'), s.legacy ? h('div', { class: 'small muted2' }, '管理シートには種類の内訳がありません（イベントのみ）。') : null,
          bars(KINDS.map(k => [k, s[{ '飲み放題': 'nomi', '単品': 'tanpin', 'イベント': 'event' }[k]]]), s.sales))),
      h('div', { class: 'dash-two' },
        h('section', { class: 'dcard' }, h('h2', {}, '支出の内訳'),
          row('仕入れ', yen(s.purchaseTotal), 'strong'),
          Object.entries(s.purchases).map(([k, v]) => row('　' + k + (k === 'その他' && s.otherNotes.length ? `（${s.otherNotes.join('・')}）` : ''), yen(v))),
          row('固定費', yen(s.fixedTotal), 'strong'),
          Object.entries(s.fixed).map(([k, v]) => row('　' + k, yen(v))),
          row('人件費', yen(s.laborTotal), 'strong'),
          s.laborFixed.map(x => row(`　${x.name}` + (x.days ? `（${x.days}日・${fmtHours(x.hours)}${x.transport ? '・交通費' + yen(x.transport) : ''}）` : ''), yen(x.cost))),
          row('　人件費（その他）' + (s.laborOthers.names.length ? `（${s.laborOthers.names.join('・')}）` : ''), yen(s.laborOthers.cost)),
          row('店長報酬', yen(s.mgrFee), 'strong'),
          row('支出の合計', yen(s.expenses), 'strong')),
        h('section', { class: 'dcard' }, h('h2', {}, '率と日数'),
          row('人件費率', s.laborRate + '%'),
          row('原価率（飲食物）', s.costRate + '%'),
          row('通常営業の1日平均（イベントを除く）', yen(s.normalDailyAvg)),
          row('営業日数', s.openDays + '日'),
          row('前月比（来客）', signedPct(s.guests, p.guests)))),
      h('div', { class: 'row-between' },
        h('span', { class: 'small muted2' }, '運用開始日より前（試運転）の記録は数えていません。'),
        h('button', {
          class: 'btn', onclick: async e => {
            e.target.disabled = true;
            try { const r = await app.post('buildMonthlySheet'); toast(`スプシの「月次」を作り直しました（${r.months[0]}〜${r.months[r.months.length - 1]}）`); }
            catch (err) { toast(app.errorText(err), 'err'); }
            e.target.disabled = false;
          }
        }, 'スプシの「月次」を作り直す')));
  }

  // ===== 傾向 =====
  function setPeriod() {
    if (st.period === '今日') { st.from = st.to = today; }
    if (st.period === '今週') { const dow = new Date(today + 'T00:00:00Z').getUTCDay(); st.from = addDays(today, -((dow + 6) % 7)); st.to = today; }
    if (st.period === '今月') { st.from = monthRange(today.slice(0, 7))[0]; st.to = today; }
  }

  async function loadTrend() {
    if (st.from > st.to) [st.from, st.to] = [st.to, st.from];
    st.visits = await app.store.listRows('visits', st.from, st.to);
    paintTrend();
    app.sync.pull('visits', st.from, st.to).then(async () => { st.visits = await app.store.listRows('visits', st.from, st.to); if (st.tab === '傾向') paintTrend(); }).catch(() => {});
  }

  function paintTrend() {
    const s = app.settings;
    const done = st.visits.filter(v => v.status === ST_OUT);
    const all = st.visits.filter(v => v.status !== ST_DEL);
    const sales = done.reduce((a, v) => a + total(v), 0);
    const people = done.reduce((a, v) => a + (Number(v.people) || 0), 0);
    const stay = done.filter(v => v.outAt).map(v => (Date.parse(v.outAt) - Date.parse(v.inAt)) / 60e3);
    const over = done.filter(v => v.kind === '飲み放題' && v.outAt && (Date.parse(v.outAt) - Date.parse(v.inAt)) / 60e3 > nomiMinutes(v, s)).length;
    const hours = [18, 19, 20, 21, 22, 23, 24, 25];
    const hc = hours.map(x => all.filter(v => v.inAt && hourOf(v.inAt) === x).length);
    const hmax = Math.max(1, ...hc);
    const kinds = KINDS.map(k => [k, done.filter(v => v.kind === k).reduce((a, v) => a + total(v), 0)]);
    const byDay = {};
    done.forEach(v => { byDay[v.bizDate] = (byDay[v.bizDate] || 0) + total(v); });
    const dows = ['月', '火', '水', '木', '金', '土', '日'].map(w => {
      const days = Object.keys(byDay).filter(d => dowOf(d) === w);
      return [w, days.length ? Math.round(days.reduce((a, d) => a + byDay[d], 0) / days.length) : 0, days.length];
    });
    const dmax = Math.max(1, ...dows.map(x => x[1]));
    const tile = (label, value, note) => h('div', { class: 'dcard' }, h('div', { class: 'lab' }, label), h('div', { class: 'big30 num' }, value), h('div', { class: 'small muted2' }, note || ''));
    put(body,
      h('div', { class: 'small muted2' }, `${fmtMD(st.from)}〜${fmtMD(st.to)}・精算済みの組から計算${all.some(v => v.trial) ? '（試運転の記録も含みます）' : ''}`),
      h('div', { class: 'grid4' },
        tile('売上', yen(sales), `${done.length}組・${people}名`),
        tile('客単価', people ? yen(sales / people) : '—', '売上÷来客数'),
        tile('1組の平均人数', done.length ? (people / done.length).toFixed(1) + '名' : '—', stay.length ? `平均の滞在 ${Math.round(stay.reduce((a, b) => a + b, 0) / stay.length)}分` : ''),
        tile('飲み放題の時間超過', over + '組', '時間（延長を含む）を過ぎて退店した組')),
      h('div', { class: 'dash-two' },
        h('section', { class: 'dcard' }, h('h2', {}, '時間帯別の入店（組）'), h('div', { class: 'small muted2' }, '何時台に客が来ているか'),
          h('div', { class: 'hbars' }, hours.map((x, i) => h('div', { class: 'hbar' },
            h('b', { class: 'small' }, String(hc[i])),
            h('div', { class: 'hbar-in' + (hc[i] ? '' : ' zero'), style: { height: Math.max(4, Math.round(hc[i] / hmax * 120)) + 'px' } }),
            h('span', { class: 'small muted2' }, (x >= 24 ? x - 24 : x) + '時'))))),
        h('section', { class: 'dcard' }, h('h2', {}, '売上の内訳'),
          kinds.map(([k, v]) => h('div', { class: 'brow' },
            h('div', { class: 'brow-top' }, h('span', { class: 'grow' }, k), h('b', { class: 'num amt' }, yen(v))),
            h('div', { class: 'bar' }, h('div', { class: 'bar-in', style: { width: pct(v, sales) + '%' } })))))),
      h('section', { class: 'dcard' }, h('h2', {}, '曜日別の平均（1日の売上）'),
        h('div', { class: 'hbars' }, dows.map(([w, v, n]) => h('div', { class: 'hbar' },
          h('b', { class: 'small' }, v ? yen(v) : ''),
          h('div', { class: 'hbar-in' + (v ? '' : ' zero'), style: { height: Math.max(4, Math.round(v / dmax * 120)) + 'px' } }),
          h('span', { class: 'small muted2' }, `${w}（${n}日）`))))),
      h('div', { class: 'small muted2' }, 'あとで足すもの：イベント別の売上、前年比。'));
  }

  setPeriod();
  paintHead();
  loadMonthly();
}
