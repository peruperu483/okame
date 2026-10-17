// 店長モード。暗証番号の照合はGASで行い、ここでは発行された店長トークンを持つだけ。
// 画面側の判定は見た目のため。データを守るのはGAS側の判定。
import { emitter } from './util.js';

const IDLE_MIN = 10; // 何もしないまま、この分数たったらバイトの画面に戻る（設定 mgrIdleMinutes で変えられる）

export function createAuth() {
  const changes = emitter();
  let session = null; // { token, until }
  let idleTimer = null;
  let post = null;
  let idleMinutes = () => IDLE_MIN;

  // quiet：入ったあとに画面を作り直さない（操作の途中で暗証番号を聞いたときは、そのまま続きをする）
  const set = (s, quiet = false) => { session = s; api.quiet = quiet; changes.emit(!!s); };

  const idleMs = () => Math.max(1, Number(idleMinutes()) || IDLE_MIN) * 60e3;
  function arm() {
    clearTimeout(idleTimer);
    if (session) idleTimer = setTimeout(() => lock(), idleMs());
  }

  async function login(pin, { quiet = false } = {}) {
    const r = await post('login', { pin });
    set({ token: r.mgrToken, until: Date.now() + (r.expiresInSec - 60) * 1000 }, quiet);
    arm();
  }

  function lock() {
    const tok = session?.token;
    clearTimeout(idleTimer);
    // 店長モードでないときは何もしない（画面を作り直すと、広げた卓や入力中の金額が消えるため）
    if (!session) return;
    set(null);
    if (tok) post('logout', { mgrToken: tok }).catch(() => {});
  }

  function token() {
    if (session && Date.now() > session.until) set(null);
    return session?.token || null;
  }

  const api = {
    quiet: false,
    attach(p, minutes) { post = p; if (minutes) idleMinutes = minutes; },
    login, lock, token,
    isMgr: () => !!token(),
    touch: () => { if (session) arm(); },
    idleMinutes: () => Math.max(1, Number(idleMinutes()) || IDLE_MIN),
    onChange: changes.on
  };
  return api;
}
