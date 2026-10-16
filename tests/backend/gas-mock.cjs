// In-memory stand-ins for the Google Apps Script services the backend uses,
// so the real apps-script/*.gs files can run under Node for testing.
//
// The spreadsheet mock copies the Sheets behaviours the code depends on:
//   - typed "2026-10-12" becomes a Date at midnight in the sheet's time zone;
//   - text that looks like a number becomes a number, "TRUE"/"FALSE" booleans;
//   - a leading apostrophe forces text and is not returned by getValues().

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHEET_TZ = 'Asia/Kolkata';

function toSigned(buf) {
  return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
}
function toBuf(bytes) {
  return Buffer.from(bytes.map((b) => b & 0xff));
}

function istMidnight(key) {
  // 00:00 IST == 18:30 UTC the previous day
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600 * 1000);
}

function coerce(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return istMidnight(value);
  if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return Number(value);
  if (value.toUpperCase() === 'TRUE') return true;
  if (value.toUpperCase() === 'FALSE') return false;
  return value;
}

class Range {
  constructor(sheet, row, col, nRows, nCols) {
    Object.assign(this, { sheet, row, col, nRows: nRows || 1, nCols: nCols || 1 });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nRows; r++) {
      const line = [];
      for (let c = 0; c < this.nCols; c++) {
        const v = (this.sheet.rows[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nRows || values[0].length !== this.nCols) {
      throw new Error(`Exception: The number of rows or columns in the data does not match the range (${values.length}x${values[0].length} vs ${this.nRows}x${this.nCols})`);
    }
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.rows.length <= idx) this.sheet.rows.push([]);
      line.forEach((v, c) => { this.sheet.rows[idx][this.col - 1 + c] = coerce(v); });
    });
    return this;
  }
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; this.protected = false; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if ((this.rows[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, (r || []).length), 0); }
  getRange(row, col, nRows, nCols) { return new Range(this, row, col, nRows, nCols); }
  appendRow(values) { this.rows.splice(this.getLastRow(), 0, values.map(coerce)); }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  setFrozenRows(n) { this.frozen = n; }
  protect() {
    this.protected = true;
    return { setDescription() { return this; }, getEditors: () => [], removeEditors() { return this; }, canDomainEdit: () => false, setDomainEdit() {} };
  }
}

function makeGlobals() {
  const sheets = new Map();
  const cache = new Map();
  const props = new Map();
  const driveFiles = new Map();
  const folders = new Map();
  let clock = null; // fixed "now" for tests, or null for real time

  const spreadsheet = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSpreadsheetTimeZone: () => SHEET_TZ,
  };

  function makeFolder(name) {
    const id = 'folder_' + crypto.randomUUID();
    const folder = {
      id, name,
      getName: () => name,
      createFile(blob) {
        const fid = crypto.randomBytes(16).toString('hex');
        let access = 'ANYONE_WITH_LINK';
        const file = {
          getId: () => fid,
          getName: () => blob.getName(),
          getUrl: () => `https://drive.google.com/file/d/${fid}/view`,
          setSharing(a) { access = a; return file; },
          getSharingAccess: () => access,
          getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return folder; } }; },
          getBlob: () => blob,
        };
        driveFiles.set(fid, file);
        return file;
      },
      getFiles() { const list = [...driveFiles.values()]; let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
    };
    folders.set(name, folder);
    return folder;
  }

  function newBlob(data, contentType, name) {
    const bytes = typeof data === 'string' ? toSigned(Buffer.from(data, 'utf8')) : data;
    return { getBytes: () => bytes.slice(), getContentType: () => contentType || 'text/plain', getName: () => name || 'blob' };
  }

  const g = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {} },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { if (String(v).length > 100000) throw new Error('Exception: Argument too large'); cache.set(k, String(v)); },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { NONE: 'NONE', VIEW: 'VIEW' },
      getFoldersByName(name) { const f = folders.get(name); let done = !f; return { hasNext: () => !done, next: () => { done = true; return f; } }; },
      createFolder: (name) => makeFolder(name),
      getFileById(id) { const f = driveFiles.get(id); if (!f) throw new Error('Exception: No item with the given ID could be found.'); return f; },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      newBlob,
      computeHmacSha256Signature(value, key) {
        const v = typeof value === 'string' ? Buffer.from(value) : toBuf(value);
        const k = typeof key === 'string' ? Buffer.from(key) : toBuf(key);
        return toSigned(crypto.createHmac('sha256', k).update(v).digest());
      },
      computeDigest(alg, value) { return toSigned(crypto.createHash('sha256').update(String(value)).digest()); },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      base64Encode: (bytes) => toBuf(bytes).toString('base64'),
      formatDate(date, tz, fmt) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const get = (t) => parts.find((p) => p.type === t).value;
        if (fmt !== 'yyyy-MM-dd') throw new Error('mock formatDate only supports yyyy-MM-dd');
        return `${get('year')}-${get('month')}-${get('day')}`;
      },
    },
    Logger: { log() {} },
    console: { log() {}, warn() {}, error: (...a) => { if (process.env.GAS_DEBUG) console.error(...a); } },
  };

  return { g, sheets, cache, props, driveFiles, setClock: (d) => { clock = d; }, getClock: () => clock };
}

// Loads every .gs file into one shared context, like Apps Script does.
function loadBackend(dir) {
  const env = makeGlobals();
  const RealDate = Date;
  const ctx = vm.createContext({ ...env.g, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, isFinite, parseInt, parseFloat });
  // A Date whose "now" can be pinned by tests.
  ctx.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0 && env.getClock()) super(env.getClock().getTime()); else super(...args); }
    static now() { return env.getClock() ? env.getClock().getTime() : RealDate.now(); }
  };
  ctx.Date.UTC = RealDate.UTC;
  ctx.Date.parse = RealDate.parse;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return { ctx, ...env };
}

module.exports = { loadBackend, makeGlobals };
