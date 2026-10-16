import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityDirection,
  ActivityOutcome,
  ActivityType,
  ContactCheck,
  ModuleInfo,
  PatientDetail,
  PatientRecord,
  PatientSummary,
  SaleType,
  User,
} from '../types';
import { api } from '../services/api';
import { isTeamRole } from '../utils/roles';
import { formatDate, formatMoney, formatTimeAgo, todayKey } from '../utils/date';
import { SalesView } from './SalesView';

// The Patients page: everything about one patient in one place, so whoever
// is on the call can look them up, register them, log the call and start any
// service without leaving the page. Each service opens that module's own
// form; the server keeps every record with the patient's agent.

interface Props {
  user: User;
  modules: ModuleInfo[];
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

const STATUS_LABEL: Record<string, string> = { Pending: 'Open', Completed: 'Completed', Cancelled: 'Lost' };
const ACT_TYPES: ActivityType[] = ['Call', 'WhatsApp', 'Visit', 'SMS', 'Email', 'Note'];
const ACT_OUTCOMES: ActivityOutcome[] = ['Connected', 'No answer', 'Call back later', 'Interested', 'Not interested', 'Wrong number'];

const digitsOf = (v: string) => v.replace(/\D/g, '');
const normName = (v: string) => v.toLowerCase().replace(/[.,'"`_-]+/g, ' ').replace(/\s+/g, ' ').trim();

function whatsappLink(contact: string): string {
  const d = digitsOf(contact);
  return `https://wa.me/${d.length === 10 ? '91' + d : d}`;
}

function ageOf(dob: string): string {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age >= 0 ? `${age} yrs` : '';
}

function dueText(p: { NextFollowUp: string; FollowUpStatus: string }): string {
  if (!p.NextFollowUp) return '';
  if (p.FollowUpStatus === 'overdue') return `Overdue · ${formatDate(p.NextFollowUp)}`;
  if (p.FollowUpStatus === 'today') return 'Follow up today';
  return `Follow up ${formatDate(p.NextFollowUp)}`;
}

function recordSummary(r: PatientRecord): string {
  if (r.Type === 'medpass') return `${r.PriceType || 'Full Price'}${r.Members && r.Members.length ? ` · ${r.Members.length} member(s)` : ''}`;
  if (r.Type === 'homekare') return (r.Services || []).map((l) => l.service.replace(/^HOMEKARE\s*-?\s*/i, '')).join(', ') || 'No services added yet';
  if (r.Type === 'lab') return (r.Tests || []).map((l) => l.name).join(', ') || 'No tests added yet';
  return r.Detail || 'No medicines added yet';
}

export const PatientsView: React.FC<Props> = ({ user, modules, onToast }) => {
  const isTeam = isTeamRole(user.Role);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'mine' | 'all' | 'due'>(isTeam ? 'all' : 'mine');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; prefill?: { name?: string; contact?: string } } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [service, setService] = useState<{ type: SaleType; record?: PatientRecord } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadList = async () => {
    const res = await api.listPatients();
    if (res.error) onToast(res.message || 'Could not load patients', 'error');
    else setPatients(res.patients || []);
    setLoading(false);
  };

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    const res = await api.getPatient(id);
    setDetailLoading(false);
    if (res.error) {
      onToast(res.message || 'Could not load the patient', 'error');
      return;
    }
    setDetail(res as unknown as PatientDetail);
  };

  useEffect(() => {
    loadList();
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setDetail(null);
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  // After a save on the page: the profile and its row in the list.
  const applyDetail = (d: PatientDetail) => {
    setDetail(d);
    setPatients((prev) => {
      const rest = prev.filter((p) => p.ID !== d.patient.ID);
      return [d.patient, ...rest];
    });
  };

  const q = search.trim();
  const qDigits = digitsOf(q);
  const isPhoneSearch = qDigits.length >= 3 && qDigits.length >= q.replace(/[\s+()-]/g, '').length - 1;

  const shown = useMemo(() => {
    // A search always looks through every patient: the caller may be anyone's.
    if (q) {
      const nq = normName(q);
      return patients.filter((p) =>
        isPhoneSearch
          ? digitsOf(p.Contact).includes(qDigits) || digitsOf(p.AltContact).includes(qDigits)
          : normName(p.Name).includes(nq) || normName(p.Area).includes(nq) || p.Pincode.includes(q)
      );
    }
    if (scope === 'mine') return patients.filter((p) => p.Mine);
    if (scope === 'due') return patients.filter((p) => (isTeam || p.Mine) && (p.FollowUpStatus === 'overdue' || p.FollowUpStatus === 'today'));
    return patients;
  }, [patients, q, qDigits, isPhoneSearch, scope, isTeam]);

  const dueCount = patients.filter((p) => (isTeam || p.Mine) && (p.FollowUpStatus === 'overdue' || p.FollowUpStatus === 'today')).length;
  const selected = detail?.patient || patients.find((p) => p.ID === selectedId) || null;
  const noMatchForPhone = isPhoneSearch && qDigits.length >= 10 && shown.length === 0;

  const openService = (type: SaleType) => {
    if (!detail) return;
    // One open record per patient per module: open it instead of a second one.
    const open = detail.records.find((r) => r.Type === type && r.Status === 'Pending');
    if (open) {
      if (open.CanOpen) setService({ type, record: open });
      else onToast(`${detail.patient.Name} already has an open ${open.ModuleLabel} record with ${open.AgentName}.`, 'error');
      return;
    }
    setService({ type });
  };

  return (
    <div>
      <div className="mp-header">
        <div className="mp-title">
          <h1>Patients</h1>
          <p className="subtitle">Look up the caller, see everything they have with us, and start any service</p>
        </div>
        <div className="mp-actions">
          <label htmlFor="pt-search" className="sr-only">Search patients</label>
          <input
            id="pt-search"
            ref={searchRef}
            className="mp-search"
            type="search"
            placeholder="Search phone number or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="mp-btn-primary" onClick={() => setForm({ mode: 'create', prefill: isPhoneSearch ? { contact: q } : q ? { name: q } : {} })}>
            New patient
          </button>
        </div>
      </div>

      <main>
        {!q && (
          <div className="mp-tabs" role="tablist" aria-label="Which patients">
            {!isTeam && (
              <button type="button" role="tab" aria-selected={scope === 'mine'} className={`mp-tab ${scope === 'mine' ? 'active' : ''}`} onClick={() => setScope('mine')}>
                My patients <span className="mp-count">({patients.filter((p) => p.Mine).length})</span>
              </button>
            )}
            <button type="button" role="tab" aria-selected={scope === 'due'} className={`mp-tab ${scope === 'due' ? 'active' : ''}`} onClick={() => setScope('due')}>
              Follow-ups due <span className="mp-count">({dueCount})</span>
            </button>
            <button type="button" role="tab" aria-selected={scope === 'all'} className={`mp-tab ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>
              All patients <span className="mp-count">({patients.length})</span>
            </button>
          </div>
        )}

        <div className="mp-body">
          <section className="mp-list pt-list" aria-label="Patients">
            {q && (
              <div className="mp-list-head">
                <span className="mp-muted">
                  {shown.length} match{shown.length === 1 ? '' : 'es'} for “{q}” across all patients
                </span>
              </div>
            )}
            {loading ? (
              <div className="mp-empty">Loading patients…</div>
            ) : noMatchForPhone ? (
              <div className="mp-empty">
                <p>No patient on {q} yet.</p>
                <button type="button" className="mp-btn-primary" onClick={() => setForm({ mode: 'create', prefill: { contact: q } })}>
                  Register this caller
                </button>
              </div>
            ) : shown.length === 0 ? (
              <div className="mp-empty">{q ? 'No patients match.' : scope === 'due' ? 'No follow-ups due. ' : 'No patients yet.'}</div>
            ) : (
              shown.slice(0, 200).map((p) => (
                <div key={p.ID} className={`mp-row ${p.ID === selectedId ? 'selected' : ''}`}>
                  <button type="button" className="mp-row-main" onClick={() => setSelectedId(p.ID)}>
                    <span className="mp-who">
                      <strong>{p.Name}</strong>
                      <small>
                        {p.Contact}
                        {p.Area ? ` · ${p.Area}` : ''}
                        {p.HouseholdSize > 1 ? ` · ${p.HouseholdSize} on this number` : ''}
                      </small>
                    </span>
                    <span className="pt-mods">
                      {p.Modules.length === 0 ? (
                        <span className="mp-muted">No services yet</span>
                      ) : (
                        p.Modules.map((m) => (
                          <span key={m.type} className={`mp-chip-static ${m.open ? 'pt-open' : ''}`} title={`${m.open} open, ${m.completed} completed, ${m.lost} lost`}>
                            {m.label}
                            {m.open ? ' · open' : m.completed ? ' ✓' : ''}
                          </span>
                        ))
                      )}
                    </span>
                    <span className={`mp-due ${p.FollowUpStatus}`}>{dueText(p)}</span>
                    <span className="mp-agent">{p.Mine ? 'You' : p.Conflict ? 'Owner to decide' : p.OwnerName}</span>
                  </button>
                </div>
              ))
            )}
          </section>

          {selected && (
            <PatientProfile
              key={selected.ID}
              patient={selected}
              detail={detail}
              loading={detailLoading}
              modules={modules}
              onClose={() => setSelectedId(null)}
              onEdit={() => setForm({ mode: 'edit' })}
              onLogCall={() => setLogOpen(true)}
              onService={openService}
              onOpenRecord={(r) => setService({ type: r.Type, record: r })}
              onSelectPerson={(id) => setSelectedId(id)}
            />
          )}
        </div>
      </main>

      {form && (
        <PatientFormModal
          mode={form.mode}
          user={user}
          patient={form.mode === 'edit' ? selected : null}
          prefill={form.prefill}
          onClose={() => setForm(null)}
          onSaved={(d, notice) => {
            setForm(null);
            applyDetail(d);
            setSelectedId(d.patient.ID);
            setSearch('');
            onToast(notice || (form.mode === 'create' ? `${d.patient.Name} registered` : 'Patient updated'), 'success');
          }}
        />
      )}

      {logOpen && detail && (
        <LogContactModal
          patient={detail.patient}
          onClose={() => setLogOpen(false)}
          onSaved={(d) => {
            setLogOpen(false);
            applyDetail(d);
            onToast('Contact logged', 'success');
          }}
        />
      )}

      {service && detail && (
        <SalesView
          key={service.type + (service.record?.ID || 'new')}
          type={service.type}
          moduleInfo={modules.find((m) => m.id === service.type)}
          user={user}
          onToast={onToast}
          embed={{
            patient: { id: detail.patient.ID, name: detail.patient.Name, contact: detail.patient.Contact },
            record: service.record,
            onClose: (changed) => {
              setService(null);
              if (changed) loadDetail(detail.patient.ID).then(loadList);
            },
          }}
        />
      )}
    </div>
  );
};

// ===== The profile beside the list =====
interface ProfileProps {
  patient: PatientSummary;
  detail: PatientDetail | null;
  loading: boolean;
  modules: ModuleInfo[];
  onClose: () => void;
  onEdit: () => void;
  onLogCall: () => void;
  onService: (type: SaleType) => void;
  onOpenRecord: (r: PatientRecord) => void;
  onSelectPerson: (id: string) => void;
}

const PatientProfile: React.FC<ProfileProps> = ({ patient: p, detail, loading, modules, onClose, onEdit, onLogCall, onService, onOpenRecord, onSelectPerson }) => {
  const [allActivity, setAllActivity] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // On narrow screens the profile sits under the list: bring it into view.
  useEffect(() => {
    if (window.innerWidth < 1000) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const acts = detail?.activities || [];
  const address = [p.Address, p.Area, p.Pincode].filter(Boolean).join(', ');

  return (
    <aside ref={ref} className="mp-panel pt-profile" aria-label={`Profile of ${p.Name}`}>
      <div className="mp-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{p.Name}</h2>
          <div className="mp-muted">
            {p.Contact}
            {p.AltContact ? ` · alt ${p.AltContact}` : ''}
          </div>
          <div className="mp-muted">
            {p.Conflict ? 'An admin still has to choose who handles this patient' : p.Mine ? 'Your patient' : `Handled by ${p.OwnerName || '—'}`}
          </div>
        </div>
        <button type="button" className="mp-icon-btn" onClick={onClose} aria-label="Close profile">
          ✕
        </button>
      </div>

      <div className="mp-chips">
        {p.DoNotCall && <span className="mp-pill status-cancelled">Do not call</span>}
        {p.DOB && <span className="mp-chip-static">{ageOf(p.DOB)} · born {formatDate(p.DOB)}</span>}
        {p.HouseholdSize > 1 && <span className="mp-chip-static">{p.HouseholdSize} people on this number</span>}
        {!p.CanEdit && <span className="mp-chip-static">View only</span>}
      </div>

      {p.CanEdit && (
        <div className="mp-panel-actions">
          <button type="button" className="mp-btn-primary" onClick={onLogCall} disabled={!detail}>
            Log a call
          </button>
          {p.Contact && !p.DoNotCall && (
            <a className="mp-btn" href={whatsappLink(p.Contact)} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
          <button type="button" className="mp-btn" onClick={onEdit}>
            Edit details
          </button>
        </div>
      )}

      <section className="mp-panel-section">
        <h3>Start a service</h3>
        <div className="pt-services">
          {modules.map((m) => {
            const open = detail?.records.find((r) => r.Type === m.id && r.Status === 'Pending');
            return (
              <button key={m.id} type="button" className="mp-btn mp-small" disabled={!detail} onClick={() => onService(m.id)}>
                {open ? `Open ${m.label}` : `+ ${m.label}`}
              </button>
            );
          })}
        </div>
        <div className="mp-muted">New records go to {p.Conflict ? 'whoever the admin chooses' : p.Mine ? 'you' : p.OwnerName || 'you'}.</div>
      </section>

      {(address || p.Notes) && (
        <section className="mp-panel-section">
          <h3>Details</h3>
          {address && <div>{address}</div>}
          {p.Notes && <div className="pt-notes">{p.Notes}</div>}
        </section>
      )}

      <section className="mp-panel-section">
        <h3>Services {detail ? `(${detail.records.length})` : ''}</h3>
        {loading && !detail ? (
          <div className="mp-muted">Loading…</div>
        ) : !detail || detail.records.length === 0 ? (
          <div className="mp-muted">Nothing yet. Start a service above.</div>
        ) : (
          detail.records.map((r) => (
            <button
              key={r.Type + r.ID}
              type="button"
              className="pt-record"
              onClick={() => r.CanOpen && onOpenRecord(r)}
              disabled={!r.CanOpen}
              title={r.CanOpen ? 'Open this record' : `${r.AgentName}'s record (view only)`}
            >
              <span className="pt-record-top">
                <strong>{r.ModuleLabel}</strong>
                <span className={`mp-pill status-${r.Status.toLowerCase()}`}>{STATUS_LABEL[r.Status] || r.Status}</span>
                <span className="pt-record-amount">{r.Amount ? formatMoney(r.Amount) : '—'}</span>
              </span>
              <span className="mp-muted pt-record-line">{recordSummary(r)}</span>
              <span className="mp-muted pt-record-line">
                {formatDate(r.Date)} · {r.AgentName}
                {r.Status === 'Pending' && r.NextFollowUp ? ` · follow up ${formatDate(r.NextFollowUp)}` : ''}
                {r.PassStatus === 'active' && r.ValidUntil ? ` · valid until ${formatDate(r.ValidUntil)}` : ''}
              </span>
            </button>
          ))
        )}
      </section>

      {detail && detail.reminders.length > 0 && (
        <section className="mp-panel-section">
          <h3>Reminders</h3>
          {detail.reminders.map((r) => (
            <div key={r.ID} className="mp-line">
              <span>{r.Kind === 'renewal' ? `Renewal · ${r.Detail}` : (r.Products || []).map((x) => x.name).join(', ') || 'Refill'}</span>
              <span className={r.Overdue ? 'pt-overdue' : 'mp-muted'}>
                {r.DaysRemaining === null ? '' : r.Overdue ? `${Math.abs(r.DaysRemaining)}d overdue` : r.DaysRemaining === 0 ? 'today' : `in ${r.DaysRemaining}d`}
              </span>
            </div>
          ))}
        </section>
      )}

      {detail && detail.household.length > 0 && (
        <section className="mp-panel-section">
          <h3>Also on this number</h3>
          {detail.household.map((h) => (
            <button key={h.ID} type="button" className="mp-link" onClick={() => onSelectPerson(h.ID)}>
              {h.Name}
              {h.OwnerName ? <span className="mp-muted"> · {h.OwnerName}</span> : ''}
            </button>
          ))}
        </section>
      )}

      <section className="mp-panel-section">
        <h3>Contact history</h3>
        {p.OwnFollowUp && <div className={`mp-due ${p.FollowUpStatus}`}>Call back {formatDate(p.OwnFollowUp)}</div>}
        {!detail ? (
          <div className="mp-muted">{loading ? 'Loading…' : ''}</div>
        ) : acts.length === 0 ? (
          <div className="mp-muted">No calls or notes yet</div>
        ) : (
          <>
            {(allActivity ? acts : acts.slice(0, 6)).map((a) => (
              <div key={a.ID} className="pt-act">
                <div className="mp-line">
                  <span>
                    <strong>{a.Type}</strong>
                    {a.Direction ? ` (${a.Direction.toLowerCase()})` : ''}
                    {a.Outcome ? ` · ${a.Outcome}` : ''}
                  </span>
                  <span className="mp-muted">{formatTimeAgo(a.Date)}</span>
                </div>
                {a.Notes && <div>{a.Notes}</div>}
                <div className="mp-muted">
                  {a.About} · {a.ByName}
                </div>
              </div>
            ))}
            {acts.length > 6 && (
              <button type="button" className="mp-link" onClick={() => setAllActivity(!allActivity)}>
                {allActivity ? 'Show less' : `Show all ${acts.length}`}
              </button>
            )}
          </>
        )}
      </section>
    </aside>
  );
};

// ===== Register / edit a patient =====
interface FormProps {
  mode: 'create' | 'edit';
  user: User;
  patient: PatientSummary | null;
  prefill?: { name?: string; contact?: string };
  onClose: () => void;
  onSaved: (d: PatientDetail, notice?: string) => void;
}

const PatientFormModal: React.FC<FormProps> = ({ mode, user, patient, prefill, onClose, onSaved }) => {
  const isTeam = isTeamRole(user.Role);
  const [name, setName] = useState(patient?.Name || prefill?.name || '');
  const [contact, setContact] = useState(patient?.Contact || prefill?.contact || '');
  const [altContact, setAltContact] = useState(patient?.AltContact || '');
  const [dob, setDob] = useState(patient?.DOB || '');
  const [address, setAddress] = useState(patient?.Address || '');
  const [area, setArea] = useState(patient?.Area || '');
  const [pincode, setPincode] = useState(patient?.Pincode || '');
  const [notes, setNotes] = useState(patient?.Notes || '');
  const [agentEmail, setAgentEmail] = useState(user.Email);
  const [agents, setAgents] = useState<User[]>([]);
  const [check, setCheck] = useState<ContactCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (mode !== 'create' || !isTeam) return;
    api.listUsers().then((res) => {
      if (!res.error) setAgents((res.users || []).filter((u: User) => (u.Role === 'agent' || u.Role === 'manager') && u.Active));
    });
  }, []);

