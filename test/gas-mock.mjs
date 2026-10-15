// GASのSpreadsheetAppなどの「まね」。gas/Code.gs をNodeで動かして確かめるためだけに使う。
// 実物に合わせている点：書式が「書式なしテキスト(@)」でないセルに日付らしい文字を入れると日付に変わる。
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error('setValues: 範囲と値の大きさが違う');
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet._set(this.r + i, this.c + j, v)));
    return this;
  }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet._fmt(this.r + i, this.c + j, f);
    return this;
  }
  setNumberFormats(fs2) {
    fs2.forEach((row, i) => row.forEach((f, j) => this.sheet._fmt(this.r + i, this.c + j, f)));
    return this;
  }
  setFontWeight() { return this; }
  setFontSize() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setBorder() { return this; }
  setFormula(f) { this.sheet._set(this.r, this.c, f); return this; }
  setFormulas(vals) { return this.setValues(vals); }
  getBackgrounds() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.bgs.get(this.sheet._key(this.r + i, this.c + j)) || '#ffffff');
      out.push(row);
    }
    return out;
  }
  setBackground(color) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const k = this.sheet._key(this.r + i, this.c + j);
      if (color == null) this.sheet.bgs.delete(k); else this.sheet.bgs.set(k, color);
    }
    return this;
  }
  applyRowBanding() {
    const b = { range: this, header: null, setHeaderRowColor(c) { this.header = c; return this; }, setFirstRowColor() { return this; }, setSecondRowColor() { return this; },
      setRange(r) { this.range = r; return this; }, getRange() { return this.range; } };
    this.sheet.bandings.push(b);
    return b;
  }
  copyTo(target) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const v = this.sheet.cells.get(this.sheet._key(this.r + i, this.c + j));
      const k = target.sheet._key(target.r + i, target.c + j);
      // 実物と同じく、式の中のセルの列は貼り付け先に合わせてずれる（1文字の列だけまねる）
      const moved = typeof v === 'string' && v[0] === '=' ? v.replace(/([A-Z])(\d+)/g, (m, col, row) => String.fromCharCode(col.charCodeAt(0) + target.c - this.c) + row) : v;
      if (v === undefined) target.sheet.cells.delete(k); else target.sheet.cells.set(k, moved);
      const f = this.sheet.formats.get(this.sheet._key(this.r + i, this.c + j));
      if (f) target.sheet.formats.set(k, f);
    }
    return this;
  }
  clear() {
    this.clearContent();
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      this.sheet.formats.delete(this.sheet._key(this.r + i, this.c + j));
      this.sheet.bgs.delete(this.sheet._key(this.r + i, this.c + j));
    }
    return this;
  }
  setValue(v) { this.sheet._set(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.cells.delete(this.sheet._key(this.r + i, this.c + j)); return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.formats = new Map(); this.bgs = new Map(); this.bandings = []; this.hidden = false; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  hideSheet() { this.hidden = true; return this; }
  showSheet() { this.hidden = false; return this; }
  isSheetHidden() { return this.hidden; }
  setRowHeight() { return this; }
  setColumnWidth() { return this; }
  getBandings() { return this.bandings; }
  // 別のスプレッドシートへコピー（元の名前に「のコピー」が付く。実物と同じ）
  copyTo(dest) {
    const s = dest.insertSheet(this.name + ' のコピー');
    for (const [k, v] of this.cells) s.cells.set(k, v);
    for (const [k, v] of this.formats) s.formats.set(k, v);
    for (const [k, v] of this.bgs) s.bgs.set(k, v);
    s.maxRows = this.maxRows; s.maxCols = this.maxCols;
    s.bandings = this.bandings.map(b => ({ ...b }));
    s.copiedFrom = this.name;
    return s;
  }
  _key(r, c) { return r + ':' + c; }
  _check(r) { if (r > this.maxRows) throw new Error(`行${r}はシートの行数(${this.maxRows})を超えている`); }
  _get(r, c) { const v = this.cells.get(this._key(r, c)); return v === undefined ? '' : v; }
  _set(r, c, v) {
    this._check(r);
    if (c > this.maxCols) this.maxCols = c;
    const fmt = this.formats.get(this._key(r, c));
    if (typeof v === 'string' && fmt !== '@' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = new Date(v);
    if (v === '' || v === null) this.cells.delete(this._key(r, c)); else this.cells.set(this._key(r, c), v);
  }
  _fmt(r, c, f) { this._check(r); this.formats.set(this._key(r, c), f); }
  getRange(r, c, nr = 1, nc = 1) { this._check(r + nr - 1); return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, Number(k.split(':')[0])); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, Number(k.split(':')[1])); return m; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) {
    this.maxRows += n;
    for (let c = 1; c <= this.maxCols; c++) {
      const f = this.formats.get(this._key(after, c));
      if (f) for (let i = 1; i <= n; i++) this.formats.set(this._key(after + i, c), f);
    }
  }
  setFrozenRows() {}
  setFrozenColumns() {}
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  /** 行を消して、下の行を詰める（実物と同じく行数も減る） */
  deleteRows(start, n) {
    const move = (map) => {
      const next = new Map();
      for (const [k, v] of map) {
        const [r, c] = k.split(':').map(Number);
        if (r >= start && r < start + n) continue;
        next.set(this._key(r >= start + n ? r - n : r, c), v);
      }
      return next;
    };
    this.cells = move(this.cells);
    this.formats = move(this.formats);
    this.bgs = move(this.bgs);
    this.maxRows -= n;
  }
  getProtections() { return this.protection ? [this.protection] : []; }
  protect() {
    const editors = new Set(['owner@example.com', 'tencho@example.com']);
    let domain = true;
    this.protection = {
      editors,
      setDescription() { return this; },
      addEditor: u => { editors.add(u.getEmail()); },
      removeEditors: us => { us.forEach(u => editors.delete(u.getEmail())); },
      getEditors: () => [...editors].map(e => ({ getEmail: () => e })),
      canDomainEdit: () => domain,
      setDomainEdit: v => { domain = v; }
    };
    return this.protection;
  }
  // テスト用：見出しをキーにした行の配列
  dump() {
    const lastRow = this.getLastRow(), lastCol = this.getLastColumn();
    const header = new Range(this, 1, 1, 1, lastCol).getValues()[0];
    return lastRow < 2 ? [] : new Range(this, 2, 1, lastRow - 1, lastCol).getValues()
      .map(r => Object.fromEntries(header.map((h, j) => [h, r[j]])));
  }
}

