// GASとのやりとり。text/plainでPOSTして、CORSのプリフライトを避ける。
export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export class NetworkError extends Error {}

/**
 * @param {{url: string, getToken: () => string|null, getDeviceId: () => string, getMgrToken: () => string|null}} cfg
 */
export function createApi(cfg) {
  return async function post(action, body = {}, { timeoutMs = 20000 } = {}) {
    if (!cfg.url) throw new ApiError('no_url', 'GASのURLが設定されていません（config.js）。');
    const payload = { action, token: cfg.getToken(), deviceId: cfg.getDeviceId(), mgrToken: cfg.getMgrToken(), ...body };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        redirect: 'follow'
      });
    } catch (e) {
      throw new NetworkError('通信できませんでした');
    } finally {
      clearTimeout(timer);
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new NetworkError('GASの返事が読めませんでした'); }
    if (json.status !== 'ok') throw new ApiError(json.code || 'error', json.message || 'エラーが起きました');
    return json;
  };
}
