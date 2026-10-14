// 店長モード。暗証番号の照合はGASで行い、ここでは発行された店長トークンを持つだけ。
// 画面側の判定は見た目のため。データを守るのはGAS側の判定。
import { emitter } from './util.js';

const IDLE_MS = 5 * 60e3; // 触らずに5分たったら自動でロック

export function createAuth() {
  const changes = emitter();
  let session = null; // { token, until }
  let idleTimer = null;
  let post = null;

  const set = s => { session = s; changes.emit(!!s); };

  function arm() {
    clearTimeout(idleTimer);
    if (session) idleTimer = setTimeout(() => lock(), IDLE_MS);
  }

  async function login(pin) {
    const r = await post('login', { pin });
    set({ token: r.mgrToken, until: Date.now() + (r.expiresInSec - 60) * 1000 });
    arm();
  }

  function lock() {
    const tok = session?.token;
    clearTimeout(idleTimer);
    set(null);
    if (tok) post('logout', { mgrToken: tok }).catch(() => {});
  }

  function token() {
    if (session && Date.now() > session.until) set(null);
    return session?.token || null;
  }

  return {
    attach(p) { post = p; },
    login, lock, token,
    isMgr: () => !!token(),
    touch: () => { if (session) arm(); },
    onChange: changes.on
  };
}
