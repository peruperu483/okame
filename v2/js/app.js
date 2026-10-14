// アプリの外枠：起動・初回のつなぎ込み・ナビ・送信状態・画面の切り替え
import { GAS_URL, APP_VERSION } from '../config.js';
import { $, h, toast, uuid } from './util.js';
import { bizDateOf, fmtDay, isTrial, addDays, nowIso } from './bizday.js';
import { idbStore } from './store.js';
import { createApi, ApiError, NetworkError } from './api.js';
import { createSync } from './sync.js';
import { createAuth } from './auth.js';
import { renderPlaceholder } from './screens/placeholder.js';
import { renderPinGate } from './screens/pin.js';
import { renderMore } from './screens/more.js';
import { renderStore } from './screens/store.js';
import { renderToday } from './screens/today.js';

const later = (title, when) => (root) => renderPlaceholder(root, title, when);

// メニュー（雛形どおりの順）。lock=暗証番号（店長だけ）
const SCREENS = [
  { id: 'today', label: '今日', render: renderToday },
  { id: 'store', label: '店内', render: renderStore },
  { id: 'plan', label: '予定', render: later('予定', '11月の第1週に作ります。店内の入店で、今日の予定から選べるようになります。') },
  { id: 'ana', label: '分析', lock: true, render: later('分析', '11月の月次と一緒に作ります。') },
  { id: 'more', label: 'その他', lock: true, render: renderMore }
];

const LOCK_ICON = '<svg aria-label="鍵つき" role="img" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

export const TABLE_LABELS = {
  visits: '来客', closings: '締め', cashMoves: 'レジの出し入れ', days: '営業日', staff: 'スタッフ', attendance: '勤怠',
  purchases: '仕入れ', fixedCosts: '固定費', events: '予定', requests: '希望休', log: '操作履歴'
};

const store = idbStore();
const auth = createAuth();
const app = { store, auth, settings: null, token: null, deviceId: null, version: APP_VERSION, gasUrl: GAS_URL };
const post = createApi({ url: GAS_URL, getToken: () => app.token, getDeviceId: () => app.deviceId, getMgrToken: () => auth.token() });
auth.attach(post);
const sync = createSync({ store, post, getDeviceId: () => app.deviceId, getMgrToken: () => auth.token() });
Object.assign(app, { post, sync });

app.bizDate = () => bizDateOf(new Date(), app.settings?.bizDayCutoffHour ?? 12);
app.isTrial = (d = app.bizDate()) => isTrial(d, app.settings?.goLiveDate);
/** 項目ごとの見せる範囲（今は予定の幹事の連絡先だけ） */
app.canSee = key => auth.isMgr() || app.settings?.visibility?.[key] !== false;
app.setTitle = t => { const el = $('#top-title'); if (el) el.textContent = t; };
app.go = hash => { location.hash = hash; };
/** 直してよいか（GASの staffCanWrite_ と同じ判定。守りはGAS、こちらはボタンを出すかどうか） */
app.canEdit = (table, date) => {
  if (auth.isMgr()) return true;
  const se = app.settings?.staffEdit || {};
  if (!(se.tables || []).includes(table)) return false;
  if (!date) return true;
  const min = addDays(app.bizDate(), -(Number(se.days) || 0));
  return String(date) >= min.slice(0, Math.min(String(date).length, 10));
};
app.refreshSettings = async () => {
  const r = await post('bootstrap');
  app.settings = r.settings;
  await store.kvSet('settings', r.settings);
  renderChrome();
  return r;
};
app.errorText = e => (e instanceof NetworkError ? '通信できませんでした。つながっているか確かめてください。' : e.message);

let cleanup = null;
let current = null;

async function start() {
  app.deviceId = (await store.kvGet('deviceId')) || uuid();
  await store.kvSet('deviceId', app.deviceId);
  app.token = await store.kvGet('token');
  app.settings = await store.kvGet('settings');
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

  if (!GAS_URL) return showMessage('GASのURLが入っていません', 'config.js の GAS_URL にデプロイのURLを入れてください。');
  if (!app.token || !app.settings) return showSetup();
  boot();
}

function boot() {
  document.addEventListener('pointerdown', () => auth.touch(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) auth.lock();
    else { app.refreshSettings().catch(() => {}); sync.flush(); renderChrome(); }
  });
  window.addEventListener('online', () => sync.flush());
  window.addEventListener('hashchange', route);
  auth.onChange(() => { renderChrome(); route(); });
  sync.onStatus(renderSyncStatus);
  setInterval(renderTopDay, 15e3);

  $('#app').replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'top-title', id: 'top-title' }),
      h('div', { class: 'topbar-day', id: 'top-day' }),
      h('div', { class: 'topbar-right' },
        h('button', { class: 'sync-pill', id: 'sync-pill', onclick: openDevicePanel }),
        h('span', { class: 'top-lock', id: 'top-lock' }),
        h('div', { class: 'clock', id: 'clock' }))),
    h('nav', { class: 'nav', id: 'nav', 'aria-label': 'メニュー' }),
    h('main', { class: 'main', id: 'main' })
  );
  renderChrome();
  route();
  sync.refreshCounts();
  sync.flush();
  app.refreshSettings().catch(() => {});
  sync.pull('staff').catch(() => {}); // 閉店のときに選ぶスタッフ
}