function jst(d) { return new Date(d.getTime() + 9 * 3600e3); }

export function loadGas(file) {
  const sheets = [new Sheet('シート1')];
  const props = new Map();
  const cache = new Map();
  const logs = [];
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
    setActiveSheet: s => { ss._active = s; return s; },
    moveActiveSheet: pos => { const i = sheets.indexOf(ss._active); sheets.splice(i, 1); sheets.splice(pos - 1, 0, ss._active); },
    setSpreadsheetTimeZone() {}
  };
  const ctx = {
    console: { log: m => logs.push(String(m)), error: m => logs.push('ERR ' + m) },
    SpreadsheetApp: { getActive: () => ss, getUi: () => { throw new Error('UIなし'); }, ProtectionType: { SHEET: 'SHEET' }, BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' }, BorderStyle: { SOLID: 'SOLID' } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'hayashi@example.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash(alg).update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      base64Encode: bytes => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64'),
      formatDate: (d, tz, fmt) => {
        const iso = jst(d).toISOString();
        const map = { 'HH:mm:ss': iso.slice(11, 19), 'yyyy-MM-dd': iso.slice(0, 10), 'yyyy-MM': iso.slice(0, 7), "yyyy-MM-dd'T'HH:mm:ssXXX": iso.slice(0, 19) + '+09:00' };
        if (!(fmt in map)) throw new Error('まねしていない書式: ' + fmt);
        return map[fmt];
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s })
    },
    Date, JSON, Math, Number, String, Object, Array, Error, isNaN
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'Code.gs' });

  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  // GASの「今」を決める（テストを日付に左右されないように）
  const setNow = iso => { ctx.now_ = () => new Date(iso); };
  return { gas: ctx, ss, sheets, props, cache, logs, post, setNow };
}

/** 別のスプレッドシート（管理シートなど）のまね。tabs = { タブ名: 2次元の値 } */
export function makeSpreadsheet(tabs, fills = {}) {
  const sheets = Object.entries(tabs).map(([name, rows]) => {
    const sh = new Sheet(name);
    rows.forEach((row, i) => row.forEach((v, j) => { if (v !== '' && v != null) sh.cells.set(sh._key(i + 1, j + 1), v); }));
    // fills = { タブ名: { 'A1': '#ffff00' } } の形で、塗りの色を渡せる
    for (const [a1, color] of Object.entries(fills[name] || {})) {
      const col = a1.charCodeAt(0) - 64, row = Number(a1.slice(1));
      sh.bgs.set(sh._key(row, col), color);
    }
    return sh;
  });
  return { getSheetByName: n => sheets.find(x => x.name === n) || null };
}