  // Who is already on this number (registering a relative, or a repeat caller).
  useEffect(() => {
    if (mode !== 'create' || digitsOf(contact).length < 10) {
      setCheck(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await api.checkContact(contact);
      setCheck(res.error ? null : (res as unknown as ContactCheck));
    }, 400);
    return () => clearTimeout(t);
  }, [contact]);

  const sameName = check?.people.find((x) => normName(x.Name) === normName(name));
  const owner = check && !check.conflict ? check.owner : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    if (!name.trim()) return setError('Name is required.');
    if (mode === 'create' && digitsOf(contact).length < 10) return setError('Enter the 10-digit phone number.');
    if (pincode && !/^\d{6}$/.test(pincode.trim())) return setError('Pincode must be 6 digits.');
    const data: Record<string, unknown> = {
      name: name.trim(), altContact: altContact.trim(), dob, address: address.trim(), area: area.trim(), pincode: pincode.trim(), notes: notes.trim(),
    };
    busyRef.current = true;
    setBusy(true);
    try {
      const res =
        mode === 'create'
          ? await api.createPatient({ ...data, contact: contact.trim(), ...(isTeam ? { agentEmail } : {}) })
          : await api.updatePatient(patient!.ID, data);
      if (res.error) setError(res.message || 'Could not save.');
      else onSaved(res as unknown as PatientDetail, res.notice);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <form className="sales-modal-popup open pt-modal" style={{ zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="pt-form-title" onSubmit={submit}>
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="pt-form-title">{mode === 'create' ? 'New patient' : `Edit ${patient?.Name}`}</h3>
              <div className="modal-header-sub">
                {mode === 'create' ? 'Register the caller once; every service then starts from their profile.' : 'The phone number links the patient to their records, so it can’t be changed here.'}
              </div>
            </div>
            <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="pt-modal-body">
          <div className="pt-grid">
            <div className="form-group">
              <label htmlFor="pt-phone">Phone number *</label>
              <input id="pt-phone" type="tel" inputMode="tel" value={contact} onChange={(e) => setContact(e.target.value)} disabled={mode === 'edit'} autoFocus={mode === 'create' && !contact} />
            </div>
            <div className="form-group">
              <label htmlFor="pt-name">Name *</label>
              <input id="pt-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={mode === 'create' && !!contact} />
            </div>
          </div>

          {check && (check.people.length > 0 || check.othersCount > 0 || owner) && (
            <div className={`contact-check ${sameName ? 'blocking' : ''}`} style={{ marginBottom: '12px' }}>
              {sameName
                ? `${sameName.Name} is already registered on this number. Close this and search for them.`
                : [
                    check.people.length ? `On this number: ${check.people.map((x) => x.Name).join(', ')}.` : '',
                    check.othersCount ? `${check.othersCount} other person(s) on this number.` : '',
                    owner && !owner.isMe ? `Handled by ${owner.name}; this patient will be too.` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
            </div>
          )}

          <div className="pt-grid">
            <div className="form-group">
              <label htmlFor="pt-alt">Alternate phone</label>
              <input id="pt-alt" type="tel" inputMode="tel" value={altContact} onChange={(e) => setAltContact(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pt-dob">Date of birth</label>
              <input id="pt-dob" type="date" max={todayKey()} value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="pt-address">Address</label>
            <input id="pt-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, street, landmark" />
          </div>
          <div className="pt-grid">
            <div className="form-group">
              <label htmlFor="pt-area">Area</label>
              <input id="pt-area" value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pt-pin">Pincode</label>
              <input id="pt-pin" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="pt-notes">Notes / medical conditions</label>
            <textarea id="pt-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Diabetic, on insulin; prefers calls after 6 PM" />
          </div>
          {mode === 'create' && isTeam && agents.length > 0 && !owner && (
            <div className="form-group">
              <label htmlFor="pt-agent">Handled by</label>
              <select id="pt-agent" value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)}>
                <option value={user.Email}>Me ({user.Name})</option>
                {agents.filter((a) => a.Email !== user.Email).map((a) => (
                  <option key={a.ID} value={a.Email}>
                    {a.Name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <div className="contact-check blocking">{error}</div>}
        </div>
        <div className="pt-modal-foot">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !!sameName}>
            {busy ? 'Saving…' : mode === 'create' ? 'Register patient' : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  );
};

// ===== Log contact on the patient =====
const LogContactModal: React.FC<{ patient: PatientSummary; onClose: () => void; onSaved: (d: PatientDetail) => void }> = ({ patient, onClose, onSaved }) => {
  const [type, setType] = useState<ActivityType>('Call');
  const [direction, setDirection] = useState<ActivityDirection>('Incoming');
  const [outcome, setOutcome] = useState<ActivityOutcome>('Connected');
  const [notes, setNotes] = useState('');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const isNote = type === 'Note';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    if (isNote && !notes.trim()) return setError('A note needs some text.');
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.logPatientActivity(patient.ID, {
        type, direction: isNote ? '' : direction, outcome: isNote ? '' : outcome, notes: notes.trim(), nextFollowUp,
      });
      if (res.error) setError(res.message || 'Could not log this.');
      else onSaved(res as unknown as PatientDetail);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <form className="sales-modal-popup open pt-modal" style={{ zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="pt-log-title" onSubmit={submit}>
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="pt-log-title">Log contact · {patient.Name}</h3>
              <div className="modal-header-sub">For a general enquiry. Calls about one service can also be logged on that record.</div>
            </div>
            <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="pt-modal-body">
          <div className="pt-grid">
            <div className="form-group">
              <label htmlFor="pt-act-type">Type</label>
              <select id="pt-act-type" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
                {ACT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            {!isNote && (
              <div className="form-group">
                <label htmlFor="pt-act-dir">Who started it</label>
                <select id="pt-act-dir" value={direction} onChange={(e) => setDirection(e.target.value as ActivityDirection)}>
                  <option value="Incoming">They contacted us</option>
                  <option value="Outgoing" disabled={patient.DoNotCall}>
                    We contacted them{patient.DoNotCall ? ' (Do not call)' : ''}
                  </option>
                </select>
              </div>
            )}
          </div>
          {!isNote && (
            <div className="form-group">
              <label htmlFor="pt-act-outcome">Outcome</label>
              <select id="pt-act-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ActivityOutcome)}>
                {ACT_OUTCOMES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="pt-act-notes">What was said{isNote ? ' *' : ''}</label>
            <textarea id="pt-act-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Asked about lab test prices, will decide by Friday" autoFocus />
          </div>
          <div className="form-group">
            <label htmlFor="pt-act-next">Call back on</label>
            <input id="pt-act-next" type="date" min={todayKey()} value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
            <small className="mp-muted">Leave empty if no call-back is needed (clears the previous one).</small>
          </div>
          {error && <div className="contact-check blocking">{error}</div>}
        </div>
        <div className="pt-modal-foot">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </>
  );
};
