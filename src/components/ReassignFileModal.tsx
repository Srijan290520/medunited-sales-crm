import React, { useState } from 'react';
import { SaleType } from '../types';
import { api } from '../services/api';
import { readTable, cellToString, normHeader, MAX_FILE_BYTES } from '../utils/readTable';
import { BulkPreview, BulkSummary } from './BulkReassignModal';

// Reassign from a spreadsheet: export this module's records (Export CSV),
// change the "Assigned Agent Email" column, and load the file here. Only rows
// whose agent changed are used; the preview shows what will move first.

const ID_HEADERS = ['recordid', 'id'];
const AGENT_HEADERS = ['assignedagentemail', 'agentemail', 'newagentemail', 'assignto'];
const MAX_ROWS = 500;

interface Props {
  type: SaleType;
  label: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

export const ReassignFileModal: React.FC<Props> = ({ type, label, onClose, onDone }) => {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<{ _row: number; id: string; agentEmail: string }[]>([]);
  const [scope, setScope] = useState<'household' | 'person'>('household');
  const [preview, setPreview] = useState<BulkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const check = async (list: typeof rows, s: 'household' | 'person') => {
    setBusy('checking');
    try {
      const res = await api.importReassignments({ type, rows: list, scope: s, dryRun: true, fileName });
      if (res.error) setError(res.message || 'Could not check the file.');
      else setPreview(res as unknown as BulkSummary);
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPreview(null);
    setRows([]);
    if (file.size > MAX_FILE_BYTES) return setError('That file is larger than 5MB. Split it into smaller files.');
    setFileName(file.name);
    setBusy('reading');
    try {
      const table = await readTable(file);
      const headerIndex = table.findIndex((r) => Array.isArray(r) && r.some((c) => cellToString(c)));
      if (headerIndex === -1) throw new Error('The file is empty.');
      const header = table[headerIndex].map(normHeader);
      const idCol = header.findIndex((h) => ID_HEADERS.includes(h));
      const agentCol = header.findIndex((h) => AGENT_HEADERS.includes(h));
      if (idCol === -1 || agentCol === -1) {
        throw new Error('Could not find the "Record ID" and "Assigned Agent Email" columns. Start from this page\'s Export CSV.');
      }
      const out: typeof rows = [];
      for (let i = headerIndex + 1; i < table.length; i++) {
        const r = table[i] || [];
        const id = cellToString(r[idCol]);
        if (!id) continue;
        out.push({ _row: i + 1, id, agentEmail: cellToString(r[agentCol]) });
      }
      if (!out.length) throw new Error('No rows with a Record ID were found.');
      if (out.length > MAX_ROWS) throw new Error(`The file has ${out.length} rows; at most ${MAX_ROWS} can be loaded at once. Keep only the rows you changed, or split the file.`);
      setRows(out);
      await check(out, scope);
    } catch (err: any) {
      setError(err?.message || 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy('applying');
    try {
      const res = await api.importReassignments({ type, rows, scope, dryRun: false, fileName });
      if (res.error) return setError(res.message || 'Could not reassign.');
      const m = (res as unknown as BulkSummary).moved;
      onDone(`${m?.patients ?? 0} patient(s) and ${m?.records ?? 0} open record(s) moved from ${fileName}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <div className="sales-modal-popup open" style={{ maxWidth: '680px', zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="refile-title">
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="refile-title">Reassign {label} records from a file</h3>
              <div className="modal-header-sub">
                1. Export CSV on this page · 2. Change the <strong>Assigned Agent Email</strong> column · 3. Load the file here.
                Rows you didn't change are ignored. Each patient moves with all their open records.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '12px', alignItems: 'end' }}>
            <div>
              <label htmlFor="refile-file">Excel (.xlsx) or CSV file</label>
              <input id="refile-file" type="file" accept=".xlsx,.csv,text/csv" onChange={handleFile} disabled={!!busy} />
            </div>
            <div>
              <label htmlFor="refile-scope">Who moves</label>
              <select id="refile-scope" value={scope} disabled={!!busy}
                onChange={(e) => { const s = e.target.value as 'household' | 'person'; setScope(s); if (rows.length) check(rows, s); }}>
                <option value="household">Everyone on each phone number</option>
                <option value="person">Only the person on each row</option>
              </select>
            </div>
          </div>
          {busy === 'reading' && <div className="muted small-text">Reading {fileName}…</div>}
          {busy === 'checking' && <div className="muted small-text">Checking…</div>}
          {preview && <BulkPreview summary={preview} />}
          {error && <div className="contact-check blocking" style={{ marginTop: '10px' }}>{error}</div>}
        </div>
        <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy === 'applying'}>Cancel</button>
          <button type="button" onClick={apply} disabled={!!busy || !preview || preview.valid === 0}>
            {busy === 'applying' ? 'Moving…' : preview ? `Apply ${preview.valid} change${preview.valid === 1 ? '' : 's'}` : 'Apply'}
          </button>
        </div>
      </div>
    </>
  );
};
