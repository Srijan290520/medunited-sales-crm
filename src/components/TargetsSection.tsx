import React, { useEffect, useMemo, useState } from 'react';
import { User, TargetRow } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';
import { formatMoney, todayKey } from '../utils/date';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

// Monthly targets per agent and module. Each module is measured as revenue
// or as a number of sales (admins / senior managers choose). Hitting a target
// doesn't change incentives (yet).
export const TargetsSection: React.FC<Props> = ({ user, onToast }) => {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [measures, setMeasures] = useState<Record<string, 'revenue' | 'count'>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const canSetMeasure = isSeniorRole(user.Role);

  const apply = (res: any) => {
    setRows(res.rows || []);
    setMeasures(res.measures || {});
    setDraft({});
  };
  const load = async () => {
    setBusy('loading');
    try {
      const res = await api.getTargets(month);
      if (res.error) onToast(res.message || 'Could not load targets.', 'error');
      else apply(res);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    load();
  }, [month]);

  const modules = useMemo(() => {
    const seen: { id: string; label: string }[] = [];
    rows.forEach((r) => { if (!seen.some((m) => m.id === r.module)) seen.push({ id: r.module, label: r.moduleLabel }); });
    return seen;
  }, [rows]);
  const people = useMemo(() => {
    const seen: { email: string; name: string }[] = [];
    rows.forEach((r) => { if (!seen.some((p) => p.email === r.agentEmail)) seen.push({ email: r.agentEmail, name: r.agentName }); });
    return seen;
  }, [rows]);
  const key = (email: string, mod: string) => `${email}|${mod}`;
  const cell = (email: string, mod: string) => rows.find((r) => r.agentEmail === email && r.module === mod);
  const changed = Object.keys(draft);

  const save = async () => {
    const entries = changed.map((k) => {
      const [agentEmail, module] = k.split('|');
      const v = draft[k].trim();
      return { agentEmail, module, target: v === '' ? ('' as const) : Number(v) };
    });
    if (entries.some((e) => e.target !== '' && !(Number(e.target) >= 0))) return onToast('Targets must be numbers (0 or more).', 'error');
    setBusy('saving');
    try {
      const res = await api.saveTargets(month, entries);
      if (res.error) return onToast(res.message || 'Could not save targets.', 'error');
      apply(res);
      onToast(`${res.changed} target(s) saved for ${month}.`, 'success');
    } finally {
      setBusy(null);
    }
  };

  const copyLast = async () => {
    setBusy('copying');
    try {
      const res = await api.copyTargets(month, false);
      if (res.error) return onToast(res.message || 'Could not copy.', 'error');
      apply(res);
      onToast(res.copied ? `Copied ${res.copied} target(s) from last month${res.skipped ? `; kept ${res.skipped} already set` : ''}.` : 'Nothing to copy from last month.', 'success');
    } finally {
      setBusy(null);
    }
  };

  const setMeasure = async (mod: string, measure: 'revenue' | 'count') => {
    const res = await api.setTargetMeasure(mod, measure);
    if (res.error) return onToast(res.message || 'Could not change the measure.', 'error');
    load();
  };

  const fmt = (mod: string, v: number) => (measures[mod] === 'count' ? `${v} sale${v === 1 ? '' : 's'}` : formatMoney(v));

  return (
    <div className="card">
      <div className="card-title">Monthly targets per agent</div>
      <p className="muted small-text" style={{ marginBottom: '14px' }}>
        Set a target per module for each agent. Progress counts completed sales in the month. Agents see their own targets on their dashboard; hitting a target does not change incentives.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'end', marginBottom: '14px' }}>
        <div className="mp-field">
          <label htmlFor="t-month">Month</label>
          <input id="t-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <button type="button" className="mp-btn" onClick={copyLast} disabled={!!busy}>{busy === 'copying' ? 'Copying…' : 'Copy last month'}</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="mp-btn-primary" onClick={save} disabled={!!busy || changed.length === 0}>
          {busy === 'saving' ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}
        </button>
      </div>
      <div className="dw-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Agent</th>
              {modules.map((m) => (
                <th key={m.id}>
                  {m.label}
                  <div style={{ fontWeight: 400, textTransform: 'none' }}>
                    {canSetMeasure ? (
                      <select aria-label={`How ${m.label} targets are measured`} value={measures[m.id] || 'revenue'}
                        onChange={(e) => setMeasure(m.id, e.target.value as 'revenue' | 'count')} style={{ height: '30px', fontSize: '0.8rem' }}>
                        <option value="revenue">Revenue (₹)</option>
                        <option value="count">Number of sales</option>
                      </select>
                    ) : (
                      <span className="mp-muted">{measures[m.id] === 'count' ? 'Number of sales' : 'Revenue (₹)'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.email}>
                <td><strong>{p.name}</strong><div className="mp-muted">{p.email}</div></td>
                {modules.map((m) => {
                  const c = cell(p.email, m.id);
                  const k = key(p.email, m.id);
                  const value = draft[k] !== undefined ? draft[k] : c && c.target !== null ? String(c.target) : '';
                  return (
                    <td key={m.id}>
                      <input aria-label={`${m.label} target for ${p.name}`} type="number" min="0" step={measures[m.id] === 'count' ? 1 : 100}
                        value={value} placeholder="—" onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={{ width: '120px' }} />
                      <div className="mp-muted">
                        {fmt(m.id, c?.achieved ?? 0)} done{c && c.percent !== null ? ` · ${c.percent}%` : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {people.length === 0 && (
              <tr><td colSpan={modules.length + 1} className="mp-muted">{busy === 'loading' ? 'Loading…' : 'No active agents.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
