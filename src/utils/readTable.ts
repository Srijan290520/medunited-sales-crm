import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';

// Reading an Excel (.xlsx) or CSV file into rows of cells, for the import
// dialogs. The parsers are large, so only files that are loaded lazily use this.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Header names compared without case, spaces or punctuation.
export const normHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    // Excel dates are calendar days: use the local date parts, not UTC.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

export async function readTable(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    return (await readXlsxFile(file)) as unknown[][];
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return new Promise((resolve, reject) => {
      Papa.parse<unknown[]>(file, {
        skipEmptyLines: 'greedy',
        complete: (r) => resolve(r.data as unknown[][]),
        error: (err) => reject(err),
      });
    });
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel, use File → Save As → "Excel Workbook (.xlsx)" or CSV.');
  throw new Error('Please choose an Excel (.xlsx) or CSV file.');
}
