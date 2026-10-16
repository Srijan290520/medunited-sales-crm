import React, { useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { isTeamRole } from '../utils/roles';
import { api } from '../services/api';
import { formatMoney, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

interface Stats { count: number; amount: number; leads: number; avg: number }
interface Perf {
  month: string;
  scope: { type: 'team' } | { type: 'agent'; email: string; name: string };
  canPickAgent: boolean;
  compare: { thisMonth: Stats; lastMonth: Stats; sameMonthLastYear: Stats; ytd: Stats; ytdLastYear: Stats };
  series: ({ month: string } & Stats)[];
  modules: { id: string; label: string; thisMonth: Stats; lastMonth: Stats }[];
  agents: { email: string; name: string; active: boolean; rank: number; thisMonth: Stats; lastMonth: Stats; ytd: Stats; ytdLastYear: Stats }[] | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m: string, withYear = true) => {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS[mo - 1]}${withYear ? ' ' + y : ''}`;
};
// Validated pair (dataviz validator, light surface): this year / a year earlier.
const SERIES = { now: '#2a78d6', before: '#eb6834' };

// "▲ 12% (+₹3,000)" — the arrow and the sign carry the direction, not colour alone.
// `label` is left out in tables, where the column header already says what it's against.
const Delta: React.FC<{ now: number; before: number; money?: boolean; label?: string }> = ({ now, before, money, label }) => {
  const diff = now - before;
  const pct = before ? Math.round((diff / before) * 100) : null;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const abs = money ? formatMoney(Math.abs(diff)) : String(Math.abs(diff));
  return (
    <div className={`pf-delta ${dir}${label ? '' : ' compact'}`}>
      <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}</span>{' '}
      {dir === 'flat' ? 'No change' : `${pct === null ? 'New' : `${sign}${Math.abs(pct)}%`} (${sign}${abs})`}
      {label && <span className="pf-delta-label"> vs {label}</span>}
    </div>
  );
};

// 12 months, this year vs the same months a year earlier. One axis.
const TrendChart: React.FC<{ series: Perf['series']; metric: 'amount' | 'count' }> = ({ series, metric }) => {
  const [hover, setHover] = useState<number | null>(null);
  const now = series.slice(12);
  const before = series.slice(0, 12);
  const W = 720, H = 260, L = 56, R = 12, T = 16, B = 32;
  const max = Math.max(1, ...now.map((s) => s[metric]), ...before.map((s) => s[metric]));
  // Round axis steps: 1, 2 or 5 × a power of ten, four or five gridlines.
  const { nice, step } = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / p;
    const top = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    return { nice: top, step: f > 1 && f <= 2 ? top / 4 : top / 5 };
  })();
  const ticks = Array.from({ length: Math.round(nice / step) + 1 }, (_, i) => i * step);
  const plotW = W - L - R, plotH = H - T - B;
  const col = plotW / 12;
  const barW = Math.min(18, (col - 10) / 2);
  const y = (v: number) => T + plotH - (v / nice) * plotH;
  const fmt = (v: number) => (metric === 'amount' ? (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`) : String(v));
  // Bars with 4px rounded tops, flat on the baseline.
  const bar = (x: number, v: number) => {
    const top = y(v), h = T + plotH - top, r = Math.min(4, h, barW / 2);
    if (h <= 0) return '';
    return `M${x},${T + plotH}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${T + plotH}Z`;
  };
  const last = 11;
  return (
    <div className="pf-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric === 'amount' ? 'Revenue' : 'Sales'} for the last 12 months, compared with a year earlier`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#4b5563">{fmt(t)}</text>
          </g>
        ))}
        {now.map((s, i) => {
          const cx = L + col * i + col / 2;
          const xb = cx - barW - 1, xn = cx + 1; // 2px gap between the pair
          return (
            <g key={s.month}>
              <path d={bar(xb, before[i][metric])} fill={SERIES.before} />
              <path d={bar(xn, s[metric])} fill={SERIES.now} />
              <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill={i === last ? '#111827' : '#4b5563'} fontWeight={i === last ? 700 : 400}>
                {monthName(s.month, false)}
              </text>
              {i === last && s[metric] > 0 && (
                <text x={xn + barW / 2} y={y(s[metric]) - 6} textAnchor="middle" fontSize="11" fill="#111827" fontWeight="600">{fmt(s[metric])}</text>
              )}
              {/* Hit target: the whole month column, wider than the bars. */}
              <rect x={L + col * i} y={T} width={col} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                aria-label={`${monthName(s.month)}: ${fmt(s[metric])}; ${monthName(before[i].month)}: ${fmt(before[i][metric])}`} />
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={T + plotH} y2={T + plotH} stroke="#9ca3af" strokeWidth="1" />
        {hover !== null && <line x1={L + col * hover + col / 2} x2={L + col * hover + col / 2} y1={T} y2={T + plotH} stroke="#9ca3af" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div className="pf-tip" style={{ left: `${((L + col * hover + col / 2) / W) * 100}%` }}>
          <div className="pf-tip-row"><span className="pf-key" style={{ background: SERIES.now }} />{monthName(now[hover].month)}: <strong>{metric === 'amount' ? formatMoney(now[hover].amount) : now[hover].count}</strong> · {now[hover].count} sale{now[hover].count === 1 ? '' : 's'}</div>
          <div className="pf-tip-row"><span className="pf-key" style={{ background: SERIES.before }} />{monthName(before[hover].month)}: <strong>{metric === 'amount' ? formatMoney(before[hover].amount) : before[hover].count}</strong></div>
        </div>
      )}
    </div>
  );
};

export const PerformanceView: React.FC<Props> = ({ user, onToast }) => {
  const isTeam = isTeamRole(user.Role);
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [agentEmail, setAgentEmail] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [metric, setMetric] = useState<'amount' | 'count'>('amount');
  const [asTable, setAsTable] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (!isTeam) return;
    api.listUsers().then((res) => {
      if (!res.error) setPeople((res.users || []).filter((u: User) => u.Role === 'agent' || u.Role === 'manager'));
    });
  }, [isTeam]);

  useEffect(() => {
    setFailed('');
    api.performance(month, agentEmail).then((res) => {
      if (res.error) {
        setFailed(res.message || 'Could not load performance.');
        onToast(res.message || 'Could not load performance.', 'error');
      } else setPerf(res.performance);
    });
  }, [month, agentEmail]);

  const scopeName = !perf ? '' : perf.scope.type === 'team' ? 'The whole team' : perf.scope.email.toLowerCase() === user.Email.toLowerCase() ? 'Your performance' : perf.scope.name;
  const lastMonth = useMemo(() => (perf ? perf.series[22].month : ''), [perf]);
  const lastYear = useMemo(() => (perf ? perf.series[11].month : ''), [perf]);
  const yearLabel = perf ? `Jan–${monthName(perf.month, false)} ${perf.month.slice(0, 4)}` : '';

  const exportTeam = () => {
    if (!perf?.agents) return;
    const columns: CsvColumn<NonNullable<Perf['agents']>[number]>[] = [
      { header: 'Rank', accessor: (a) => a.rank },
      { header: 'Agent', accessor: (a) => a.name },
      { header: 'Email', accessor: (a) => a.email },
      { header: `Revenue ${perf.month}`, accessor: (a) => a.thisMonth.amount },
      { header: `Revenue ${lastMonth}`, accessor: (a) => a.lastMonth.amount },
      { header: `Sales ${perf.month}`, accessor: (a) => a.thisMonth.count },
      { header: `Sales ${lastMonth}`, accessor: (a) => a.lastMonth.count },
      { header: `New enquiries ${perf.month}`, accessor: (a) => a.thisMonth.leads },
      { header: `Revenue YTD ${perf.month.slice(0, 4)}`, accessor: (a) => a.ytd.amount },
      { header: 'Revenue same period last year', accessor: (a) => a.ytdLastYear.amount },
    ];
    exportToCsv(`MedUnited_Team_Performance_${perf.month}.csv`, columns, perf.agents);
  };

  const c = perf?.compare;
  const tiles = c
    ? [
        { label: 'Revenue', now: c.thisMonth.amount, last: c.lastMonth.amount, year: c.sameMonthLastYear.amount, money: true },
        { label: 'Sales', now: c.thisMonth.count, last: c.lastMonth.count, year: c.sameMonthLastYear.count, money: false },
        { label: 'New enquiries', now: c.thisMonth.leads, last: c.lastMonth.leads, year: c.sameMonthLastYear.leads, money: false },
        { label: 'Average sale', now: c.thisMonth.avg, last: c.lastMonth.avg, year: c.sameMonthLastYear.avg, money: true },
      ]
    : [];

  return (
    <div>
      <div className="mp-header">
        <div className="mp-title">
          <h1>Performance</h1>
          <p className="subtitle">{scopeName ? `${scopeName} · ` : ''}month by month, with comparisons</p>
        </div>
        <div className="mp-actions">
          <label htmlFor="pf-month" className="sr-only">Month</label>
          <input id="pf-month" type="month" className="mp-search" style={{ width: '180px' }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {isTeam && (
            <>
              <label htmlFor="pf-who" className="sr-only">Whose performance</label>
              <select id="pf-who" className="mp-search" style={{ width: '220px' }} value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)}>
                <option value="">Whole team</option>
                {people.map((p) => <option key={p.Email} value={p.Email}>{p.Name}{p.Active ? '' : ' (inactive)'}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
      <main>
        {!perf ? (
          <div className="mp-empty">{failed || 'Loading…'}</div>
        ) : (
          <>
            <div className="dw-grid" style={{ marginBottom: '16px' }}>
              {tiles.map((t) => (
                <article key={t.label} className="dw-card" style={{ gridColumn: 'span 3' }}>
                  <div className="dw-card-head"><h2>{t.label} · {monthName(perf.month)}</h2></div>
                  <div className="dw-big">{t.money ? formatMoney(t.now) : t.now}</div>
                  <Delta now={t.now} before={t.last} money={t.money} label={monthName(lastMonth)} />
                  <Delta now={t.now} before={t.year} money={t.money} label={monthName(lastYear)} />
                </article>
              ))}
            </div>

            <article className="dw-card" style={{ marginBottom: '16px' }}>
              <div className="dw-card-head"><h2>Year to date · {yearLabel}</h2></div>
              <div className="pf-ytd">
                <div><div className="dw-big">{formatMoney(c!.ytd.amount)}</div><Delta now={c!.ytd.amount} before={c!.ytdLastYear.amount} money label={`same period ${Number(perf.month.slice(0, 4)) - 1}`} /></div>
                <div><div className="dw-big">{c!.ytd.count} sales</div><Delta now={c!.ytd.count} before={c!.ytdLastYear.count} label={`same period ${Number(perf.month.slice(0, 4)) - 1}`} /></div>
                <div><div className="dw-big">{c!.ytd.leads} enquiries</div><Delta now={c!.ytd.leads} before={c!.ytdLastYear.leads} label={`same period ${Number(perf.month.slice(0, 4)) - 1}`} /></div>
              </div>
            </article>

            <article className="dw-card" style={{ marginBottom: '16px' }}>
              <div className="dw-card-head">
                <h2>Last 12 months</h2>
                <div role="group" aria-label="Measure" className="pf-seg">
                  <button type="button" aria-pressed={metric === 'amount'} className={metric === 'amount' ? 'on' : ''} onClick={() => setMetric('amount')}>Revenue</button>
                  <button type="button" aria-pressed={metric === 'count'} className={metric === 'count' ? 'on' : ''} onClick={() => setMetric('count')}>Sales</button>
                </div>
                <button type="button" className="mp-link" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show chart' : 'Show as table'}</button>
              </div>
              <div className="pf-legend">
                <span><span className="pf-key" style={{ background: SERIES.now }} />{monthName(perf.series[12].month)} – {monthName(perf.month)}</span>
                <span><span className="pf-key" style={{ background: SERIES.before }} />A year earlier</span>
              </div>
              {asTable ? (
                <div className="dw-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Month</th><th>Revenue</th><th>Sales</th><th>New enquiries</th><th>Revenue a year earlier</th><th>Sales a year earlier</th></tr></thead>
                    <tbody>
                      {perf.series.slice(12).map((s, i) => (
                        <tr key={s.month}><td>{monthName(s.month)}</td><td>{formatMoney(s.amount)}</td><td>{s.count}</td><td>{s.leads}</td><td>{formatMoney(perf.series[i].amount)}</td><td>{perf.series[i].count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <TrendChart series={perf.series} metric={metric} />
              )}
            </article>

            <article className="dw-card" style={{ marginBottom: '16px' }}>
              <div className="dw-card-head"><h2>By module · {monthName(perf.month)} vs {monthName(lastMonth)}</h2></div>
              <div className="dw-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Module</th><th>Revenue</th><th>Change vs last month</th><th>Sales</th><th>Last month</th><th>New enquiries</th></tr></thead>
                  <tbody>
                    {perf.modules.map((m) => (
                      <tr key={m.id}>
                        <td>{m.label}</td>
                        <td>{formatMoney(m.thisMonth.amount)}</td>
                        <td><Delta now={m.thisMonth.amount} before={m.lastMonth.amount} money /></td>
                        <td>{m.thisMonth.count}</td>
                        <td>{m.lastMonth.count} · {formatMoney(m.lastMonth.amount)}</td>
                        <td>{m.thisMonth.leads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            {perf.agents && (
              <article className="dw-card">
                <div className="dw-card-head">
                  <h2>Agents · {monthName(perf.month)} vs {monthName(lastMonth)}</h2>
                  <button type="button" className="mp-link" onClick={exportTeam} disabled={!perf.agents.length}>Export CSV</button>
                </div>
                {perf.agents.length === 0 ? (
                  <div className="mp-muted">No sales or enquiries in this period.</div>
                ) : (
                  <div className="dw-table-wrap">
                    <table className="data-table">
                      <thead><tr><th>#</th><th>Agent</th><th>Revenue</th><th>Change vs last month</th><th>Sales</th><th>New enquiries</th><th>Year to date</th><th>Year to date vs last year</th></tr></thead>
                      <tbody>
                        {perf.agents.map((a) => (
                          <tr key={a.email}>
                            <td>{a.rank}</td>
                            <td>
                              <button type="button" className="mp-link" style={{ padding: 0 }} onClick={() => setAgentEmail(a.email)}>{a.name}</button>
                              {!a.active && <span className="mp-muted"> (inactive)</span>}
                            </td>
                            <td>{formatMoney(a.thisMonth.amount)}</td>
                            <td><Delta now={a.thisMonth.amount} before={a.lastMonth.amount} money /></td>
                            <td>{a.thisMonth.count} <span className="mp-muted">({a.lastMonth.count} last month)</span></td>
                            <td>{a.thisMonth.leads}</td>
                            <td>{formatMoney(a.ytd.amount)}</td>
                            <td><Delta now={a.ytd.amount} before={a.ytdLastYear.amount} money /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            )}
          </>
        )}
      </main>
    </div>
  );
};
