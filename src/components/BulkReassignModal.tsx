import React, { useState } from 'react';
import { SaleType, User } from '../types';
import { api } from '../services/api';

export interface BulkResultRow {
  row: number;
  id: string;
  customerName: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  fromAgent: string;
  toAgent: string;
  openRecords: number;
}

export interface BulkSummary {
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  toMove: number;
  unchanged?: number;
  results: BulkResultRow[];
  moved: { patients: number; records: number; reminders: number } | null;
}

// The preview table shared by the bulk tools: what will move, and why rows are skipped.
export const BulkPreview: React.FC<{ summary: BulkSummary; label?: string }> = ({ summary, label = 'Row' }) => {
  const problems = summary.results.filter((r) => !r.ok || r.warnings.length);
  return (
    <div>
      <div className="contact-check" style={{ marginBottom: '10px' }}>
        {summary.toMove} open record{summary.toMove === 1 ? '' : 's'} will move
        {summary.invalid ? ` · ${summary.invalid} ${label.toLowerCase()}${summary.invalid === 1 ? '' : 's'} skipped` : ''}
        {summary.unchanged ? ` · ${summary.unchanged} unchanged` : ''}. Completed and cancelled sales keep their agent.
      </div>
      {problems.length > 0 && (
        <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
          <table className="data-table">
            <tbody>
              {problems.map((r) => (
                <tr key={r.row + r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{label} {r.row}</td>
                  <td>{r.customerName || r.id || '—'}</td>
                  <td className="small-text" style={{ color: r.ok ? '#92400e' : '#b91c1c' }}>{[...r.errors, ...r.warnings].join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface Props {
  type: SaleType;
  ids: string[];
  agents: User[]; // active agents and managers
  onClose: () => void;
  onDone: (message: string) => void;
}

// Reassign the ticked records' patients to one agent: preview first, then confirm.
export const BulkReassignModal: React.FC<Props> = ({ type, ids, agents, onClose, onDone }) => {
  const [agentEmail, setAgentEmail] = useState('');
  const [scope, setScope] = useState<'household' | 'person'>('household');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    setError(null);
    if (!agentEmail) return setError('Choose who takes over.');
    setBusy(true);
    try {
      const res = await api.bulkReassign({ type, ids, agentEmail, scope, dryRun, reason: reason.trim() });
      if (res.error) return setError(res.message || 'Could not reassign.');
      if (dryRun) setPreview(res as unknown as BulkSummary);
      else {
        const m = (res as unknown as BulkSummary).moved;
        onDone(`${m?.patients ?? 0} patient(s) and ${m?.records ?? 0} open record(s) moved.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <div className="sales-modal-popup open" style={{ maxWidth: '620px', zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="bulk-title">
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="bulk-title">Reassign {ids.length} selected record{ids.length === 1 ? '' : 's'}</h3>
              <div className="modal-header-sub">
                Each patient moves with all their open records in every module and their reminders.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label htmlFor="bulk-agent">Reassign to *</label>
              <select id="bulk-agent" value={agentEmail} onChange={(e) => { setAgentEmail(e.target.value); setPreview(null); }}>
                <option value="">— Choose —</option>
                {agents.map((a) => <option key={a.Email} value={a.Email}>{a.Name}{a.Role === 'manager' ? ' (manager)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bulk-scope">Who moves</label>
              <select id="bulk-scope" value={scope} onChange={(e) => { setScope(e.target.value as 'household' | 'person'); setPreview(null); }}>
                <option value="household">Everyone on each phone number</option>
                <option value="person">Only the selected people</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label htmlFor="bulk-reason">Reason (shown in the history)</label>
            <input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rebalancing workload" />
          </div>
          {preview && <BulkPreview summary={preview} label="Record" />}
          {error && <div className="contact-check blocking" style={{ marginTop: '10px' }}>{error}</div>}
        </div>
        <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {!preview ? (
            <button type="button" onClick={() => run(true)} disabled={busy}>{busy ? 'Checking…' : 'Preview'}</button>
          ) : (
            <button type="button" onClick={() => run(false)} disabled={busy || preview.valid === 0}>
              {busy ? 'Moving…' : preview.toMove ? `Reassign ${preview.toMove} open record${preview.toMove === 1 ? '' : 's'}` : 'Reassign'}
            </button>
          )}
        </div>
      </div>
    </>
  );
};
