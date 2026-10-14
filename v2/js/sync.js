// 送信待ちの仕組み。入力はまず端末に保存し、送信待ちに積んで、つながったら古い順に送る。
// GASはIDで上書きするので、同じものを何度送っても1件にしかならない（途中で切れても送り直してよい）。
import { emitter, uuid } from './util.js';
import { nowIso } from './bizday.js';
import { NetworkError } from './api.js';

const BATCH = 50;
// GASに断られたら送り直しても通らないもの
const PERMANENT = new Set(['bad_table', 'bad_op', 'forbidden']);

/**
 * @param {{store: object, post: Function, getDeviceId: () => string, getMgrToken: () => string|null}} deps
 */
export function createSync({ store, post, getDeviceId, getMgrToken }) {
  const changes = emitter();   // 記録が変わった（表の名前）
  const status = emitter();    // 送信の状態
  let state = { pending: 0, failed: 0, online: true, sending: false, lastOkAt: null, lastError: '', lastErrorCode: '' };
  let flushing = null;
  let timer = null;

  const setState = patch => { state = { ...state, ...patch }; status.emit(state); };
  const refreshCounts = async () => setState({ pending: await store.outboxCount(), failed: (await store.failedList()).length });

  /** 記録を保存する（端末へ → 送信待ちへ）。patchにない項目は今の値を残す */
  async function save(table, id, patch, { log } = {}) {
    const now = nowIso();
    const cur = await store.getRow(table, id);
    const row = { ...(cur || {}), ...patch, id, createdAt: cur?.createdAt || now, updatedAt: now, deviceId: getDeviceId() };
    await store.putRow(table, row);
    await store.outboxAdd({ opId: uuid(), table, id, data: row, mgrToken: getMgrToken(), at: now });
    if (log) {
      const entry = { id: uuid(), at: now, table, targetId: id, deviceId: getDeviceId(), ...log };
      await store.outboxAdd({ opId: entry.id, table: 'log', id: entry.id, data: entry, mgrToken: getMgrToken(), at: now });
    }
    changes.emit(table);
    await refreshCounts();
    schedule(300);
    return row;
  }

  /** 送信待ちを送る。同時に2本は走らせない */
  function flush() {
    if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
    return flushing;
  }

  async function doFlush() {
    setState({ sending: true });
    try {
      for (;;) {
        const ops = await store.outboxPeek(BATCH);
        if (!ops.length) break;
        // 店長として積んだものは、その時の店長トークンで送る
        const token = ops[0].mgrToken || null;
        const group = ops.filter(o => (o.mgrToken || null) === token);
        const res = await post('sync', {
          mgrToken: token || getMgrToken(),
          ops: group.map(({ opId, table, id, data }) => ({ opId, table, id, data }))
        });
        const byOp = new Map(res.results.map(r => [r.opId, r]));
        const done = [];
        const touched = new Set();
        for (const op of group) {
          const r = byOp.get(op.opId);
          if (!r) continue;
          if (r.ok) {
            if (r.stale && r.current) { await store.putRow(op.table, r.current); touched.add(op.table); }
            done.push(op.seq);
          } else if (PERMANENT.has(r.code)) {
            await store.failedAdd({ ...op, code: r.code, failedAt: nowIso() });
            done.push(op.seq);
          }
        }
        await store.outboxDelete(done);
        touched.forEach(t => changes.emit(t));
        if (!done.length) break; // 進まないときは無限に回さない
      }
      setState({ online: true, lastOkAt: nowIso(), lastError: '', lastErrorCode: '' });
    } catch (e) {
      setState({ online: !(e instanceof NetworkError), lastError: e.message, lastErrorCode: e.code || '' });
    } finally {
      await refreshCounts();
      setState({ sending: false });
      if (state.pending) schedule(state.lastError ? 20000 : 5000);
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
    timer?.unref?.(); // Nodeのテストで終了を妨げない
  }

  function stop() { clearTimeout(timer); }

  /** GASから読み込んで端末にそろえる。送信待ちがある記録は端末のほうを正とする */
  async function pull(table, from, to) {
    const { rows } = await post('fetch', { table, from, to });
    let changed = false;
    for (const row of rows) {
      if (await store.outboxHasKey(table, row.id)) continue;
      const cur = await store.getRow(table, row.id);
      if (cur && cur.updatedAt && row.updatedAt && Date.parse(row.updatedAt) < Date.parse(cur.updatedAt)) continue;
      await store.putRow(table, { ...(cur || {}), ...row });
      changed = true;
    }
    if (changed) changes.emit(table);
    return rows.length;
  }

  /** 送れなかったものを、今の店長トークンで送信待ちに戻す */
  async function retryFailed() {
    for (const f of await store.failedList()) {
      await store.outboxAdd({ opId: f.opId, table: f.table, id: f.id, data: f.data, mgrToken: getMgrToken(), at: f.at });
      await store.failedDelete(f.opId);
    }
    await refreshCounts();
    return flush();
  }

  return {
    save, flush, pull, retryFailed, refreshCounts, schedule, stop,
    onChange: changes.on, onStatus: status.on,
    get state() { return state; }
  };
}
