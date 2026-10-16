import React, { useEffect, useState } from 'react';
import { User, DashboardSummary, LayoutItem, WidgetId, DashboardLayoutInfo, SaleType } from '../types';
import { isTeamRole, isSeniorRole } from '../utils/roles';
import { api } from '../services/api';
import { formatMoney, formatDate, formatTimeAgo, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';
import { ActivePage } from './Sidebar';

interface DashboardProps {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
  onNavigate?: (page: ActivePage) => void;
}

// The dashboard is a grid of widgets. Each person arranges their own
// (Customize: add, move, resize, remove), saved on the server; without one
// they get their role's default. The layout only decides what is drawn —
// every number comes from dashboardSummary, which the server filters by role.

const SPANS: LayoutItem['span'][] = [4, 6, 8, 12];
const SIZE_NAMES: Record<number, string> = { 4: 'Small', 6: 'Medium', 8: 'Large', 12: 'Full width' };
const MODULE_COLORS: Record<string, string> = { medpass: '#3730a3', pharmacy: '#0e7490', homekare: '#9d174d', lab: '#b45309' };

// Bars scale to the largest value, or to `max` (e.g. 100 for % of target).
const Bars: React.FC<{ rows: { label: string; value: number; color: string; text?: string }[]; max?: number }> = ({ rows, max: fixedMax }) => {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="dw-bars">
      {rows.map((r) => (
        <div key={r.label} className="dw-bar-row">
          <span className="dw-bar-label">{r.label}</span>
          <span className="dw-bar-track" aria-hidden="true">
            <span style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </span>
          <span className="dw-bar-value">{r.text ?? r.value}</span>
        </div>
      ))}
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ user, onToast, onNavigate }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [info, setInfo] = useState<DashboardLayoutInfo | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTeam = isTeamRole(user.Role);

  const load = async () => {
    setError(null);
    const [s, l] = await Promise.all([api.dashboardSummary(), api.getDashboardLayout()]);
    if (s.error) setError(s.message || 'Could not load the dashboard.');
    else setSummary(s.summary);
    if (!l.error) {
      setInfo(l as unknown as DashboardLayoutInfo);
      setLayout((l as unknown as DashboardLayoutInfo).layout);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const titleOf = (id: WidgetId) => info?.widgets.find((w) => w.id === id)?.title || id;
  const go = (type: SaleType) => onNavigate?.(type);

  // ----- Customize -----
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= layout.length) return;
    const n = layout.slice();
    [n[i], n[j]] = [n[j], n[i]];
    setLayout(n);
  };
  const resize = (i: number) =>
    setLayout(layout.map((w, j) => (j === i ? { ...w, span: SPANS[(SPANS.indexOf(w.span) + 1) % SPANS.length] } : w)));
  const remove = (i: number) => setLayout(layout.filter((_, j) => j !== i));
  const add = (id: WidgetId) => setLayout([...layout, { id, span: 6 }]);
  const available = (info?.widgets || []).filter((w) => !layout.some((l) => l.id === w.id));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveDashboardLayout(layout);
      if (res.error) return onToast(res.message || 'Could not save the layout.', 'error');
      setInfo(res as unknown as DashboardLayoutInfo);
      setEditing(false);
      onToast('Dashboard layout saved for you.', 'success');
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    if (info) setLayout(info.layout);
    setEditing(false);
  };
  const reset = async () => {
    const res = await api.resetDashboardLayout();
    if (res.error) return onToast(res.message || 'Could not reset.', 'error');
    setInfo(res as unknown as DashboardLayoutInfo);
    setLayout((res as unknown as DashboardLayoutInfo).layout);
    setEditing(false);
    onToast('Back to the default dashboard for your role.', 'success');
  };
  const saveAsDefault = async (group: 'agent' | 'team') => {
    const res = await api.saveRoleDefaultLayout(group, layout);
    if (res.error) return onToast(res.message || 'Could not save the default.', 'error');
    onToast(`Saved as the default dashboard for ${group === 'agent' ? 'agents' : 'managers and admins'}.`, 'success');
  };

  const exportTeam = () => {
    if (!summary) return;
    const columns: CsvColumn<(typeof summary.agents)[number]>[] = [
      { header: 'Agent', accessor: (a) => a.agentName },
      { header: 'Agent Email', accessor: (a) => a.agentEmail },
      ...(summary.modules || []).flatMap((m) => [
        { header: `${m.label} sales`, accessor: (a: any) => a[`${m.id}Count`] ?? 0 },
        { header: `${m.label} revenue (INR)`, accessor: (a: any) => a[`${m.id}Amount`] ?? 0 },
      ]),
      { header: 'Incentive (INR)', accessor: (a) => a.incentive ?? '' },
    ];
    exportToCsv(`MedUnited_Team_Performance_${todayKey()}.csv`, columns, summary.agents);
  };

  // ----- Widgets -----
  const widget = (id: WidgetId) => {
    if (!summary) return <div className="mp-muted">Loading…</div>;
    switch (id) {
      case 'target': {
        // Agents: their own targets per module (Settings → Monthly targets).
        if (!isTeam) {
          const mine = summary.myTargets || [];
          if (!mine.length) return <div className="mp-muted">No target set for you this month yet.</div>;
          return (
            <Bars max={100} rows={mine.map((r) => ({
              label: r.moduleLabel,
              value: Math.min(100, r.percent ?? 0),
              color: MODULE_COLORS[r.module] || '#374151',
              text: `${r.measure === 'count' ? r.achieved : formatMoney(r.achieved)} / ${r.measure === 'count' ? r.target : formatMoney(r.target || 0)}`,
            }))} />
          );
        }
        const t = summary.monthlyTarget;
        if (!t) return <div className="mp-muted">No target set.</div>;
        return (
          <div className="dw-target">
            <div className="dw-big">{formatMoney(t.currentAmount)}</div>
            <div className="dw-progress" role="progressbar" aria-valuenow={t.percentage} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the monthly target">
              <span style={{ width: `${Math.min(100, t.percentage)}%` }} />
            </div>
            <div className="mp-muted">
              {t.percentage}% of {formatMoney(t.targetAmount)} {isTeam ? 'team target' : 'target'} · completed sales this month
            </div>
          </div>
        );
      }
      case 'comparison': {
        const cmp = summary.comparison;
        if (!cmp) return <div className="mp-muted">No data yet.</div>;
        const row = (label: string, now: number, before: number, money: boolean) => {
          const diff = now - before;
          const pct = before ? Math.round((diff / before) * 100) : null;
          return (
            <div className="pf-mini">
              <span>{label}</span>
              <strong>{money ? formatMoney(now) : now}</strong>
              <span className={`pf-delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
                <span aria-hidden="true">{diff > 0 ? '▲' : diff < 0 ? '▼' : '■'}</span>{' '}
                {diff === 0 ? 'same' : pct === null ? 'new' : `${diff > 0 ? '+' : '−'}${Math.abs(pct)}%`}
              </span>
            </div>
          );
        };
        return (
          <>
            {row('Revenue', cmp.thisMonth.amount, cmp.lastMonth.amount, true)}
            {row('Sales', cmp.thisMonth.count, cmp.lastMonth.count, false)}
            <button type="button" className="mp-link" onClick={() => onNavigate?.('performance')}>More comparisons</button>
          </>
        );
      }
      case 'followups': {
        const list = summary.urgentFollowUps || [];
        if (!list.length) return <div className="mp-muted">No follow-ups due.</div>;
        return (
          <div className="dw-list">
            {list.map((f) => (
              <button key={f.id} type="button" className="dw-item" onClick={() => go(f.type)}>
                <strong>{f.customerName}</strong>
                <span className="mp-muted">
                  {f.type === 'lab' ? 'Lab & Radiology' : f.type.charAt(0).toUpperCase() + f.type.slice(1)} · {f.temperature}
                  {isTeam ? ` · ${f.agentName}` : ''}
                </span>
                <span className={`dw-when ${f.followUpStatus || ''}`}>
                  {f.followUpStatus === 'today' ? 'Today' : f.followUpStatus === 'overdue' ? `Overdue · ${formatDate(f.nextFollowUp || '')}` : formatDate(f.nextFollowUp || '')}
                </span>
              </button>
            ))}
          </div>
        );
      }
      case 'reminders': {
        const list = summary.remindersDue || [];
        if (!list.length) return <div className="mp-muted">No reminders due.</div>;
        return (
          <div className="dw-list">
            {list.map((r) => (
              <button key={r.id} type="button" className="dw-item" onClick={() => onNavigate?.('reminders')}>
                <strong>{r.customerName}</strong>
                <span className="mp-muted">{r.kind === 'renewal' ? 'Homekare renewal' : 'Refill'} · {r.detail}</span>
                <span className={`dw-when ${r.overdue ? 'overdue' : 'today'}`}>
                  {r.daysRemaining === null ? '' : r.overdue ? `${Math.abs(r.daysRemaining)}d late` : `${r.daysRemaining}d left`}
                </span>
              </button>
            ))}
          </div>
        );
      }
      case 'temperature': {
        const t = summary.temperature || { Hot: 0, Warm: 0, Cold: 0 };
        return (
          <Bars rows={[
            { label: 'Hot', value: t.Hot, color: '#912018' },
            { label: 'Warm', value: t.Warm, color: '#b54708' },
            { label: 'Cold', value: t.Cold, color: '#0b4a6f' },
          ]} />
        );
      }
      case 'modules':
        return (
          <Bars rows={(summary.modules || []).map((m) => ({ label: m.label, value: m.count, color: MODULE_COLORS[m.id] || '#374151', text: `${m.count} · ${formatMoney(m.amount)}` }))} />
        );
      case 'pipeline': {
        const p = summary.pipeline;
        return (
          <>
            <Bars rows={[
              { label: 'Open', value: p.pending, color: '#312e81' },
              { label: 'Completed', value: p.completed, color: '#166534' },
              { label: 'Lost', value: p.cancelled, color: '#4b5563' },
            ]} />
            <div className="mp-muted">{p.conversionRate}% of all records became sales</div>
          </>
        );
      }
      case 'activity': {
        const list = (summary.recentActivities || []).slice(0, 6);
        if (!list.length) return <div className="mp-muted">No recent activity.</div>;
        return (
          <div className="dw-list">
            {list.map((a) => (
              <div key={a.ID} className="dw-item dw-static">
                <strong>{a.ByName}</strong>
                <span className="mp-muted">
                  {a.Type}{a.Outcome ? ` · ${a.Outcome}` : ''}{a.Notes ? ` — ${a.Notes}` : ''}
                </span>
                <span className="mp-muted">{formatTimeAgo(a.Date)}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'discounts': {
        const list = summary.pendingDiscounts || [];
        if (!list.length) return <div className="mp-muted">Nothing waiting.</div>;
        return (
          <div className="dw-list">
            {list.map((d) => (
              <button key={d.ID} type="button" className="dw-item" onClick={() => go('medpass')}>
                <strong>{d.CustomerName}</strong>
                <span className="mp-muted">− {formatMoney(d.DiscountAmount)} · {d.DiscountReason}</span>
                <span className="dw-when today">{isSeniorRole(user.Role) ? 'Review' : 'Waiting'}</span>
              </button>
            ))}
          </div>
        );
      }
      case 'team': {
        const rows = summary.agents || [];
        if (!rows.length) return <div className="mp-muted">No completed sales yet.</div>;
        return (
          <>
            <div className="dw-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    {(summary.modules || []).map((m) => <th key={m.id}>{m.label}</th>)}
                    <th>Incentive</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a: any) => (
                    <tr key={a.agentEmail}>
                      <td>{a.agentName}</td>
                      {(summary.modules || []).map((m) => (
                        <td key={m.id}>{a[`${m.id}Count`] ?? 0} · {formatMoney(a[`${m.id}Amount`] ?? 0)}</td>
                      ))}
                      <td>{a.incentive === undefined ? '—' : formatMoney(a.incentive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="mp-link" onClick={exportTeam}>Export CSV</button>
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="mp-header">
        <div className="mp-title">
          <h1>Dashboard</h1>
          <p className="subtitle">{isTeam ? 'The whole team' : 'Your own patients and sales'}</p>
        </div>
        <div className="mp-actions">
          {editing ? (
            <>
              <button type="button" className="mp-btn" onClick={cancel}>Cancel</button>
              <button type="button" className="mp-btn-primary" onClick={save} disabled={saving || layout.length === 0}>
                {saving ? 'Saving…' : 'Save layout'}
              </button>
            </>
          ) : (
            <button type="button" className="mp-btn" onClick={() => setEditing(true)}>Customize</button>
          )}
        </div>
      </div>

      <main>
        {error && <div className="contact-check blocking" style={{ marginBottom: '12px' }}>{error}</div>}

        {editing && (
          <section className="dw-customize" aria-label="Customize the dashboard">
            <strong>Add a widget:</strong>
            {available.map((w) => (
              <button key={w.id} type="button" className="mp-chip" onClick={() => add(w.id)}>+ {w.title}</button>
            ))}
            {available.length === 0 && <span className="mp-muted">Every widget for your role is on the dashboard.</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="mp-link" onClick={reset}>Reset to the default for your role</button>
            {isSeniorRole(user.Role) && (
              <>
                <button type="button" className="mp-link" onClick={() => saveAsDefault('team')}>Make this the team default</button>
                <button type="button" className="mp-link" onClick={() => saveAsDefault('agent')}>Make this the agent default</button>
              </>
            )}
            <div className="mp-muted" style={{ flexBasis: '100%' }}>
              Your layout is saved for you only. Moving or adding widgets never changes what you can see: the server still filters every widget by your role.
            </div>
          </section>
        )}

        <div className="dw-grid">
          {layout.map((w, i) => (
            <article key={w.id} className={`dw-card${editing ? ' editing' : ''}`} style={{ gridColumn: `span ${w.span}` }}>
              <div className="dw-card-head">
                <h2>{titleOf(w.id)}</h2>
                {editing && (
                  <span className="dw-tools">
                    <button type="button" onClick={() => move(i, -1)} aria-label={`Move ${titleOf(w.id)} earlier`} disabled={i === 0}>←</button>
                    <button type="button" onClick={() => move(i, 1)} aria-label={`Move ${titleOf(w.id)} later`} disabled={i === layout.length - 1}>→</button>
                    <button type="button" onClick={() => resize(i)} aria-label={`Change size of ${titleOf(w.id)}`}>{SIZE_NAMES[w.span]}</button>
                    <button type="button" onClick={() => remove(i)} aria-label={`Remove ${titleOf(w.id)}`}>✕</button>
                  </span>
                )}
              </div>
              {widget(w.id)}
            </article>
          ))}
        </div>
        {!editing && layout.length === 0 && info && (
          <div className="mp-empty">Your dashboard is empty. Choose Customize to add widgets.</div>
        )}
      </main>
    </div>
  );
};