// ===== 外枠 =====
function renderChrome() {
  if (!$('#nav')) return;
  renderTopDay();
  const mgr = auth.isMgr();
  const lockBtn = () => h('button', { class: 'btn btn-sm lock-btn', onclick: () => { auth.lock(); toast('ロックしました'); } }, '店長ロック');
  $('#nav').replaceChildren(
    h('div', { class: 'brand' }, 'お香芽'),
    ...SCREENS.map(s => {
      const btn = h('button', { class: 'nav-btn' + (current === s.id ? ' active' : ''), 'data-id': s.id, onclick: () => app.go(s.id) },
        h('span', {}, s.label));
      if (s.lock && !mgr) btn.insertAdjacentHTML('beforeend', LOCK_ICON);
      return btn;
    }),
    h('div', { class: 'nav-space' }),
    mgr ? lockBtn() : '');
  $('#top-lock').replaceChildren(mgr ? lockBtn() : '');
  renderSyncStatus(sync.state);
}

function renderTopDay() {
  const el = $('#top-day');
  if (!el) return;
  const d = app.bizDate();
  el.replaceChildren(h('span', {}, '営業日 ' + fmtDay(d).replace('(', '（').replace(')', '）')),
    app.isTrial(d) ? h('span', { class: 'badge' }, '試運転') : '');
  $('#clock').textContent = nowIso().slice(11, 16);
}

function renderSyncStatus(st) {
  const pill = $('#sync-pill');
  if (!pill) return;
  let text = '送信済み', kind = 'ok';
  if (st.failed) { text = `送れなかった ${st.failed}件`; kind = 'err'; }
  else if (!st.online) { text = st.pending ? `オフライン・送信待ち ${st.pending}件` : 'オフライン'; kind = 'warn'; }
  else if (st.pending) { text = (st.sending ? '送信中… ' : '送信待ち ') + st.pending + '件'; kind = 'warn'; }
  else if (st.lastError) { text = 'エラー'; kind = 'err'; }
  pill.className = 'sync-pill ' + kind;
  pill.replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), text);
}

/** #id または #id/sub（例：#more/settings）。最初の画面は「今日」 */
function route() {
  const [id, sub] = (location.hash.slice(1) || 'today').split('/');
  const screen = SCREENS.find(s => s.id === id) || SCREENS[0];
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  current = screen.id;
  const main = $('#main');
  main.replaceChildren();
  main.scrollTop = 0;
  app.setTitle(screen.label);
  if (screen.lock && !auth.isMgr()) renderPinGate(main, app, '店長の暗証番号', `「${screen.label}」は店長だけが開けます。暗証番号を入れてください。`);
  else cleanup = screen.render(main, app, sub);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.id === screen.id));
}

// ===== この端末（送信の状態） =====
async function openDevicePanel() {
  const failed = await store.failedList();
  const st = sync.state;
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet' },
      h('h2', {}, 'この端末の送信'),
      h('dl', { class: 'kv' },
        h('dt', {}, '送信待ち'), h('dd', {}, st.pending + '件'),
        h('dt', {}, '送れなかった'), h('dd', {}, failed.length + '件'),
        h('dt', {}, '最後に送れた時刻'), h('dd', {}, st.lastOkAt ? st.lastOkAt.slice(5, 16).replace('T', ' ') : '—'),
        st.lastError ? [h('dt', {}, '最後のエラー'), h('dd', {}, st.lastError)] : ''),
      failed.length ? h('div', {},
        h('p', { class: 'help' }, '次の記録はGASに断られました。店長モードでもう一度送ると通ることがあります。'),
        h('ul', { class: 'plain-list' }, failed.map(f =>
          h('li', {}, `${TABLE_LABELS[f.table] || f.table}（${(f.at || '').slice(5, 16).replace('T', ' ')}）：${f.code}`)))) : '',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: close }, '閉じる'),
        failed.length ? h('button', { class: 'btn', onclick: async () => { await sync.retryFailed(); close(); } }, 'もう一度送る') : '',
        h('button', { class: 'btn btn-primary', onclick: async () => { await sync.flush(); close(); toast(sync.state.pending ? 'まだ送れていません' : '送りました'); } }, '今すぐ送る')),
      h('p', { class: 'fine' }, `版 ${APP_VERSION} ・ 端末 ${app.deviceId.slice(0, 8)}`)));
  document.body.append(overlay);
}

// ===== 初回：共有トークンを入れてGASにつなぐ =====
function showSetup() {
  const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: '共有トークン' });
  const msg = h('p', { class: 'help' });
  const btn = h('button', {
    class: 'btn btn-primary btn-lg', onclick: async () => {
      const tok = input.value.trim();
      if (!tok) { msg.textContent = '共有トークンを入れてください。'; return; }
      btn.disabled = true;
      msg.textContent = 'つないでいます…（GASが混んでいると20秒ほどかかります）';
      app.token = tok;
      try {
        // 1回目が通信の失敗なら、もう一度だけ自動でつなぐ
        const r = await post('bootstrap').catch(e => {
          if (!(e instanceof NetworkError)) throw e;
          msg.textContent = 'もう一度つないでいます…';
          return post('bootstrap');
        });
        await store.kvSet('token', tok);
        await store.kvSet('settings', r.settings);
        app.settings = r.settings;
        boot();
      } catch (e) {
        app.token = null;
        msg.textContent = e instanceof ApiError && e.code === 'unauthorized' ? '共有トークンが違います。' : app.errorText(e);
        btn.disabled = false;
      }
    }
  }, 'つなぐ');
  $('#app').replaceChildren(h('div', { class: 'center-page' },
    h('h1', {}, 'お香芽 業務アプリ'),
    h('p', {}, 'はじめに、この端末をスプシにつなぎます。スプシのメニュー「お香芽 → 共有トークンを表示」に出る文字を入れてください。'),
    input, btn, msg));
}

function showMessage(title, body) {
  $('#app').replaceChildren(h('div', { class: 'center-page' }, h('h1', {}, title), h('p', {}, body)));
}

start();
