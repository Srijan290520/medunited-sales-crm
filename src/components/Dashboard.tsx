import React, { useEffect, useState, useRef } from 'react';
import { User, DashboardSummary, UrgentFollowUpItem, AuditEntry, SaleActivity } from '../types';
import { api } from '../services/api';
import { formatMoney, initials, todayKey, formatDate } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';
import { Chart, registerables } from 'chart.js';
import { ActivePage } from './Sidebar';

Chart.register(...registerables);

interface DashboardProps {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
  onNavigate?: (page: ActivePage) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, onToast, onNavigate }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const salesChartRef = useRef<HTMLCanvasElement | null>(null);
  const secondaryChartRef = useRef<HTMLCanvasElement | null>(null);
  const salesChartInstance = useRef<Chart | null>(null);
  const secondaryChartInstance = useRef<Chart | null>(null);
  const [usefulChartType, setUsefulChartType] = useState<'pipeline' | 'medications' | 'payments'>('pipeline');
  const [activityFilter, setActivityFilter] = useState<'all' | 'audits' | 'calls'>('all');

  const canSeeIncentives = user.Role === 'admin' || user.Role === 'manager';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.dashboardSummary();
      if (res.error) {
        setError(res.message || 'Could not load dashboard data.');
      } else {
        setSummary(res.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Render charts when summary or chart view changes
  useEffect(() => {
    if (!summary) return;

    const agents = summary.agents;
    const labels = agents.map((a) => a.agentName);

    // Sales Chart
    if (salesChartRef.current) {
      if (salesChartInstance.current) {
        salesChartInstance.current.destroy();
      }
      salesChartInstance.current = new Chart(salesChartRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Medpass',
              data: agents.map((a) => a.medpassCount),
              backgroundColor: '#6366f1',
              borderRadius: 4,
            },
            {
              label: 'Pharmacy',
              data: agents.map((a) => a.pharmacyCount),
              backgroundColor: '#10b981',
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 },
            },
          },
        },
      });
    }

    // Secondary Useful Chart (Pipeline, Top Medications, or Payment Modes)
    if (secondaryChartRef.current) {
      if (secondaryChartInstance.current) {
        secondaryChartInstance.current.destroy();
      }

      if (usefulChartType === 'pipeline') {
        const pipe = summary.pipeline || { completed: 0, pending: 0, cancelled: 0, totalLeads: 0, conversionRate: 0 };
        secondaryChartInstance.current = new Chart(secondaryChartRef.current, {
          type: 'doughnut',
          data: {
            labels: ['Won / Completed', 'In Pipeline / Pending', 'Lost / Cancelled'],
            datasets: [
              {
                data: [pipe.completed, pipe.pending, pipe.cancelled],
                backgroundColor: ['#10b981', '#6366f1', '#ef4444'],
                borderWidth: 2,
                borderColor: '#ffffff',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const total = pipe.totalLeads || 1;
                    const val = Number(ctx.raw) || 0;
                    const pct = Math.round((val / total) * 100);
                    return ` ${ctx.label}: ${val} leads (${pct}%)`;
                  },
                },
              },
            },
          },
        });
      } else if (usefulChartType === 'medications') {
        const meds = (summary.topMedications && summary.topMedications.length > 0)
          ? summary.topMedications
          : [{ name: 'No medications recorded yet', prescriptions: 0, totalUnits: 0 }];

        secondaryChartInstance.current = new Chart(secondaryChartRef.current, {
          type: 'bar',
          data: {
            labels: meds.map((m) => m.name),
            datasets: [
              {
                label: 'Prescription Count',
                data: meds.map((m) => m.prescriptions),
                backgroundColor: '#06b6d4',
                borderRadius: 4,
              },
              {
                label: 'Total Units Dispensed',
                data: meds.map((m) => m.totalUnits),
                backgroundColor: '#8b5cf6',
                borderRadius: 4,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top' },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { precision: 0 },
              },
            },
          },
        });
      } else if (usefulChartType === 'payments') {
        const payments = (summary.paymentBreakdown && summary.paymentBreakdown.length > 0)
          ? summary.paymentBreakdown
          : [{ method: 'UPI', count: 0, amount: 0 }];

        secondaryChartInstance.current = new Chart(secondaryChartRef.current, {
          type: 'doughnut',
          data: {
            labels: payments.map((p) => p.method),
            datasets: [
              {
                data: payments.map((p) => p.amount),
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#64748b'],
                borderWidth: 2,
                borderColor: '#ffffff',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const val = Number(ctx.raw) || 0;
                    return ` ${ctx.label}: ₹${val.toLocaleString('en-IN')}`;
                  },
                },
              },
            },
          },
        });
      }
    }

    return () => {
      if (salesChartInstance.current) salesChartInstance.current.destroy();
      if (secondaryChartInstance.current) secondaryChartInstance.current.destroy();
    };
  }, [summary, usefulChartType]);

  // Combined and sorted activity stream
  const activities = summary?.recentActivities || [];
  const audits = summary?.recentAudits || [];

  const combinedFeed: Array<{
    id: string;
    type: 'audit' | 'activity';
    timestamp: string;
    title: string;
    subtitle: string;
    badge: string;
    isDelete: boolean;
  }> = [];

  audits.forEach((aud) => {
    const isDelete = aud.Action === 'delete';
    combinedFeed.push({
      id: aud.ID,
      type: 'audit',
      timestamp: aud.Date,
      title: aud.Summary,
      subtitle: `${aud.ByName} (${aud.ByRole || 'User'}) · ${(String(aud.RecordType || '').replace(/Sale$/, '') || 'record').toUpperCase()}`,
      badge: isDelete ? 'DELETE' : aud.Action.toUpperCase(),
      isDelete,
    });
  });

  activities.forEach((act) => {
    combinedFeed.push({
      id: act.ID,
      type: 'activity',
      timestamp: act.Date,
      title: `${act.Type} (${act.Direction}): ${act.Outcome}`,
      subtitle: `${act.ByName} — ${act.Notes || 'No notes logged'}`,
      badge: act.Type.toUpperCase(),
      isDelete: false,
    });
  });

  combinedFeed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const filteredFeed = combinedFeed.filter((item) => {
    if (activityFilter === 'audits') return item.type === 'audit';
    if (activityFilter === 'calls') return item.type === 'activity';
    return true;
  });

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">
            {user.Role === 'agent' ? 'Your sales performance' : 'Medpass & Pharmacy team performance overview'}
          </p>
        </div>
        <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--surface)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
            <span>Live Sync · {formatDate(todayKey())}</span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={loadData}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <main>
        {error && (
          <div className="inline-error">
            <span>{error}</span>
            <button type="button" className="secondary" onClick={loadData}>
              Retry
            </button>
          </div>
        )}

        {/* KPI Grid */}
        <div className={`kpi-grid ${loading ? 'is-loading' : ''}`}>
          <div className="kpi-card">
            <div className="kpi-icon blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </div>
            <div>
              <div className="kpi-value">{loading ? '…' : summary?.totals.medpassCount ?? 0}</div>
              <div className="kpi-label">Completed Medpass Sales</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="7" width="15" height="11" rx="1.5"></rect>
                <path d="M16 10h3.5L22 13.5V18h-6"></path>
                <circle cx="6" cy="19.5" r="1.7"></circle>
                <circle cx="17.5" cy="19.5" r="1.7"></circle>
              </svg>
            </div>
            <div>
              <div className="kpi-value">{loading ? '…' : summary?.totals.pharmacyCount ?? 0}</div>
              <div className="kpi-label">Completed Pharmacy Sales</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12"></path>
                <path d="M6 8h12"></path>
                <path d="M6 13l8.5 8"></path>
                <path d="M6 13h3a4.5 4.5 0 0 0 0-9H6"></path>
              </svg>
            </div>
            <div>
              <div className="kpi-value">{loading ? '…' : formatMoney(summary?.totals.medpassAmount ?? 0)}</div>
              <div className="kpi-label">Medpass Revenue</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon violet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12"></path>
                <path d="M6 8h12"></path>
                <path d="M6 13l8.5 8"></path>
                <path d="M6 13h3a4.5 4.5 0 0 0 0-9H6"></path>
              </svg>
            </div>
            <div>
              <div className="kpi-value">{loading ? '…' : formatMoney(summary?.totals.pharmacyAmount ?? 0)}</div>
              <div className="kpi-label">Pharmacy Revenue</div>
            </div>
          </div>
        </div>

        {/* Monthly Target Progress Banner */}
        <div className="target-banner-card">
          <div className="target-banner-header">
            <div>
              <span style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#a5b4fc', fontWeight: 600 }}>
                🎯 Target &amp; Goal Tracking
              </span>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '2px' }}>
                Monthly Revenue Progress: {formatMoney(summary?.monthlyTarget?.currentAmount ?? 0)} of {formatMoney(summary?.monthlyTarget?.targetAmount ?? 500000)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34d399' }}>
                {summary?.monthlyTarget?.percentage ?? 0}%
              </span>
              <div style={{ fontSize: '0.72rem', color: '#c7d2fe' }}>Goal Achieved</div>
            </div>
          </div>

          <div className="target-progress-track">
            <div
              className="target-progress-fill"
              style={{ width: `${Math.min(100, summary?.monthlyTarget?.percentage ?? 0)}%` }}
            />
          </div>

          <div className="target-stats-row">
            <div className="target-stat-item">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#818cf8' }}></span>
              <span>Medpass: {formatMoney(summary?.totals.medpassAmount ?? 0)} ({summary?.totals.medpassCount ?? 0} plans)</span>
            </div>
            <div className="target-stat-item">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
              <span>Pharmacy: {formatMoney(summary?.totals.pharmacyAmount ?? 0)} ({summary?.totals.pharmacyCount ?? 0} orders)</span>
            </div>
            <div className="target-stat-item">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24' }}></span>
              <span>Total Orders: {(summary?.totals.medpassCount ?? 0) + (summary?.totals.pharmacyCount ?? 0)} completed</span>
            </div>
          </div>
        </div>

        {/* Charts Container */}
        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div className="chart-card card" style={{ minHeight: '340px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Sales Volume by Agent</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Medpass vs Pharmacy</span>
            </div>
            <div style={{ height: '250px', position: 'relative' }}>
              <canvas ref={salesChartRef}></canvas>
            </div>
          </div>

          <div className="chart-card card" style={{ minHeight: '340px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {usefulChartType === 'pipeline' && 'Lead Conversion & Pipeline'}
                  {usefulChartType === 'medications' && 'Top Prescribed Medicines'}
                  {usefulChartType === 'payments' && 'Revenue by Payment Mode'}
                </h2>
                {usefulChartType === 'pipeline' && summary?.pipeline && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#dcfce7', color: '#166534' }}>
                    {summary.pipeline.conversionRate}% Win Rate
                  </span>
                )}
              </div>
              <div className="tab-pill-group" style={{ display: 'inline-flex', background: 'var(--bg)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: usefulChartType === 'pipeline' ? 'var(--surface)' : 'transparent',
                    color: usefulChartType === 'pipeline' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: usefulChartType === 'pipeline' ? 600 : 500,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    boxShadow: usefulChartType === 'pipeline' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                  onClick={() => setUsefulChartType('pipeline')}
                >
                  Pipeline
                </button>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: usefulChartType === 'medications' ? 'var(--surface)' : 'transparent',
                    color: usefulChartType === 'medications' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: usefulChartType === 'medications' ? 600 : 500,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    boxShadow: usefulChartType === 'medications' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                  onClick={() => setUsefulChartType('medications')}
                >
                  Top Meds
                </button>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: usefulChartType === 'payments' ? 'var(--surface)' : 'transparent',
                    color: usefulChartType === 'payments' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: usefulChartType === 'payments' ? 600 : 500,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    boxShadow: usefulChartType === 'payments' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                  onClick={() => setUsefulChartType('payments')}
                >
                  Payments
                </button>
              </div>
            </div>

            {/* Always-Visible Visual Summary Panel so it is never blank */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {usefulChartType === 'pipeline' && (
                <>
                  <div style={{ flex: 1, minWidth: '90px', padding: '6px 10px', background: '#ecfdf5', borderRadius: '6px', border: '1px solid #d1fae5' }}>
                    <div style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 600 }}>Won / Completed</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#065f46' }}>{summary?.pipeline.completed ?? 0}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: '90px', padding: '6px 10px', background: '#eef2ff', borderRadius: '6px', border: '1px solid #e0e7ff' }}>
                    <div style={{ fontSize: '0.7rem', color: '#4338ca', fontWeight: 600 }}>In Pipeline</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#3730a3' }}>{summary?.pipeline.pending ?? 0}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: '90px', padding: '6px 10px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fee2e2' }}>
                    <div style={{ fontSize: '0.7rem', color: '#b91c1c', fontWeight: 600 }}>Lost / Cancelled</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#991b1b' }}>{summary?.pipeline.cancelled ?? 0}</div>
                  </div>
                </>
              )}
              {usefulChartType === 'medications' && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  Total unique prescribed medicines tracked: <strong>{summary?.topMedications.length ?? 0}</strong>
                </div>
              )}
              {usefulChartType === 'payments' && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  Active payment channels: <strong>{summary?.paymentBreakdown.length ?? 0}</strong>
                </div>
              )}
            </div>

            <div style={{ height: '210px', position: 'relative' }}>
              <canvas ref={secondaryChartRef}></canvas>
            </div>
          </div>
        </div>

        {/* Performance Table */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div className="card-title" style={{ margin: 0 }}>
              {user.Role === 'agent' ? 'My Performance' : 'Team Performance'}
            </div>
            {canSeeIncentives && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!canSeeIncentives) {
                    onToast('Access denied: Export is only available for Managers and Admins.', 'error');
                    return;
                  }
                  if (!summary || summary.agents.length === 0) {
                    onToast('No performance records to export.', 'error');
                    return;
                  }
                  const columns: CsvColumn<any>[] = [
                    { header: 'Agent Name', accessor: (a) => a.agentName },
                    { header: 'Agent Email', accessor: (a) => a.agentEmail },
                    { header: 'Medpass Sales Count', accessor: (a) => a.medpassCount },
                    { header: 'Medpass Revenue (INR)', accessor: (a) => a.medpassAmount },
                    { header: 'Pharmacy Sales Count', accessor: (a) => a.pharmacyCount },
                    { header: 'Pharmacy Revenue (INR)', accessor: (a) => a.pharmacyAmount },
                    { header: 'Total Orders Closed', accessor: (a) => a.medpassCount + a.pharmacyCount },
                    { header: 'Total Revenue (INR)', accessor: (a) => a.medpassAmount + a.pharmacyAmount },
                    { header: 'Incentive Commission (INR)', accessor: (a) => a.incentive ?? 0 },
                  ];
                  const timestamp = todayKey();
                  exportToCsv(`MedUnited_Team_Performance_${timestamp}.csv`, columns, summary.agents);
                  onToast(`Exported performance report for ${summary.agents.length} agents to CSV`, 'success');
                }}
                title="Export performance report to CSV (Managers & Admins only)"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Export Report</span>
              </button>
            )}
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Medpass Sales</th>
                  <th>Pharmacy Sales</th>
                  <th>Medpass Revenue</th>
                  <th>Pharmacy Revenue</th>
                  {canSeeIncentives && <th>Incentive</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row">
                    <td colSpan={canSeeIncentives ? 6 : 5}>Loading…</td>
                  </tr>
                ) : !summary || summary.agents.length === 0 ? (
                  <tr>
                    <td colSpan={canSeeIncentives ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      No sales on record yet.
                    </td>
                  </tr>
                ) : (
                  summary.agents.map((a) => (
                    <tr key={a.agentEmail}>
                      <td>
                        <div className="table-person">
                          <span className="avatar-sm">{initials(a.agentName)}</span>
                          <span>{a.agentName}</span>
                        </div>
                      </td>
                      <td>{a.medpassCount}</td>
                      <td>{a.pharmacyCount}</td>
                      <td>{formatMoney(a.medpassAmount)}</td>
                      <td>{formatMoney(a.pharmacyAmount)}</td>
                      {canSeeIncentives && (
                        <td>
                          <strong>{formatMoney(a.incentive ?? 0)}</strong>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Center & Activity Stream (Populates formerly blank lower dashboard) */}
        <div className="dashboard-extra-grid">
          {/* Action Center: Priority Follow-ups */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚡</span> Priority Action Center
                </h2>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Hot leads due for contact &amp; follow-up today
                </div>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                  onClick={() => onNavigate('medpass')}
                >
                  View All Leads &rarr;
                </button>
              )}
            </div>

            {(!summary?.urgentFollowUps || summary.urgentFollowUps.length === 0) ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>✅</div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#166534' }}>All follow-ups up to date!</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  No overdue contacts or pending calls for today.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {summary.urgentFollowUps.map((item) => (
                  <div key={item.id} className="urgent-followup-card">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                          {item.customerName}
                        </span>
                        <span className={`temp-badge ${item.temperature.toLowerCase()}`} style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                          {item.temperature}
                        </span>
                        {item.followUpStatus === 'overdue' && (
                          <span className="reminder-badge overdue small" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                            Overdue
                          </span>
                        )}
                        {item.followUpStatus === 'today' && (
                          <span className="reminder-badge upcoming small" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                            Due Today
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.detail || item.notes || 'Inquiry pending follow-up'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        👤 {item.agentName} · 📞 {item.contact} · {formatMoney(item.amount)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        type="button"
                        style={{
                          background: '#ecfdf5',
                          color: '#065f46',
                          border: '1px solid #a7f3d0',
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        onClick={() => {
                          const cleanPhone = item.contact.replace(/\D/g, '');
                          window.open(`https://wa.me/91${cleanPhone}?text=Hello%20${encodeURIComponent(item.customerName)},%20reaching%20out%20from%20MedUnited.`, '_blank', 'noopener,noreferrer');
                        }}
                        title="Open WhatsApp chat"
                      >
                        💬 WhatsApp
                      </button>
                      {onNavigate && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                          onClick={() => onNavigate(item.type)}
                          title="Open sales board"
                        >
                          View &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Activity & Audit Trail (Shows Deletion Logs with Reason) */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📜</span> Live Activity &amp; Audit Trail
                </h2>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  All updates, calls, and administrator deletions with reasons
                </div>
              </div>

              <div className="tab-pill-group" style={{ display: 'inline-flex', background: 'var(--bg)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: activityFilter === 'all' ? 'var(--surface)' : 'transparent',
                    color: activityFilter === 'all' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: activityFilter === 'all' ? 600 : 500,
                    padding: '3px 7px',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActivityFilter('all')}
                >
                  All
                </button>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: activityFilter === 'audits' ? 'var(--surface)' : 'transparent',
                    color: activityFilter === 'audits' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: activityFilter === 'audits' ? 600 : 500,
                    padding: '3px 7px',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActivityFilter('audits')}
                >
                  Audits
                </button>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: activityFilter === 'calls' ? 'var(--surface)' : 'transparent',
                    color: activityFilter === 'calls' ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: activityFilter === 'calls' ? 600 : 500,
                    padding: '3px 7px',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActivityFilter('calls')}
                >
                  Calls
                </button>
              </div>
            </div>

            {filteredFeed.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No recent activity recorded yet.
              </div>
            ) : (
              <div className="activity-feed-list">
                {filteredFeed.map((item) => (
                  <div key={item.id} className={`activity-feed-item ${item.isDelete ? 'is-delete' : ''}`}>
                    <div className={`activity-icon-bubble ${item.isDelete ? 'delete' : item.badge === 'CALL' ? 'call' : 'complete'}`}>
                      {item.isDelete ? '🗑️' : item.badge === 'CALL' ? '📞' : item.badge === 'WHATSAPP' ? '💬' : '📝'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: item.isDelete ? '#991b1b' : 'var(--text-primary)', fontSize: '0.82rem' }}>
                          {item.title}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {formatDate(item.timestamp)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: item.isDelete ? '#b91c1c' : 'var(--text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
