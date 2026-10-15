// In-browser stand-ins for the Google services used by apps-script/*.gs, for
// the preview build only. Same behaviour as tests/backend/gas-mock.cjs:
// Sheets turns "2026-10-12" into a Date, number-like text into numbers, and
// a leading apostrophe forces text.
import { sha256, hmacSha256 } from './sha256';

type Cell = unknown;

function toSigned(bytes: Uint8Array): number[] {
  return Array.from(bytes, (b) => (b > 127 ? b - 256 : b));
}
function toBytes(arr: number[] | string): Uint8Array {
  if (typeof arr === 'string') return new TextEncoder().encode(arr);
  return Uint8Array.from(arr, (b) => b & 0xff);
}

function istMidnight(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600 * 1000);
}

function coerce(value: Cell): Cell {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return istMidnight(value);
  if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return Number(value);
  if (value.toUpperCase() === 'TRUE') return true;
  if (value.toUpperCase() === 'FALSE') return false;
  return value;
}

class Sheet {
  rows: Cell[][] = [];
  constructor(public name: string) {}
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if ((this.rows[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, (r || []).length), 0); }
  getRange(row: number, col: number, nRows = 1, nCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out: Cell[][] = [];
        for (let r = 0; r < nRows; r++) {
          const line: Cell[] = [];
          for (let c = 0; c < nCols; c++) {
            const v = (sheet.rows[row - 1 + r] || [])[col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values: Cell[][]) {
        values.forEach((line, r) => {
          const idx = row - 1 + r;
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          line.forEach((v, c) => { sheet.rows[idx][col - 1 + c] = coerce(v); });
        });
        return this;
      },
    };
  }
  appendRow(values: Cell[]) { this.rows.splice(this.getLastRow(), 0, values.map(coerce)); }
  deleteRow(i: number) { this.rows.splice(i - 1, 1); }
  setFrozenRows() {}
  protect() {
    return { setDescription() { return this; }, getEditors: () => [], removeEditors() { return this; }, canDomainEdit: () => false, setDomainEdit() {} };
  }
}

export function createGasMocks() {
  const sheets = new Map<string, Sheet>();
  const cache = new Map<string, string>();
  const props = new Map<string, string>();
  const files = new Map<string, any>();
  const folders = new Map<string, any>();

  const spreadsheet = {
    getSheetByName: (n: string) => sheets.get(n) || null,
    insertSheet: (n: string) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata',
  };

  const newBlob = (data: number[] | string, contentType?: string, name?: string) => {
    const bytes = typeof data === 'string' ? toSigned(toBytes(data)) : data;
    return { getBytes: () => bytes.slice(), getContentType: () => contentType || 'text/plain', getName: () => name || 'blob' };
  };

  function makeFolder(name: string) {
    const folder: any = {
      getName: () => name,
      createFile(blob: any) {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const file = {
          getId: () => id,
          getName: () => blob.getName(),
          getUrl: () => `https://drive.google.com/file/d/${id}/view`,
          setSharing() { return file; },
          getSharingAccess: () => 'PRIVATE',
          getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return folder; } }; },
          getBlob: () => blob,
        };
        files.set(id, file);
        return file;
      },
      getFiles() { const list = [...files.values()]; let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
    };
    folders.set(name, folder);
    return folder;
  }

  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

  const mocks = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {} },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => (cache.has(k) ? cache.get(k)! : null),
        put: (k: string, v: string) => { cache.set(k, String(v)); },
        remove: (k: string) => { cache.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty: (k: string, v: string) => { props.set(k, String(v)); },
        deleteProperty: (k: string) => { props.delete(k); },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s: string) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' },
      Permission: { NONE: 'NONE' },
      getFoldersByName(name: string) { const f = folders.get(name); let done = !f; return { hasNext: () => !done, next: () => { done = true; return f; } }; },
      createFolder: (name: string) => makeFolder(name),
      getFileById(id: string) { const f = files.get(id); if (!f) throw new Error('Exception: No item with the given ID could be found.'); return f; },
    },
    Utilities: {
      getUuid: () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      })),
      newBlob,
      computeHmacSha256Signature: (value: number[] | string, key: number[] | string) => toSigned(hmacSha256(toBytes(key), toBytes(value))),
      computeDigest: (_alg: string, value: string) => toSigned(sha256(toBytes(String(value)))),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Decode: (s: string) => toSigned(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))),
      base64Encode: (bytes: number[]) => {
        const u = toBytes(bytes);
        let bin = '';
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      formatDate: (date: Date) => {
        const p = fmt.formatToParts(date);
        const get = (t: string) => p.find((x) => x.type === t)!.value;
        return `${get('year')}-${get('month')}-${get('day')}`;
      },
    },
    Logger: { log() {} },
    console: { log() {}, warn() {}, error() {} },
  };
  return { mocks, props };
}
