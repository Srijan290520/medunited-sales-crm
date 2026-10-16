import React, { useState, useEffect } from 'react';
import { User, OptionLists } from '../types';
import { isTeamRole, isSeniorRole } from '../utils/roles';
import { api } from '../services/api';
import { initials } from '../utils/date';

// Shown inside the Settings page, one section at a time.
export type SettingsSection = 'rates' | 'team-target' | 'lists';

interface SettingsViewProps {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
  section: SettingsSection;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ user, onToast, section }) => {
  const isAdmin = isSeniorRole(user.Role); // lists and approvals: admins and senior managers
  const canEditTarget = isTeamRole(user.Role);

  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Per agent local edits
  const [rates, setRates] = useState<
    Record<string, { medpassFull: string; medpassDiscount: string; pharmacyPercent: string; status?: string }>
  >({});

  // Bulk Apply
  const [bulkFull, setBulkFull] = useState<string>('');
  const [bulkDiscount, setBulkDiscount] = useState<string>('');
  const [bulkPercent, setBulkPercent] = useState<string>('');
  const [bulkApplying, setBulkApplying] = useState<boolean>(false);

  // Dropdown lists (Admin only)
  const [optionLists, setOptionLists] = useState<OptionLists | null>(null);
  const [channelsText, setChannelsText] = useState<string>('');
  const [heardFromText, setHeardFromText] = useState<string>('');
  const [lostReasonsText, setLostReasonsText] = useState<string>('');
  const [savingLists, setSavingLists] = useState<boolean>(false);

  // Monthly revenue target (Manager/Admin)
  const [targetText, setTargetText] = useState<string>('');
  const [savingTarget, setSavingTarget] = useState<boolean>(false);

  const handleSaveTarget = async () => {
    const value = Number(targetText.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      onToast('Enter a target amount greater than 0', 'error');
      return;
    }
    setSavingTarget(true);
    try {
      const res = await api.updateMonthlyTarget(value);
      if (res.error) {
        onToast(res.message || 'Could not update target', 'error');
      } else {
        setTargetText(String(res.target));
        onToast('Monthly revenue target updated', 'success');
      }
    } finally {
      setSavingTarget(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const uRes = await api.listUsers();
      if (!uRes.error && uRes.users) {
        const agentList = uRes.users.filter((u: User) => u.Role === 'agent');
        setAgents(agentList);

        const initialRates: Record<string, any> = {};
        agentList.forEach((a: User) => {
          initialRates[a.ID] = {
            medpassFull: String(a.MedpassFullRate ?? 0),
            medpassDiscount: String(a.MedpassDiscountRate ?? 0),
            pharmacyPercent: String(a.PharmacyIncentivePercent ?? 0),
          };
        });
        setRates(initialRates);
      }

      if (canEditTarget) {
        const tRes = await api.getMonthlyTarget();
        if (!tRes.error) setTargetText(String(tRes.target));
      }

      if (isAdmin) {
        const lRes = await api.getOptionLists();
        if (!lRes.error && lRes.lists) {
          setOptionLists(lRes.lists);
          setChannelsText(lRes.lists.channels.join('\n'));
          setHeardFromText(lRes.lists.heardFrom.join('\n'));
          setLostReasonsText(lRes.lists.lostReasons.join('\n'));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleSaveAgentRates = async (id: string) => {
    const cur = rates[id];
    if (!cur) return;

    setRates((prev) => ({
      ...prev,
      [id]: { ...prev[id], status: 'saving' },
    }));

    try {
      const res = await api.updateIncentives(id, {
        medpassFullRate: cur.medpassFull,
        medpassDiscountRate: cur.medpassDiscount,
        pharmacyIncentivePercent: cur.pharmacyPercent,
      });

      if (res.error) {
        onToast(res.message || 'Could not save rates', 'error');
        setRates((prev) => ({
          ...prev,
          [id]: { ...prev[id], status: '' },
        }));
      } else {
        onToast('Incentive rates saved', 'success');
        setRates((prev) => ({
          ...prev,
          [id]: { ...prev[id], status: 'saved' },
        }));
        setTimeout(() => {
          setRates((prev) => ({
            ...prev,
            [id]: { ...prev[id], status: '' },
          }));
        }, 2000);
      }
    } catch (err: any) {
      onToast(err.message || 'Error saving rates', 'error');
    }
  };

  const handleBulkApply = async () => {
    if (!bulkFull && !bulkDiscount && !bulkPercent) {
      onToast('Enter at least one rate to apply to all agents', 'error');
      return;
    }

    if (!window.confirm(`Apply these rates to all ${agents.length} agent(s)? This will overwrite current individual rates.`)) {
      return;
    }

    setBulkApplying(true);
    let failed = 0;
    for (const a of agents) {
      const payload: any = {};
      if (bulkFull !== '') payload.medpassFullRate = bulkFull;
      if (bulkDiscount !== '') payload.medpassDiscountRate = bulkDiscount;
      if (bulkPercent !== '') payload.pharmacyIncentivePercent = bulkPercent;

      const res = await api.updateIncentives(a.ID, payload);
      if (res.error) failed++;
    }
    setBulkApplying(false);

    if (failed > 0) {
      onToast(`Applied, but ${failed} agent(s) failed to update`, 'error');
    } else {
      onToast('Incentive rates applied to all agents', 'success');
    }
    loadData();
  };

  const handleSaveLists = async () => {
    const channels = channelsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const heardFrom = heardFromText.split('\n').map((s) => s.trim()).filter(Boolean);
    const lostReasons = lostReasonsText.split('\n').map((s) => s.trim()).filter(Boolean);

    if (channels.length === 0 || lostReasons.length === 0) {
      onToast('Channels and Lost Reasons must have at least one option each', 'error');
      return;
    }

    setSavingLists(true);
    try {
      const res = await api.updateOptionLists({ channels, heardFrom, lostReasons });
      if (res.error) {
        onToast(res.message || 'Could not update options', 'error');
      } else {
        onToast('Acquisition and Lost reason options updated', 'success');
      }
    } finally {
      setSavingLists(false);
    }
  };

  return (
    <div>
        {section === 'rates' && (<>
        {/* Bulk Apply Card */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-title">Bulk Apply Rates to All Agents</div>
          <p className="muted small-text" style={{ marginBottom: '14px' }}>
            Set rates here to apply the same commission rule across all sales agents simultaneously.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.8rem' }}>Medpass Full (₹)</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 500"
                value={bulkFull}
                onChange={(e) => setBulkFull(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem' }}>Medpass Discount (₹)</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 300"
                value={bulkDiscount}
                onChange={(e) => setBulkDiscount(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem' }}>Pharmacy Incentive (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="e.g. 5"
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                className="secondary"
                disabled={bulkApplying}
                onClick={handleBulkApply}
                style={{ width: '100%', height: '42px', justifyContent: 'center' }}
              >
                {bulkApplying ? 'Applying…' : 'Apply to All Agents'}
              </button>
            </div>
          </div>
        </div>

        {/* Individual Agent Rates Table */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-title">Per-Agent Incentive Rates</div>
          <p className="muted small-text" style={{ marginBottom: '14px' }}>
            Medpass pays a flat commission per completed sale; Pharmacy pays a percentage of invoice amount.
          </p>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Medpass Full Rate (₹)</th>
                  <th>Medpass Discount Rate (₹)</th>
                  <th>Pharmacy (%)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row">
                    <td colSpan={5}>Loading rates…</td>
                  </tr>
                ) : agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                      No active agents found.
                    </td>
                  </tr>
                ) : (
                  agents.map((a) => {
                    const r = rates[a.ID] || { medpassFull: '0', medpassDiscount: '0', pharmacyPercent: '0' };
                    const isSaving = r.status === 'saving';
                    const isSaved = r.status === 'saved';

                    return (
                      <tr key={a.ID}>
                        <td>
                          <div className="table-person">
                            <span className="avatar-sm">{initials(a.Name)}</span>
                            <div>
                              <strong>{a.Name}</strong>
                              <div className="muted small-text">{a.Email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            style={{ width: '120px' }}
                            value={r.medpassFull}
                            onChange={(e) =>
                              setRates((prev) => ({
                                ...prev,
                                [a.ID]: { ...prev[a.ID], medpassFull: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            style={{ width: '120px' }}
                            value={r.medpassDiscount}
                            onChange={(e) =>
                              setRates((prev) => ({
                                ...prev,
                                [a.ID]: { ...prev[a.ID], medpassDiscount: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            style={{ width: '100px' }}
                            value={r.pharmacyPercent}
                            onChange={(e) =>
                              setRates((prev) => ({
                                ...prev,
                                [a.ID]: { ...prev[a.ID], pharmacyPercent: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={isSaving}
                            style={{
                              padding: '5px 12px',
                              fontSize: '0.8rem',
                              color: isSaved ? '#166534' : 'inherit',
                              borderColor: isSaved ? '#86efac' : 'var(--border)',
                            }}
                            onClick={() => handleSaveAgentRates(a.ID)}
                          >
                            {isSaving ? 'Saving…' : isSaved ? 'Saved ✓' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        </>)}

        {/* Monthly Revenue Target (Manager & Admin) */}
        {section === 'team-target' && canEditTarget && (
          <div className="card">
            <div className="card-title">Team target this month (₹)</div>
            <p className="muted small-text" style={{ marginBottom: '16px' }}>
              The whole team's revenue goal, shown on managers' dashboards. Per-agent targets are below.
            </p>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                min={1}
                step={1000}
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                placeholder="e.g. 500000"
                style={{ maxWidth: '220px' }}
              />
              <button type="button" disabled={savingTarget} onClick={handleSaveTarget}>
                {savingTarget ? 'Saving…' : 'Save Target'}
              </button>
            </div>
          </div>
        )}

        {/* Admin Acquisition & Lost Options Customization */}
        {section === 'lists' && !isAdmin && <div className="card"><p className="muted">Only admins and senior managers change the dropdown lists.</p></div>}
        {section === 'lists' && isAdmin && (
          <div className="card">
            <div className="card-title">Acquisition &amp; Lost Reasons Options (Admin Only)</div>
            <p className="muted small-text" style={{ marginBottom: '16px' }}>
              Customize options displayed in the Medpass and Pharmacy customer forms. Enter one option per line.
            </p>

            <div className="lists-grid">
              <div>
                <label style={{ fontWeight: 600 }}>Channels</label>
                <textarea
                  rows={8}
                  value={channelsText}
                  onChange={(e) => setChannelsText(e.target.value)}
                  placeholder="One channel per line…"
                />
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>How They Heard About Us</label>
                <textarea
                  rows={8}
                  value={heardFromText}
                  onChange={(e) => setHeardFromText(e.target.value)}
                  placeholder="One source per line…"
                />
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Lost / Cancellation Reasons</label>
                <textarea
                  rows={8}
                  value={lostReasonsText}
                  onChange={(e) => setLostReasonsText(e.target.value)}
                  placeholder="One lost reason per line…"
                />
              </div>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" disabled={savingLists} onClick={handleSaveLists}>
                {savingLists ? 'Saving Options…' : 'Save Dropdown Options'}
              </button>
            </div>
          </div>
        )}
    </div>
  );
};
