// 端末の保存場所。IndexedDB版と、テスト用のメモリ版が同じ形で動く。
// rows:   記録（表ごと）。key = 表|ID
// outbox: 送信待ち。古い順に送る
// failed: GASに断られて送れなかったもの（消さずに見せる）
// kv:     設定・トークンなど

export const DATE_KEYS = {
  visits: 'bizDate', closings: 'bizDate', days: 'bizDate', attendance: 'bizDate',
  purchases: 'date', fixedCosts: 'month', events: 'date', requests: 'date', log: 'at', staff: null
};

const keyOf = (table, id) => table + '|' + id;
const dateOf = (table, row) => String((DATE_KEYS[table] && row[DATE_KEYS[table]]) || '');
const inRange = (d, from, to) => (!from || d.slice(0, from.length) >= from) && (!to || d.slice(0, to.length) <= to);

export function memoryStore() {
  const rows = new Map(), outbox = new Map(), failed = new Map(), kv = new Map();
  let seq = 0;
  return {
    async getRow(table, id) { return rows.get(keyOf(table, id))?.row ?? null; },
    async putRow(table, row) { rows.set(keyOf(table, row.id), { table, date: dateOf(table, row), row }); },
    async listRows(table, from, to) {
      return [...rows.values()].filter(r => r.table === table && inRange(r.date, from, to)).map(r => r.row);
    },
    async outboxAdd(op) { const s = ++seq; outbox.set(s, { ...op, seq: s, key: keyOf(op.table, op.id) }); return s; },
    async outboxPeek(limit) { return [...outbox.values()].sort((a, b) => a.seq - b.seq).slice(0, limit); },
    async outboxDelete(seqs) { seqs.forEach(s => outbox.delete(s)); },
    async outboxCount() { return outbox.size; },
    async outboxHasKey(table, id) { const k = keyOf(table, id); return [...outbox.values()].some(o => o.key === k); },
    async failedAdd(item) { failed.set(item.opId, item); },
    async failedList() { return [...failed.values()]; },
    async failedDelete(opId) { failed.delete(opId); },
    async kvGet(k) { return kv.has(k) ? kv.get(k) : null; },
    async kvSet(k, v) { kv.set(k, v); }
  };
}

export function idbStore(name = 'okame') {
  const open = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const r = db.createObjectStore('rows', { keyPath: 'key' });
      r.createIndex('table_date', ['table', 'date']);
      const o = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      o.createIndex('key', 'key');
      db.createObjectStore('failed', { keyPath: 'opId' });
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function run(storeName, mode, fn) {
    const db = await open;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const st = tx.objectStore(storeName);
      let result;
      Promise.resolve(fn(st, v => { result = v; })).catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const req2p = (req, set, map = v => v) => { req.onsuccess = () => set(map(req.result)); };

  return {
    getRow: (table, id) => run('rows', 'readonly', (st, set) => req2p(st.get(keyOf(table, id)), set, v => v?.row ?? null)),
    putRow: (table, row) => run('rows', 'readwrite', st => { st.put({ key: keyOf(table, row.id), table, date: dateOf(table, row), row }); }),
    listRows: (table, from, to) => run('rows', 'readonly', (st, set) => {
      const range = IDBKeyRange.bound([table, from || ''], [table, (to || '') + '￿']);
      req2p(st.index('table_date').getAll(range), set, list => list.filter(r => inRange(r.date, from, to)).map(r => r.row));
    }),
    outboxAdd: op => run('outbox', 'readwrite', (st, set) => req2p(st.add({ ...op, key: keyOf(op.table, op.id) }), set)),
    outboxPeek: limit => run('outbox', 'readonly', (st, set) => req2p(st.getAll(null, limit), set)),
    outboxDelete: seqs => run('outbox', 'readwrite', st => { seqs.forEach(s => st.delete(s)); }),
    outboxCount: () => run('outbox', 'readonly', (st, set) => req2p(st.count(), set)),
    outboxHasKey: (table, id) => run('outbox', 'readonly', (st, set) => req2p(st.index('key').count(keyOf(table, id)), set, n => n > 0)),
    failedAdd: item => run('failed', 'readwrite', st => { st.put(item); }),
    failedList: () => run('failed', 'readonly', (st, set) => req2p(st.getAll(), set)),
    failedDelete: opId => run('failed', 'readwrite', st => { st.delete(opId); }),
    kvGet: k => run('kv', 'readonly', (st, set) => req2p(st.get(k), set, v => (v ? v.v : null))),
    kvSet: (k, v) => run('kv', 'readwrite', st => { st.put({ k, v }); })
  };
}
