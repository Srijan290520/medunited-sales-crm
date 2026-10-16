import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';
import { SaleType, User } from '../types';
import { isTeamRole } from '../utils/roles';
import { api } from '../services/api';

// Bulk-add leads from an Excel (.xlsx) or CSV file.
//
//  1. Pick a file → it's read here in the browser (nothing is uploaded yet).
//  2. Columns are matched by name ("Phone", "Mobile Number", "Customer"...).
//  3. The server checks every row without saving (dry run) and we show
//     which rows are ready and what's wrong with the rest.
//  4. "Import" saves the ready rows. The server re-checks them first.

interface ImportModalProps {
  type: SaleType;
  user: User;
  agents: User[];
  onClose: () => void;
  onImported: (count: number) => void;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

type Field =
  | 'customerName' | 'contact' | 'temperature' | 'direction' | 'channel' | 'heardFrom' | 'nextFollowUp'
  | 'notes' | 'detail' | 'priceType' | 'amount' | 'agentEmail' | 'date' | 'consent' | 'doNotCall';

const FIELD_LABELS: Record<Field, string> = {
  customerName: 'Customer Name',
  contact: 'Phone',
  temperature: 'Temperature',
  direction: 'Direction',
  channel: 'Channel',
  heardFrom: 'Heard From',
  nextFollowUp: 'Next Follow-up',
  notes: 'Notes',
  detail: 'Details',
  priceType: 'Price Type',
  amount: 'Amount',
  agentEmail: 'Agent Email',
  date: 'Date',
  consent: 'Consent',
  doNotCall: 'Do Not Call',
};

// Header names people actually use, normalized (lowercase, letters/digits only).
const ALIASES: Record<Field, string[]> = {
  customerName: ['customername', 'customer', 'name', 'fullname', 'patientname', 'patient', 'leadname', 'clientname'],
  contact: ['phone', 'contact', 'mobile', 'phonenumber', 'mobilenumber', 'contactnumber', 'mobileno', 'phoneno', 'whatsapp', 'whatsappnumber', 'number'],
  temperature: ['temperature', 'temp', 'leadtemperature', 'priority'],
  direction: ['direction', 'inboundoutbound', 'leaddirection'],
  channel: ['channel', 'source', 'leadsource', 'sourcechannel'],
  heardFrom: ['heardfrom', 'howheard', 'howtheyheard', 'howdidyouhear', 'referralsource', 'referredby'],
  nextFollowUp: ['nextfollowup', 'followup', 'followupdate', 'nextfollowupdate', 'callbackdate'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment'],
  detail: ['details', 'detail', 'plan', 'interest', 'medicines', 'medicine', 'requirement', 'product'],
  priceType: ['pricetype', 'pricing'],
  amount: ['amount', 'value', 'price', 'dealvalue'],
  agentEmail: ['agentemail', 'agent', 'assignedto', 'owner', 'owneremail', 'salesperson'],
  date: ['date', 'enquirydate', 'inquirydate', 'leaddate', 'createddate'],
  consent: ['consent', 'consenttocontact'],
  doNotCall: ['donotcall', 'dnd', 'dnc'],
};

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function cellToString(v: unknown): string {
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

function mapColumns(header: unknown[]): { map: Partial<Record<Field, number>>; ignored: string[] } {
  const map: Partial<Record<Field, number>> = {};
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const key = norm(h);
    if (!key) return;
    const field = (Object.keys(ALIASES) as Field[]).find((f) => map[f] === undefined && ALIASES[f].includes(key));
    if (field) map[field] = i;
    else ignored.push(String(h));
  });
  return { map, ignored };
}

const DETAIL_EXAMPLES: Record<SaleType, string> = {
  medpass: 'Family plan',
  pharmacy: 'Metformin 500, Amlodipine 5',
  homekare: 'Nursing 12 hrs for 10 days',
  lab: 'Thyroid profile, CBC',
};

const MODULE_LABELS: Record<SaleType, string> = { medpass: 'Medpass', pharmacy: 'Pharmacy', homekare: 'Homekare', lab: 'Lab & Radiology' };

function templateCsv(type: SaleType): string {
  const cols: Field[] = ['customerName', 'contact', 'temperature', 'direction', 'channel', 'heardFrom', 'nextFollowUp', 'notes', 'detail',
    ...(type === 'medpass' ? (['priceType'] as Field[]) : []), 'agentEmail'];
  const example: Record<Field, string> = {
    customerName: 'Ravi Kumar', contact: '9848012345', temperature: 'Warm', direction: 'Inbound', channel: 'Health camp',
    heardFrom: 'Health camp', nextFollowUp: '20/10/2026', notes: 'Met at Kukatpally camp',
    detail: DETAIL_EXAMPLES[type], priceType: 'Full Price', amount: '',
    agentEmail: '', date: '', consent: 'Yes', doNotCall: 'No',
  };
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [cols.map((c) => q(FIELD_LABELS[c])).join(','), cols.map((c) => q(example[c])).join(',')].join('\r\n');
}

interface RowResult {
  row: number;
  customerName: string;
  contact: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  agentName: string;
}

export const ImportModal: React.FC<ImportModalProps> = ({ type, user, agents, onClose, onImported, onToast }) => {
  const label = MODULE_LABELS[type];
  const canAssign = isTeamRole(user.Role);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<{ map: Partial<Record<Field, number>>; ignored: string[] } | null>(null);
  const [assignTo, setAssignTo] = useState<string>(user.Email);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'checking' | 'importing'>('');
  const [preview, setPreview] = useState<{ valid: number; invalid: number; results: RowResult[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const reset = () => {
    setFileName('');
    setRows([]);
    setMapping(null);
    setPreview(null);
    setError(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + templateCsv(type)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}_leads_template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const readTable = async (file: File): Promise<unknown[][]> => {
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
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    if (file.size > MAX_FILE_BYTES) return setError('That file is larger than 5MB. Split it into smaller files.');
    setBusy('reading');
    try {
      const table = await readTable(file);
      const headerIndex = table.findIndex((r) => Array.isArray(r) && r.some((c) => cellToString(c)));
      if (headerIndex === -1) throw new Error('The file is empty.');
      const header = table[headerIndex];
      const m = mapColumns(header);
      if (m.map.customerName === undefined || m.map.contact === undefined) {
        throw new Error('Could not find the Customer Name and Phone columns. Use the template, or name the columns "Customer Name" and "Phone".');
      }
      const out: Record<string, unknown>[] = [];
      for (let i = headerIndex + 1; i < table.length; i++) {
        const r = table[i] || [];
        if (!r.some((c) => cellToString(c))) continue;
        const obj: Record<string, unknown> = { _row: i + 1 };
        (Object.keys(m.map) as Field[]).forEach((f) => {
          obj[f] = cellToString(r[m.map[f]!]);
        });
        out.push(obj);
      }
      if (out.length === 0) throw new Error('The file has headers but no data rows.');
      if (out.length > MAX_ROWS) throw new Error(`The file has ${out.length} rows. Import at most ${MAX_ROWS} at a time — split it into smaller files.`);
      setFileName(file.name);
      setRows(out);
      setMapping(m);
      setBusy('checking');
      const res = await api.importSales(type, out, { dryRun: true, agentEmail: canAssign ? assignTo : undefined, fileName: file.name });
      if (res.error) throw new Error(res.message || 'Could not check the file.');
      setPreview({ valid: res.valid, invalid: res.invalid, results: res.results || [] });
    } catch (err: any) {
      setError(err?.message || 'Could not read that file.');
    } finally {
      setBusy('');
    }
  };

  const recheck = async (email: string) => {
    setAssignTo(email);
    if (!rows.length) return;
    setBusy('checking');
    const res = await api.importSales(type, rows, { dryRun: true, agentEmail: email, fileName });
    setBusy('');
    if (res.error) return setError(res.message || 'Could not check the file.');
    setPreview({ valid: res.valid, invalid: res.invalid, results: res.results || [] });
  };

  const doImport = async () => {
    if (!preview || preview.valid === 0) return;
    setBusy('importing');
    setError(null);
    const res = await api.importSales(type, rows, { dryRun: false, agentEmail: canAssign ? assignTo : undefined, fileName });
    setBusy('');
    if (res.error) return setError(res.message || 'Import failed. Nothing was saved.');
    onToast(`Imported ${res.imported} ${label} lead${res.imported === 1 ? '' : 's'}` + (res.invalid ? ` (${res.invalid} skipped)` : ''), 'success');
    onImported(res.imported);
  };

  const problemRows = useMemo(() => (preview ? preview.results.filter((r) => !r.ok || r.warnings.length) : []), [preview]);
  const shownRows = showAll ? problemRows : problemRows.slice(0, 50);

  const downloadProblems = () => {
    if (!preview) return;
    const q = (s: string) => `"${String(s).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const lines = [['Row', 'Customer', 'Phone', 'Problems', 'Warnings'].map(q).join(',')];
    preview.results.filter((r) => !r.ok).forEach((r) => lines.push([String(r.row), r.customerName, r.contact, r.errors.join('; '), r.warnings.join('; ')].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}_import_problems.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="overlay open" onClick={busy ? undefined : onClose} style={{ zIndex: 1000 }} />
      <div className="form-popup wide open import-modal" role="dialog" aria-modal="true" aria-label={`Import ${label} leads`} style={{ zIndex: 1001 }}>
        <div className="popup-header">
          <h3>Import {label} leads</h3>
          <button type="button" className="popup-close" onClick={onClose} disabled={!!busy} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="popup-body">
          <p className="import-help">
            Upload an Excel (.xlsx) or CSV file with one lead per row. <strong>Customer Name</strong> and <strong>Phone</strong> are required; other
            columns are optional. Every row is checked before anything is saved, and imported leads start as <strong>Pending</strong>.{' '}
            <button type="button" className="link-button" onClick={downloadTemplate}>Download the template</button>
          </p>

          {canAssign && (
            <div className="import-assign">
              <label htmlFor="import-assign">Assign rows without an Agent Email to</label>
              <select id="import-assign" value={assignTo} onChange={(e) => recheck(e.target.value)} disabled={!!busy}>
                <option value={user.Email}>Me ({user.Name})</option>
                {agents.filter((a) => a.Email !== user.Email).map((a) => (
                  <option key={a.ID} value={a.Email}>{a.Name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="import-file">
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} disabled={!!busy} />
            {fileName && <span className="import-file-name">{fileName} · {rows.length} rows</span>}
          </div>

          {busy === 'reading' && <div className="import-status">Reading file…</div>}
          {busy === 'checking' && <div className="import-status">Checking {rows.length} rows…</div>}
          {busy === 'importing' && <div className="import-status">Importing {preview?.valid} leads… don't close this window.</div>}
          {error && <div className="form-error show" role="alert">{error}</div>}

          {mapping && (
            <div className="import-mapping">
              <strong>Columns found:</strong>{' '}
              {(Object.keys(mapping.map) as Field[]).map((f) => FIELD_LABELS[f]).join(', ')}
              {mapping.ignored.length > 0 && (
                <div className="import-ignored">Ignored (not recognised): {mapping.ignored.join(', ')}</div>
              )}
            </div>
          )}

          {preview && (
            <>
              <div className="import-summary">
                <div className="import-pill ok">{preview.valid} ready to import</div>
                <div className={`import-pill ${preview.invalid ? 'bad' : ''}`}>{preview.invalid} with problems (will be skipped)</div>
                {preview.invalid > 0 && (
                  <button type="button" className="link-button" onClick={downloadProblems}>Download problem rows</button>
                )}
              </div>

              {problemRows.length > 0 && (
                <div className="import-table-wrap">
                  <table className="import-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Customer</th>
                        <th>Phone</th>
                        <th>Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => (
                        <tr key={r.row} className={r.ok ? 'warn' : 'bad'}>
                          <td>{r.row}</td>
                          <td>{r.customerName || '—'}</td>
                          <td>{r.contact || '—'}</td>
                          <td>
                            {r.errors.map((m, i) => <div key={'e' + i} className="import-err">✖ {m}</div>)}
                            {r.warnings.map((m, i) => <div key={'w' + i} className="import-warn">⚠ {m}</div>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {problemRows.length > shownRows.length && (
                    <button type="button" className="link-button" onClick={() => setShowAll(true)}>
                      Show all {problemRows.length} rows with issues
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="popup-footer" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button type="button" onClick={doImport} disabled={!!busy || !preview || preview.valid === 0}>
            {busy === 'importing' ? 'Importing…' : preview ? `Import ${preview.valid} lead${preview.valid === 1 ? '' : 's'}` : 'Import'}
          </button>
        </div>
      </div>
    </>
  );
};
