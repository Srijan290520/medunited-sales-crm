import React, { useEffect, useState } from 'react';
import { User, IncentiveReport, IncentiveAgent } from '../types';
import { api } from '../services/api';
import { formatMoney, formatDate, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

// Incentives for a month: per module and per agent, with the sales behind
// each amount. Managers and above only (the server refuses agents).
export const IncentivesView: React.FC<Props> = ({ onToast }) => {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [report, setReport] = useState<IncentiveReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setOpen(null);
    api.incentiveReport(month).then((res) => {
      setLoading(false);
      if (res.error) onToast(res.message || 'Could not load incentives.', 'error');
      else setReport(res.report);
    });
  }, [month]);

  const exportPayout = () => {
    if (!report) return;
    const columns: CsvColumn<IncentiveAgent>[] = [
      { header: 'Month', accessor: () => report.month },
      { header: 'Agent', accessor: (a) => a.agentName },
      { header: 'Agent Email', accessor: (a) => a.agentEmail },
      ...report.modules.flatMap((m) => [
        { header: `${m.label} sales`, accessor: (a: IncentiveAgent) => a.modules[m.id]?.count ?? 0 },
        { header: `${m.label} revenue (INR)`, accessor: (a: IncentiveAgent) => a.modules[m.id]?.amount ?? 0 },
        { header: `${m.label} incentive (INR)`, accessor: (a: IncentiveAgent) => a.modules[m.id]?.incentive ?? 0 },
      ]),
      { header: 'Total revenue (INR)', accessor: (a) => a.amount },
      { header: 'Total incentive (INR)', accessor: (a) => a.incentive },
    ];
    exportToCsv(`MedUnited_Incentive_Payout_${report.month}.csv`, columns, report.agents);
    onToast(`Payout sheet for ${report.month} exported.`, 'success');
  };

  const exportSales = () => {
    if (!report) return;
    const rows = report.agents.flatMap((a) => a.sales.map((s) => ({ ...s, agentName: a.agentName, agentEmail: a.agentEmail })));
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: 'Agent', accessor: (r) => r.agentName },
      { header: 'Agent Email', accessor: (r) => r.agentEmail },
      { header: 'Module', accessor: (r) => r.moduleLabel },
      { header: 'Record ID', accessor: (r) => r.id },
      { header: 'Date', accessor: (r) => r.date },
      { header: 'Customer', accessor: (r) => r.customerName },
      { header: 'Price type', accessor: (r) => r.priceType },
      { header: 'Amount (INR)', accessor: (r) => r.amount },
      { header: 'Incentive (INR)', accessor: (r) => r.incentive },
    ];
    exportToCsv(`MedUnited_Incentive_Sales_${report.month}.csv`, columns, rows);
  };

  return (
    <div>
      <div className="mp-header">
        <div className="mp-title">
          <h1>Incentives</h1>
          <p className="subtitle">Completed sales and the incentive each earned, by month</p>
        </div>
        <div className="mp-actions">
          <label htmlFor="inc-month" className="sr-only">Month</label>
          <input id="inc-month" type="month" className="mp-search" style={{ width: '180px' }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button type="button" className="mp-btn" onClick={exportSales} disabled={!report || !report.agents.length}>Export sales</button>
          <button type="button" className="mp-btn-primary" onClick={exportPayout} disabled={!report || !report.agents.length}>Export payout sheet</button>
        </div>
      </div>
      <main>
        {report && (
          <div className="dw-grid" style={{ marginBottom: '16px' }}>
            {report.modules.map((m) => {
              const t = report.totals.modules[m.id] || { count: 0, amount: 0, incentive: 0 };
              return (
                <article key={m.id} className="dw-card" style={{ gridColumn: 'span 3' }}>
                  <div className="dw-card-head"><h2>{m.label}</h2></div>
                  <div className="dw-big">{m.incentive === 'none' ? '—' : formatMoney(t.incentive)}</div>
                  <div className="mp-muted">
                    {t.count} sale{t.count === 1 ? '' : 's'} · {formatMoney(t.amount)}{m.incentive === 'none' ? ' · no incentive rule yet' : ''}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <section className="mp-list" aria-label="Incentives by agent">
          <div className="mp-list-head">
            <strong style={{ flex: 1 }}>{report ? `${report.agents.length} agent${report.agents.length === 1 ? '' : 's'} with sales in ${report.month}` : ''}</strong>
            {report && <span>Total incentive {formatMoney(report.totals.incentive)}</span>}
          </div>
          {loading && <div className="mp-empty">Loading…</div>}
          {!loading && report && report.agents.length === 0 && <div className="mp-empty">No completed sales in this month.</div>}
          {!loading && report && report.agents.map((a) => (
            <div key={a.agentEmail}>
              <div className={`mp-row${open === a.agentEmail ? ' selected' : ''}`}>
                <button type="button" className="mp-row-main" aria-expanded={open === a.agentEmail} onClick={() => setOpen(open === a.agentEmail ? null : a.agentEmail)}>
                  <span className="mp-who"><strong>{a.agentName}</strong><small>{a.agentEmail}</small></span>
                  {report.modules.map((m) => (
                    <span key={m.id} className="mp-due" style={{ flexBasis: '150px' }}>
                      {m.label}: {a.modules[m.id]?.count ?? 0} · {m.incentive === 'none' ? '—' : formatMoney(a.modules[m.id]?.incentive ?? 0)}
                    </span>
                  ))}
                  <span className="mp-amount" style={{ flexBasis: '110px', fontWeight: 700 }}>{formatMoney(a.incentive)}</span>
                </button>
              </div>
              {open === a.agentEmail && (
                <div className="dw-table-wrap" style={{ padding: '0 18px 12px' }}>
                  <table className="data-table">
                    <thead>
                      <tr><th>Date</th><th>Module</th><th>Customer</th><th>Price type</th><th>Amount</th><th>Incentive</th></tr>
                    </thead>
                    <tbody>
                      {a.sales.map((s) => (
                        <tr key={s.id}>
                          <td>{formatDate(s.date)}</td>
                          <td>{s.moduleLabel}</td>
                          <td>{s.customerName}</td>
                          <td>{s.priceType || '—'}</td>
                          <td>{formatMoney(s.amount)}</td>
                          <td>{formatMoney(s.incentive)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </section>
        <p className="mp-muted" style={{ marginTop: '10px' }}>
          Uses each agent's current rates (Settings → Incentive rates). Agents don't see incentive amounts.
        </p>
      </main>
    </div>
  );
};
