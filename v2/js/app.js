// アプリの外枠：起動・初回のつなぎ込み・ナビ・送信状態・画面の切り替え
import { GAS_URL, APP_VERSION } from '../config.js';
import { $, h, toast, uuid } from './util.js';
import { bizDateOf, fmtDay, isTrial, addDays } from './bizday.js';
import { idbStore } from './store.js';
import { createApi, ApiError, NetworkError } from './api.js';
import { createSync } from './sync.js';
import { createAuth } from './auth.js';
import { renderSettings } from './screens/settings.js';
import { renderPlaceholder } from './screens/placeholder.js';

const later = (title, when) => (root) => renderPlaceholder(root, title, when);

// access: open=いつでも / 設定の見せる範囲のキー / settings=暗証番号
const SCREENS = [
  { id: 'visits', label: '来客・会計', access: 'open', render: later('来客・会計', '試運転（10月最後の週）までに作ります。') },
  { id: 'events', label: '予定', access: 'open', render: later('予定', '11月の第1週に足します。') },
  { id: 'purchases', label: '仕入れ', access: 'open', render: later('仕入れ', '11月の第2週に足します。') },
  { id: 'attendance', label: '勤怠', access: 'attendance', render: later('勤怠', '11月の第2週に足します。') },
  { id: 'fixedCosts', label: '固定費', access: 'fixedCosts', render: later('固定費', '11月の第2週に足します。') },
  { id: 'monthly', label: '月次', access: 'monthly', render: later('月次', '11月の第3週に足します。') },
  { id: 'settings', label: '設定', access: 'settings', render: renderSettings }
];

export const TABLE_LABELS = {
  visits: '来客', closings: '締め', days: '営業日', staff: 'スタッフ', attendance: '勤怠',
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
app.canSee = access => access === 'open' || access === 'settings' || auth.isMgr() || app.settings?.visibility?.[access] !== false;
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
  setInterval(renderTopDay, 60e3);

  $('#app').replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-day', id: 'top-day' }),
      h('div', { class: 'topbar-right' },
        h('button', { class: 'sync-pill', id: 'sync-pill', onclick: openDevicePanel }),
        h('span', { id: 'mgr-slot' }))),
    h('nav', { class: 'nav', id: 'nav' }),
    h('main', { class: 'main', id: 'main' })
  );
  renderChrome();
  route();
  sync.refreshCounts();
  sync.flush();
  app.refreshSettings().catch(() => {});
}

// ===== 外枠 =====
function renderChrome() {
  if (!$('#nav')) return;
  renderTopDay();
  $('#nav').replaceChildren(...SCREENS.filter(s => app.canSee(s.access)).map(s =>
    h('button', { class: 'nav-btn' + (current === s.id ? ' active' : ''), onclick: () => { location.hash = s.id; } }, s.label)));
  $('#mgr-slot').replaceChildren(auth.isMgr()
    ? h('button', { class: 'mgr-pill', onclick: () => { auth.lock(); toast('ロックしました'); } }, '店長モード・ロックする')
    : '');
  renderSyncStatus(sync.state);
}

function renderTopDay() {
  const el = $('#top-day');
  if (!el) return;
  const d = app.bizDate();
  el.replaceChildren(h('span', {}, fmtDay(d) + 'の営業'), app.isTrial(d) ? h('span', { class: 'badge' }, '試運転') : '');
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
  pill.textContent = text;
}

function route() {
  const id = location.hash.slice(1) || 'visits';
  const screen = SCREENS.find(s => s.id === id && app.canSee(s.access)) || SCREENS[0];
  if (typeof cleanup === 'function') cleanup();
  current = screen.id;
  const main = $('#main');
  main.replaceChildren();
  main.scrollTop = 0;
  cleanup = screen.render(main, app);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.textContent === screen.label));
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
      msg.textContent = 'つないでいます…';
      app.token = tok;
      try {
        const r = await post('bootstrap');
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
