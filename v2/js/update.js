// 新しい版の知らせと読み込み直し。
// 新しい版を見つけたら、上に帯を出す。勝手に読み込み直すのは、営業中の事故を避けるため、次の全部を満たすときだけ：
//   開いた直後（または裏から戻った直後。まだ画面に触っていない）・送信待ち0件・入力の途中の画面を開いていない
// 満たさないときは帯だけ出して、押されるまで待つ。送信待ちがあるときに押されたら、送り終わってから読み込み直す。
import { h } from './util.js';

const FRESH_MS = 90e3;        // 開いた直後とみなす長さ（このあいだに新しい版が入ったら、勝手に読み込み直してよい）
const CHECK_EVERY = 30 * 60e3; // 開いたままのときに、新しい版を探す間隔

/** 勝手に読み込み直してよいか（画面から切り離してテストする） */
export function canAutoReload({ fresh, pending, sending, busy, touched, reloadedOnce }) {
  return !!fresh && !pending && !sending && !busy && !touched && !reloadedOnce;
}

/** 帯の文字 */
export function bandText({ waiting, pending, online }) {
  if (!waiting) return '新しい版があります。押すと更新します';
  if (!pending) return '更新しています…';
  return `送信が終わってから更新します（${online ? '' : 'オフライン・'}送信待ち ${pending}件）`;
}

/**
 * @param {{version: string, sync: object, store: object, isBusy: () => boolean, isTouched: () => boolean}} deps
 *   version：今動いている画面の版（config.js の APP_VERSION）
 *   isBusy：入力の途中の画面（パネル・広げた卓）を開いているか
 *   isTouched：今の画面で、何か押したり打ったりしたか（画面を切り替えると戻る）
 */
export function createUpdater({ version, sync, store, isBusy, isTouched, reload = () => location.reload() }) {
  const sw = navigator.serviceWorker;
  const mine = 'v' + version;
  let newVersion = null; // 見つけた新しい版（Service Workerの VERSION）
  let waiting = false;   // 帯が押されて、送り終わるのを待っている
  let freshUntil = 0;
  let unsub = null;

  const band = h('button', { class: 'upd-band', id: 'upd-band', type: 'button', hidden: true, onclick: () => onPress() });
  const paint = () => {
    band.hidden = !newVersion;
    document.body.classList.toggle('has-upd', !!newVersion); // 店内の画面の高さを、帯の分だけ縮める
    band.classList.toggle('waiting', waiting);
    band.textContent = bandText({ waiting, pending: sync.state.pending, online: sync.state.online });
  };

  /** 今の Service Worker の版を聞く（0.23.0 より前の Service Worker は返事をしないので null） */
  function askVersion() {
    const ctl = sw?.controller;
    if (!ctl) return Promise.resolve(null);
    return new Promise(res => {
      const ch = new MessageChannel();
      const t = setTimeout(() => res(null), 3000);
      ch.port1.onmessage = e => { clearTimeout(t); res(e.data || null); };
      try { ctl.postMessage({ type: 'version' }, [ch.port2]); } catch { clearTimeout(t); res(null); }
    });
  }
  /** Service Worker に、画面のファイルを取り直してもらう（取り込みの途中で古いファイルが混ざったとき用） */
  function askRefetch() {
    const ctl = sw?.controller;
    if (!ctl) return Promise.resolve(false);
    return new Promise(res => {
      const ch = new MessageChannel();
      const t = setTimeout(() => res(false), 20e3);
      ch.port1.onmessage = e => { clearTimeout(t); res(!!e.data); };
      try { ctl.postMessage({ type: 'refetch' }, [ch.port2]); } catch { clearTimeout(t); res(false); }
    });
  }

  async function compare() {
    const v = await askVersion();
    if (!v || v === mine) return;
    newVersion = v;
    paint();
    tryAuto();
  }

  async function check() {
    try { await (await sw?.getRegistration())?.update(); } catch { /* つながっていないときは次に */ }
    await compare();
  }

  async function reloadedFor() { try { return (await store.kvGet('updReloadedFor')) === newVersion; } catch { return false; } }

  async function tryAuto() {
    if (!newVersion || waiting) return;
    if (Date.now() > freshUntil) return;
    await sync.refreshCounts().catch(() => {}); // 起動の直後は件数がまだ数えられていないことがある
    const st = sync.state;
    const ok = canAutoReload({
      fresh: Date.now() <= freshUntil, pending: st.pending, sending: st.sending,
      busy: isBusy(), touched: isTouched(), reloadedOnce: await reloadedFor()
    });
    if (!ok) return;
    await store.kvSet('updReloadedFor', newVersion).catch(() => {}); // 1つの版につき1回だけ（読み込み直しても版が変わらないときに、くり返さない）
    reload();
  }

  async function doReload() {
    if (await reloadedFor()) await askRefetch(); // 前に読み込み直しても新しくならなかった：ファイルを取り直してから
    await store.kvSet('updReloadedFor', newVersion).catch(() => {});
    reload();
  }

  function onPress() {
    if (!newVersion) return;
    const st = sync.state;
    if (!st.pending && !st.sending) { waiting = true; paint(); doReload(); return; }
    waiting = true;
    paint();
    sync.flush();
    unsub?.();
    unsub = sync.onStatus(s => {
      paint();
      if (!s.pending && !s.sending) { unsub?.(); unsub = null; doReload(); }
    });
  }

  /** 開いた直後・裏から戻った直後に呼ぶ */
  function opened() {
    freshUntil = Date.now() + FRESH_MS;
    if (newVersion) tryAuto();
    check();
  }

  function start() {
    if (!sw) return band;
    // 画面に触ったら「開いた直後」は終わり（押そうとした瞬間に読み込み直さない）
    document.addEventListener('pointerdown', () => { freshUntil = 0; }, { capture: true, passive: true });
    document.addEventListener('keydown', () => { freshUntil = 0; }, { capture: true });
    sw.addEventListener('controllerchange', compare); // 新しい版の Service Worker が入った
    sync.onStatus(() => { if (newVersion) { paint(); if (!waiting) tryAuto(); } });
    setInterval(check, CHECK_EVERY);
    opened();
    return band;
  }

  return { start, opened, band, state: () => ({ newVersion, waiting }) };
}
