import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { formatDateTime } from '../utils/date';

interface Props {
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

interface AuditRow {
  id: string;
  date: string;
  userName: string;
  userEmail: string;
  role: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  changes: { field: string; from: string; to: string }[];
}

const PAGE = 50;

// The audit log (admins and senior managers): who changed what, newest first.
export const AuditLogViewer: React.FC<Props> = ({ onToast }) => {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState<number | null>(null); // null until the first load
  const [actions, setActions] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await api.listAuditLog({ q, action, from, to, limit: PAGE, offset });
      if (res.error) return onToast(res.message || 'Could not load the audit log.', 'error');
      setRows(res.rows || []);
      setTotal(res.total || 0);
      setActions(res.actions || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, action, from, to, offset]);

  const reset = (fn: () => void) => { fn(); setOffset(0); };

  return (
    <div className="card">
      <div className="card-title">Audit log</div>
      <section className="mp-filters" aria-label="Audit log filters" style={{ border: 0, padding: 0 }}>
        <div className="mp-field">
          <label htmlFor="a-q">Search</label>
          <input id="a-q" type="search" value={q} placeholder="Name, record ID, user…" onChange={(e) => reset(() => setQ(e.target.value))} />
        </div>
        <div className="mp-field">
          <label htmlFor="a-action">Action</label>
          <select id="a-action" value={action} onChange={(e) => reset(() => setAction(e.target.value))}>
            <option value="">Any</option>
            {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="mp-field">
          <label htmlFor="a-from">From</label>
          <input id="a-from" type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </div>
        <div className="mp-field">
          <label htmlFor="a-to">To</label>
          <input id="a-to" type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
      </section>
      <div className="mp-muted" style={{ margin: '4px 0 8px' }}>{total === null ? 'Loading…' : `${total} entr${total === 1 ? 'y' : 'ies'}`}</div>
      <div className="dw-list">
        {rows.map((r) => (
          <div key={r.id + r.date}>
            <button type="button" className="dw-item" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
              <strong>{r.summary || `${r.action} ${r.entity}`}</strong>
              <span className="mp-muted">{r.userName || r.userEmail} · {r.action.replace(/_/g, ' ')} · {r.entity}{r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}</span>
              <span className="mp-muted">{formatDateTime(r.date)}</span>
            </button>
            {openId === r.id && r.changes.length > 0 && (
              <div className="dw-table-wrap" style={{ padding: '4px 0 10px' }}>
                <table className="data-table">
                  <thead><tr><th>Field</th><th>From</th><th>To</th></tr></thead>
                  <tbody>{r.changes.map((c, i) => <tr key={i}><td>{c.field}</td><td>{c.from}</td><td>{c.to}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        {total !== null && rows.length === 0 && <div className="mp-empty">Nothing matches.</div>}
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button type="button" className="mp-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
        <button type="button" className="mp-btn" disabled={total === null || offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older</button>
      </div>
    </div>
  );
};
