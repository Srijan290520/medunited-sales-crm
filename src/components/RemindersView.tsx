import React, { useState, useEffect } from 'react';
import { User, Reminder, ProductLine, MedicineForm } from '../types';
import { isTeamRole } from '../utils/roles';
import { api } from '../services/api';
import { formatDate, initials, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

function getRefillDays(p: ProductLine): number {
  if (p.customDays && p.customDays > 0) return p.customDays;
  const dosesPerDay = p.frequency === 'Thrice a day' ? 3 : p.frequency === 'Twice a day' ? 2 : 1;
  const form = p.formType || 'tablet';

  if (form === 'syrup') {
    const doseMl = p.unitsPerDose || 5;
    const bottleMl = p.bottleVolume || p.quantity || 100;
    const bottles = p.bottlesCount || 1;
    const totalMl = bottleMl * bottles;
    const dailyConsumption = doseMl * dosesPerDay;
    return dailyConsumption > 0 ? Math.floor(totalMl / dailyConsumption) : 30;
  }
  if (form === 'inhaler') {
    const dosePuffs = p.unitsPerDose || 2;
    const totalPuffs = p.quantity || 200;
    const dailyConsumption = dosePuffs * dosesPerDay;
    return dailyConsumption > 0 ? Math.floor(totalPuffs / dailyConsumption) : 30;
  }
  if (form === 'drops' || form === 'cream') {
    return p.customDays || 15;
  }
  if (form === 'course') {
    return p.customDays || p.quantity || 7;
  }
  const unitsPerDose = p.unitsPerDose || 1;
  const dailyConsumption = unitsPerDose * dosesPerDay;
  return dailyConsumption > 0 ? Math.floor(p.quantity / dailyConsumption) : 30;
}

interface RemindersViewProps {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

export const RemindersView: React.FC<RemindersViewProps> = ({ user, onToast }) => {
  const canManageAll = isTeamRole(user.Role);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showResolved, setShowResolved] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [agentRoster, setAgentRoster] = useState<User[]>([]);

  // Expanded cards state
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [contactChoicesOpen, setContactChoicesOpen] = useState<Record<string, boolean>>({});
  const [reassignOpen, setReassignOpen] = useState<Record<string, boolean>>({});
  const [reassignSelections, setReassignSelections] = useState<Record<string, string>>({});

  // Edit Medications Modal state
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [editMeds, setEditMeds] = useState<ProductLine[]>([]);
  const [savingMeds, setSavingMeds] = useState<boolean>(false);
  const [medsError, setMedsError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.listReminders(showResolved);
      if (res.error) {
        onToast(res.message || 'Could not load reminders', 'error');
      } else {
        setReminders(res.reminders || []);
      }

      if (canManageAll) {
        const uRes = await api.listUsers();
        if (!uRes.error && uRes.users) {
          setAgentRoster(uRes.users.filter((u: User) => u.Role === 'agent' && u.Active));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [showResolved, user]);

  const handleMarkContacted = async (id: string, outcome: 'not_interested' | 'could_not_connect') => {
    try {
      const res = await api.markContacted(id, outcome);
      if (res.error) {
        onToast(res.message || 'Could not update reminder', 'error');
      } else {
        onToast(outcome === 'not_interested' ? 'Reminder resolved' : 'Contact attempt logged', 'success');
        setContactChoicesOpen((prev) => ({ ...prev, [id]: false }));
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error updating reminder', 'error');
    }
  };

  const handleReassign = async (id: string) => {
    const target = reassignSelections[id];
    if (!target) return;
    try {
      const res = await api.reassignReminder(id, target);
      if (res.error) {
        onToast(res.message || 'Could not reassign reminder', 'error');
      } else {
        onToast('Reminder reassigned', 'success');
        setReassignOpen((prev) => ({ ...prev, [id]: false }));
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error reassigning', 'error');
    }
  };

  const openEditMedsModal = (r: Reminder) => {
    setEditingReminder(r);
    setMedsError(null);
    const initialList =
      r.Products && r.Products.length > 0
        ? r.Products
        : [
            {
              name: '',
              quantity: 30,
              frequency: 'Once a day' as const,
              unitsPerDose: 1,
              formType: 'tablet' as const,
              unitName: 'tabs',
            },
          ];

    setEditMeds(
      initialList.map((p) => ({
        ...p,
        formType: p.formType || 'tablet',
        unitName:
          p.unitName ||
          (p.formType === 'syrup'
            ? 'ml'
            : p.formType === 'inhaler'
            ? 'puffs'
            : p.formType === 'drops'
            ? 'drops'
            : p.formType === 'cream'
            ? 'tubes'
            : p.formType === 'injection'
            ? 'units'
            : p.formType === 'course'
            ? 'days'
            : 'tabs'),
      }))
    );
  };

  const handleSaveReminderMeds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReminder) return;
    setMedsError(null);

    const valid = editMeds.every((p) => p.name.trim() && p.quantity > 0);
    if (!valid) {
      setMedsError('Please provide a medicine name and valid quantity/duration for every item.');
      return;
    }

    setSavingMeds(true);
    try {
      const res = await api.updateSale('pharmacy', editingReminder.PharmacySaleID, {
        products: editMeds,
      });

      if (res.error) {
        setMedsError(res.message || 'Could not update medications.');
      } else {
        onToast('Medications updated and refill schedule recalculated!', 'success');
        setEditingReminder(null);
        loadData();
      }
    } catch (err: any) {
      setMedsError(err.message || 'Error updating medications');
    } finally {
      setSavingMeds(false);
    }
  };

  const filteredReminders = reminders.filter((r) => {
    if (agentFilter && r.AgentEmail.toLowerCase() !== agentFilter.toLowerCase()) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const nameHit = r.CustomerName.toLowerCase().includes(q);
      const phoneHit = r.Contact.includes(q);
      const medHit = r.Products?.some((p) => p.name.toLowerCase().includes(q)) || (r.Detail || '').toLowerCase().includes(q);
      if (!nameHit && !phoneHit && !medHit) return false;
    }
    return true;
  });

  const handleExportReminders = () => {
    if (!canManageAll) {
      onToast('Access denied: Export is only available for Managers and Admins.', 'error');
      return;
    }

    if (filteredReminders.length === 0) {
      onToast('No refill reminders match the current filters to export.', 'error');
      return;
    }

    const columns: CsvColumn<Reminder>[] = [
      { header: 'Reminder ID', accessor: (r) => r.ID },
      { header: 'Type', accessor: (r) => (r.Kind === 'renewal' ? 'Homekare renewal' : 'Pharmacy refill') },
      { header: 'Package / services', accessor: (r) => r.Detail || '' },
      { header: 'Package ends', accessor: (r) => r.EndDate || '' },
      { header: 'Customer Name', accessor: (r) => r.CustomerName },
      { header: 'Contact Number', accessor: (r) => r.Contact },
      { header: 'Status', accessor: (r) => r.Status },
      { header: 'Days Remaining', accessor: (r) => r.DaysRemaining ?? '—' },
      { header: 'Refill Urgency', accessor: (r) => r.Overdue ? 'Overdue' : (r.DaysRemaining === 0 ? 'Due Today' : `${r.DaysRemaining}d remaining`) },
      { header: 'Contact Attempts', accessor: (r) => r.AttemptCount },
      { header: 'Last Attempt Date', accessor: (r) => r.LastAttemptDate || 'None' },
      { header: 'Assigned Agent Name', accessor: (r) => r.AgentName },
      { header: 'Assigned Agent Email', accessor: (r) => r.AgentEmail },
      { header: 'Original Sale Date', accessor: (r) => r.SaleDate || '' },
      {
        header: 'Prescribed Medicines Breakdown',
        accessor: (r) =>
          r.Products.map(
            (p) => `${p.name} (${p.formType || 'tablet'}, ${p.quantity} ${p.unitName || 'units'}, ${p.frequency})`
          ).join('; '),
      },
      { header: 'Resolution Reason', accessor: (r) => r.ResolutionReason || '' },
      { header: 'Created Timestamp', accessor: (r) => r.CreatedAt || '' },
    ];

    const timestamp = todayKey();
    const statusLabel = showResolved ? '_resolved' : '_active';
    const filename = `MedUnited_Reminders_${timestamp}${statusLabel}.csv`;
    exportToCsv(filename, columns, filteredReminders);
    onToast(`Exported ${filteredReminders.length} reminders to CSV`, 'success');
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Reminders</h1>
          <p className="subtitle">Pharmacy medicine refills and Homekare monthly package renewals</p>
        </div>
        <div className="topbar-actions">
          {canManageAll && (
            <button
              type="button"
              className="secondary"
              onClick={handleExportReminders}
              title="Export refill reminders to CSV (Managers & Admins only)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 13px',
                fontWeight: 600,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export CSV</span>
            </button>
          )}

          <button
            type="button"
            className="secondary"
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? 'Show Active Only' : 'Show Resolved'}
          </button>
        </div>
      </div>

      <main>
        {/* Filter bar */}
        <div className="filter-bar">
          <input
            type="search"
            placeholder="Search by customer, phone, or medicine…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {canManageAll && (
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="">All Agents</option>
              {agentRoster.map((a) => (
                <option key={a.Email} value={a.Email}>
                  {a.Name}
                </option>
              ))}
            </select>
          )}

          {(search || agentFilter) && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSearch('');
                setAgentFilter('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Reminders List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading reminders…
          </div>
        ) : filteredReminders.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}
          >
            {showResolved ? 'No resolved reminders.' : 'No active refill reminders right now.'}
          </div>
        ) : (
          <div
            id="reminders-list"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            {filteredReminders.map((r) => {
              const isOverdue = r.Overdue && r.Status === 'Active';
              const days = r.DaysRemaining ?? 0;
              const isExpanded = !!expandedCards[r.ID];
              const choicesOpen = !!contactChoicesOpen[r.ID];
              const reassignActive = !!reassignOpen[r.ID];

              const isRenewal = r.Kind === 'renewal';
              const visibleProducts = isExpanded ? r.Products : r.Products.slice(0, 2);
              const hasExtra = r.Products.length > 2;

              let cardClass = 'reminder-card';
              if (isOverdue) cardClass += ' overdue';
              if (r.NeedsAttention) cardClass += ' needs-attention';
              if (r.Status === 'Resolved') cardClass += ' resolved';

              return (
                <div key={r.ID} className={cardClass}>
                  <div className="reminder-card-top">
                    <div className="reminder-card-heading">
                      <div className="reminder-customer">{r.CustomerName}</div>
                      <div className="reminder-contact">{r.Contact || '—'}</div>
                      <span className="also-in-chip" style={{ marginLeft: 0 }}>{isRenewal ? 'Homekare renewal' : 'Pharmacy refill'}</span>
                    </div>

                    {r.Status === 'Resolved' ? (
                      <span className="reminder-badge" style={{ background: '#e2e8f0', color: '#475569' }}>
                        Resolved
                      </span>
                    ) : isRenewal && isOverdue ? (
                      <span className="reminder-badge overdue">
                        Package ended {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago
                      </span>
                    ) : isRenewal ? (
                      <span className={`reminder-badge ${r.IsDue ? 'overdue' : 'upcoming'}`}>
                        {days === 0 ? 'Package ends today' : `Package ends in ${days} day${days === 1 ? '' : 's'}`}
                      </span>
                    ) : isOverdue ? (
                      <span className="reminder-badge overdue">
                        Overdue by {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'}
                      </span>
                    ) : days === 0 ? (
                      <span className="reminder-badge upcoming">Due today</span>
                    ) : (
                      <span className="reminder-badge upcoming">
                        Due in {days} day{days === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {/* Homekare monthly package */}
                  {isRenewal && (
                    <div className="reminder-products">
                      <div className="reminder-product-row">
                        <span style={{ fontWeight: 600 }}>🏠 {r.Detail}</span>
                        <span className="reminder-product-meta">
                          {formatDate(r.SaleDate || '')} – {formatDate(r.EndDate)} · remind from {formatDate(r.DueDate)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  <div className="reminder-products">
                    {visibleProducts.map((p, idx) => {
                      const icon =
                        p.formType === 'syrup'
                          ? '🧪 '
                          : p.formType === 'inhaler'
                          ? '💨 '
                          : p.formType === 'cream'
                          ? '🧴 '
                          : p.formType === 'drops'
                          ? '💧 '
                          : p.formType === 'injection'
                          ? '💉 '
                          : p.formType === 'sachet'
                          ? '📦 '
                          : p.formType === 'course'
                          ? '⏱️ '
                          : '💊 ';
                      const doseText = p.customDays
                        ? `${p.customDays}d course`
                        : p.formType === 'syrup'
                        ? `${p.unitsPerDose || 5}ml ${p.frequency}`
                        : p.formType === 'inhaler'
                        ? `${p.unitsPerDose || 2} puffs ${p.frequency}`
                        : `${p.unitsPerDose || 1} dose ${p.frequency}`;

                      return (
                        <div key={idx} className="reminder-product-row">
                          <span style={{ fontWeight: 600 }}>
                            {icon}
                            {p.name}
                          </span>
                          <span className="reminder-product-meta">
                            {doseText} • Runs out {p.expiryDate ? formatDate(p.expiryDate) : '—'} (
                            {p.daysRemaining !== undefined && p.daysRemaining < 0
                              ? `${Math.abs(p.daysRemaining)}d overdue`
                              : `${p.daysRemaining}d left`}
                            )
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {hasExtra && (
                    <button
                      type="button"
                      className="reminder-more-btn"
                      onClick={() =>
                        setExpandedCards((prev) => ({ ...prev, [r.ID]: !isExpanded }))
                      }
                    >
                      {isExpanded ? 'Show less ▲' : `+${r.Products.length - 2} more ▾`}
                    </button>
                  )}

                  {/* Attempts Row */}
                  <div style={{ marginTop: '6px' }}>
                    {r.NeedsAttention ? (
                      <p className="reminder-attempts-note attention">
                        ⚠️ No contact in 3+ days ({r.AttemptCount} attempt{r.AttemptCount === 1 ? '' : 's'})
                      </p>
                    ) : r.AttemptCount > 0 ? (
                      <p className="reminder-attempts-note">
                        Contacted {r.AttemptCount} time{r.AttemptCount === 1 ? '' : 's'}
                        {r.LastAttemptDate ? `, last ${formatDate(r.LastAttemptDate)}` : ''}
                      </p>
                    ) : (
                      <p className="reminder-attempts-note" style={{ visibility: 'hidden' }}>
                        None
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="reminder-footer">
                    <div className="table-person">
                      <span className="avatar-sm">{initials(r.AgentName)}</span>
                      <span style={{ fontSize: '0.8rem' }}>{r.AgentName}</span>
                    </div>

                    <div className="reminder-actions" style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="secondary"
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 8px',
                          fontWeight: 600,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                        }}
                        onClick={() => openEditMedsModal(r)}
                        title="Edit prescribed medicines, dosages, and refill timing"
                        hidden={isRenewal}
                      >
                        ✏️ Edit Meds
                      </button>
                      {r.Status === 'Active' && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setContactChoicesOpen((prev) => ({ ...prev, [r.ID]: !choicesOpen }))
                          }
                        >
                          Mark Contacted
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Contact Choices Popup */}
                  {choicesOpen && r.Status === 'Active' && (
                    <div className="reminder-contact-choices" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      <button
                        type="button"
                        className="secondary"
                        style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}
                        onClick={() => handleMarkContacted(r.ID, 'not_interested')}
                      >
                        ✕ Doesn’t want medicines (Resolve)
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}
                        onClick={() => handleMarkContacted(r.ID, 'could_not_connect')}
                      >
                        📞 Wants medicines — couldn’t connect
                      </button>
                    </div>
                  )}

                  {/* Reassign toggle for managers/admins */}
                  {canManageAll && (
                    <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                      <button
                        type="button"
                        className="reminder-reassign-toggle"
                        onClick={() =>
                          setReassignOpen((prev) => ({ ...prev, [r.ID]: !reassignActive }))
                        }
                      >
                        Reassign Agent ▾
                      </button>

                      {reassignActive && (
                        <div
                          className="reminder-reassign"
                          style={{ display: 'flex', gap: '6px', marginTop: '6px' }}
                        >
                          <select
                            value={reassignSelections[r.ID] || r.AgentEmail}
                            onChange={(e) =>
                              setReassignSelections((prev) => ({ ...prev, [r.ID]: e.target.value }))
                            }
                          >
                            {agentRoster.map((a) => (
                              <option key={a.Email} value={a.Email}>
                                {a.Name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => handleReassign(r.ID)}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Edit Prescribed Medications Modal */}
        {editingReminder && (
          <div className="sales-modal-overlay" onClick={() => setEditingReminder(null)}>
            <div
              className="sales-modal-popup"
              style={{ maxWidth: '820px', width: '92%' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="popup-header" style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9' }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    💊 Edit Prescribed Medications
                  </h2>
                  <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '4px' }}>
                    Customer: <strong>{editingReminder.CustomerName}</strong> ({editingReminder.Contact || 'No phone'}) · Order #{editingReminder.PharmacySaleID}
                  </div>
                </div>
                <button
                  type="button"
                  className="popup-close"
                  onClick={() => setEditingReminder(null)}
                  title="Close"
                >
                  &times;
                </button>
              </div>

              {/* Body */}
              <form onSubmit={handleSaveReminderMeds}>
                <div className="popup-body" style={{ padding: '20px 24px', maxHeight: '72vh', overflowY: 'auto' }}>
                  {medsError && (
                    <div className="form-error show" style={{ marginBottom: '16px' }}>
                      {medsError}
                    </div>
                  )}

                  <div className="form-section-block">
                    <div className="form-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                      <div>
                        <div className="form-section-title">
                          <span className="title-text">Prescription Details</span>
                        </div>
                        <div className="form-section-desc">
                          Adjust medication dosages, bottle sizes, refill duration, or add new medicines.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() =>
                          setEditMeds([
                            ...editMeds,
                            {
                              name: '',
                              quantity: 30,
                              frequency: 'Once a day',
                              unitsPerDose: 1,
                              formType: 'tablet',
                              unitName: 'tabs',
                            },
                          ])
                        }
                      >
                        <span>+</span> Add Medicine
                      </button>
                    </div>

                    <div className="meds-list-container">
                      {editMeds.map((p, idx) => {
                        const formType: MedicineForm = p.formType || 'tablet';
                        const refillDays = getRefillDays(p);

                        return (
                          <div key={idx} className="med-item-card">
                            <div className="med-item-header">
                              <div>
                                <label style={{ marginBottom: '4px' }}>Medicine Name *</label>
                                <input
                                  type="text"
                                  placeholder={
                                    formType === 'syrup'
                                      ? 'e.g. Cough Syrup (Ascoril / Benadryl)'
                                      : formType === 'inhaler'
                                      ? 'e.g. Asthalin Inhaler, Budecort'
                                      : formType === 'drops'
                                      ? 'e.g. Ciplox Eye Drops, Otrivin'
                                      : formType === 'cream'
                                      ? 'e.g. Volini Gel, Betnovate'
                                      : formType === 'injection'
                                      ? 'e.g. Lantus Insulin Solostar Pen'
                                      : formType === 'course'
                                      ? 'e.g. Azithromycin 500mg'
                                      : 'e.g. Metformin 500mg, Telmisartan'
                                  }
                                  value={p.name}
                                  onChange={(e) => {
                                    const copy = [...editMeds];
                                    copy[idx].name = e.target.value;
                                    setEditMeds(copy);
                                  }}
                                />
                              </div>

                              <div>
                                <label style={{ marginBottom: '4px' }}>Dosage Form</label>
                                <select
                                  value={formType}
                                  onChange={(e) => {
                                    const newForm = e.target.value as MedicineForm;
                                    const copy = [...editMeds];
                                    copy[idx].formType = newForm;
                                    if (newForm === 'syrup') {
                                      copy[idx].unitName = 'ml';
                                      copy[idx].bottleVolume = copy[idx].bottleVolume || 100;
                                      copy[idx].bottlesCount = copy[idx].bottlesCount || 1;
                                      copy[idx].quantity = copy[idx].bottleVolume;
                                      copy[idx].unitsPerDose = copy[idx].unitsPerDose && copy[idx].unitsPerDose > 1 ? copy[idx].unitsPerDose : 5;
                                    } else if (newForm === 'inhaler') {
                                      copy[idx].unitName = 'puffs';
                                      copy[idx].quantity = 200;
                                      copy[idx].bottlesCount = 1;
                                      copy[idx].unitsPerDose = 2;
                                    } else if (newForm === 'drops') {
                                      copy[idx].unitName = 'drops';
                                      copy[idx].quantity = 1;
                                      copy[idx].unitsPerDose = 2;
                                      copy[idx].customDays = copy[idx].customDays || 15;
                                    } else if (newForm === 'cream') {
                                      copy[idx].unitName = 'tubes';
                                      copy[idx].quantity = 1;
                                      copy[idx].unitsPerDose = 1;
                                      copy[idx].customDays = copy[idx].customDays || 15;
                                    } else if (newForm === 'injection') {
                                      copy[idx].unitName = 'units';
                                      copy[idx].quantity = 300;
                                      copy[idx].unitsPerDose = 20;
                                    } else if (newForm === 'course') {
                                      copy[idx].unitName = 'days';
                                      copy[idx].customDays = copy[idx].customDays || 7;
                                      copy[idx].quantity = copy[idx].customDays || 7;
                                    } else {
                                      copy[idx].unitName = 'tabs';
                                      copy[idx].quantity = 30;
                                      copy[idx].unitsPerDose = 1;
                                    }
                                    setEditMeds(copy);
                                  }}
                                >
                                  <option value="tablet">💊 Tablets / Capsules</option>
                                  <option value="syrup">🧪 Syrup / Liquid (ml)</option>
                                  <option value="inhaler">💨 Inhaler / Spray (puffs)</option>
                                  <option value="drops">💧 Eye / Ear Drops</option>
                                  <option value="cream">🧴 Ointment / Cream</option>
                                  <option value="injection">💉 Insulin / Injection</option>
                                  <option value="sachet">📦 Sachet / Powder</option>
                                  <option value="course">⏱️ Fixed Course (Days)</option>
                                </select>
                              </div>

                              {editMeds.length > 1 ? (
                                <button
                                  type="button"
                                  className="danger"
                                  style={{ padding: '4px', height: '38px', width: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                  onClick={() => {
                                    const copy = editMeds.filter((_, i) => i !== idx);
                                    setEditMeds(copy);
                                  }}
                                  title="Remove medication"
                                >
                                  &times;
                                </button>
                              ) : (
                                <div />
                              )}
                            </div>

                            {/* Middle Controls Grid */}
                            {formType === 'syrup' ? (
                              <div className="med-fields-grid grid-5">
                                <div>
                                  <label>Bottle Size (ml)</label>
                                  <input
                                    type="number"
                                    min="10"
                                    value={p.bottleVolume || p.quantity || 100}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      const vol = Number(e.target.value) || 0;
                                      copy[idx].bottleVolume = vol;
                                      copy[idx].quantity = vol;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[60, 100, 150, 200].map((ml) => (
                                      <span
                                        key={ml}
                                        className={`med-chip ${(p.bottleVolume || p.quantity) === ml ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].bottleVolume = ml;
                                          copy[idx].quantity = ml;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {ml}ml
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Bottles</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.bottlesCount || 1}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].bottlesCount = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                </div>

                                <div>
                                  <label>Dose (ml)</label>
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    value={p.unitsPerDose || 5}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].unitsPerDose = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[2.5, 5, 10, 15].map((ml) => (
                                      <span
                                        key={ml}
                                        className={`med-chip ${p.unitsPerDose === ml ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].unitsPerDose = ml;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {ml}ml
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Frequency</label>
                                  <select
                                    value={p.frequency}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].frequency = e.target.value as any;
                                      setEditMeds(copy);
                                    }}
                                  >
                                    <option value="Once a day">Once a day (1x)</option>
                                    <option value="Twice a day">Twice a day (2x)</option>
                                    <option value="Thrice a day">Thrice a day (3x)</option>
                                  </select>
                                </div>

                                <div>
                                  <label>Refill Cycle</label>
                                  <div className="med-days-pill">
                                    <span>📅 {refillDays} days</span>
                                  </div>
                                </div>
                              </div>
                            ) : formType === 'inhaler' ? (
                              <div className="med-fields-grid grid-4">
                                <div>
                                  <label>Canister Size (puffs)</label>
                                  <input
                                    type="number"
                                    min="50"
                                    value={p.quantity || 200}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].quantity = Number(e.target.value) || 200;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[120, 200].map((pf) => (
                                      <span
                                        key={pf}
                                        className={`med-chip ${p.quantity === pf ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].quantity = pf;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {pf} puffs
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Puffs per dose</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.unitsPerDose || 2}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].unitsPerDose = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                </div>

                                <div>
                                  <label>Frequency</label>
                                  <select
                                    value={p.frequency}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].frequency = e.target.value as any;
                                      setEditMeds(copy);
                                    }}
                                  >
                                    <option value="Once a day">Once a day</option>
                                    <option value="Twice a day">Twice a day</option>
                                    <option value="Thrice a day">Thrice a day</option>
                                  </select>
                                </div>

                                <div>
                                  <label>Refill Cycle</label>
                                  <div className="med-days-pill">
                                    <span>📅 {refillDays} days</span>
                                  </div>
                                </div>
                              </div>
                            ) : formType === 'drops' || formType === 'cream' ? (
                              <div className="med-fields-grid grid-3">
                                <div>
                                  <label>{formType === 'drops' ? 'Bottle Count' : 'Tubes Count'}</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.quantity || 1}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].quantity = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                </div>

                                <div>
                                  <label>Treatment Duration (Days)</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.customDays || 15}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].customDays = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[7, 10, 15, 30].map((d) => (
                                      <span
                                        key={d}
                                        className={`med-chip ${p.customDays === d ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].customDays = d;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {d}d
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Frequency</label>
                                  <select
                                    value={p.frequency}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].frequency = e.target.value as any;
                                      setEditMeds(copy);
                                    }}
                                  >
                                    <option value="Once a day">Once a day</option>
                                    <option value="Twice a day">Twice a day</option>
                                    <option value="Thrice a day">Thrice a day</option>
                                  </select>
                                </div>
                              </div>
                            ) : formType === 'course' ? (
                              <div className="med-fields-grid grid-2">
                                <div>
                                  <label>Prescription Course Length (Days) *</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.customDays || p.quantity || 7}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      const d = Number(e.target.value) || 1;
                                      copy[idx].customDays = d;
                                      copy[idx].quantity = d;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[3, 5, 7, 10, 14, 21].map((d) => (
                                      <span
                                        key={d}
                                        className={`med-chip ${(p.customDays || p.quantity) === d ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].customDays = d;
                                          copy[idx].quantity = d;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {d} days
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Frequency &amp; Regimen</label>
                                  <select
                                    value={p.frequency}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].frequency = e.target.value as any;
                                      setEditMeds(copy);
                                    }}
                                  >
                                    <option value="Once a day">Once a day</option>
                                    <option value="Twice a day">Twice a day</option>
                                    <option value="Thrice a day">Thrice a day</option>
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="med-fields-grid grid-4">
                                <div>
                                  <label>Total Tablets / Pack</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={p.quantity}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].quantity = Number(e.target.value) || 0;
                                      setEditMeds(copy);
                                    }}
                                  />
                                  <div className="med-quick-chips">
                                    {[10, 14, 20, 30, 60, 90].map((q) => (
                                      <span
                                        key={q}
                                        className={`med-chip ${p.quantity === q ? 'active' : ''}`}
                                        onClick={() => {
                                          const copy = [...editMeds];
                                          copy[idx].quantity = q;
                                          setEditMeds(copy);
                                        }}
                                      >
                                        {q}
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label>Tabs per Dose</label>
                                  <input
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={p.unitsPerDose || 1}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].unitsPerDose = Number(e.target.value) || 1;
                                      setEditMeds(copy);
                                    }}
                                  />
                                </div>

                                <div>
                                  <label>Frequency</label>
                                  <select
                                    value={p.frequency}
                                    onChange={(e) => {
                                      const copy = [...editMeds];
                                      copy[idx].frequency = e.target.value as any;
                                      setEditMeds(copy);
                                    }}
                                  >
                                    <option value="Once a day">Once a day (1 tab/d)</option>
                                    <option value="Twice a day">Twice a day (2 tabs/d)</option>
                                    <option value="Thrice a day">Thrice a day (3 tabs/d)</option>
                                  </select>
                                </div>

                                <div>
                                  <label>Refill Cycle</label>
                                  <div className="med-days-pill">
                                    <span>📅 {refillDays} days</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Quick summary & custom override */}
                            <div className="med-summary-strip">
                              <span className="med-summary-text">
                                📦 Refill scheduled in <strong>{refillDays} days</strong> based on dosage.
                              </span>
                              {formType !== 'course' && (
                                <button
                                  type="button"
                                  className="med-override-link"
                                  onClick={() => {
                                    const current = p.customDays || refillDays;
                                    const val = prompt('Set exact refill / course duration in days:', String(current));
                                    if (val !== null) {
                                      const num = parseInt(val, 10);
                                      const copy = [...editMeds];
                                      if (!isNaN(num) && num > 0) {
                                        copy[idx].customDays = num;
                                      } else {
                                        delete copy[idx].customDays;
                                      }
                                      setEditMeds(copy);
                                    }
                                  }}
                                >
                                  {p.customDays ? `✏️ Overridden to ${p.customDays}d (Reset)` : '⏱️ Set custom days override'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: '16px 24px',
                    background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px',
                    borderRadius: '0 0 12px 12px',
                  }}
                >
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingReminder(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingMeds}
                    style={{
                      background: '#16a34a',
                      color: '#ffffff',
                      fontWeight: 600,
                      padding: '8px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {savingMeds ? 'Saving…' : '💾 Save & Recalculate Refill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
