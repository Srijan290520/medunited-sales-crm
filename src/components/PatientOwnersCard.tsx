import React, { useEffect, useState } from 'react';
import { User, PatientConflict, MigrationSummary } from '../types';
import { api } from '../services/api';
import { formatDate } from '../utils/date';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

// Patient owners: the one-time migration (admin) and phone numbers whose
// earlier records were handled by more than one agent. The admin decides:
// keep everyone on the number with one agent, or choose an agent per person.
export const PatientOwnersCard: React.FC<Props> = ({ user, onToast }) => {
  const isAdmin = user.Role === 'admin';
  const [conflicts, setConflicts] = useState<PatientConflict[]>([]);
  const [team, setTeam] = useState<User[]>([]);
  const [dryRun, setDryRun] = useState<MigrationSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // per household: '' = person by person, else one agent for everyone
  const [together, setTogether] = useState<Record<string, string>>({});
  const [perPerson, setPerPerson] = useState<Record<string, string>>({});

  const load = async () => {
    const [c, u] = await Promise.all([api.listPatientConflicts(), api.listUsers()]);
    if (!c.error) setConflicts(c.conflicts || []);
    if (!u.error) setTeam((u.users || []).filter((x: User) => x.Active && (x.Role === 'agent' || x.Role === 'manager')));
  };

  useEffect(() => {
    load();
  }, []);

  const runDry = async () => {
    setBusy('dry');
    try {
      const res = await api.migratePatients(true);
      if (res.error) onToast(res.message || 'Dry run failed.', 'error');
      else setDryRun(res.migration);
    } finally {
      setBusy(null);
    }
  };

  const runReal = async () => {
    if (!window.confirm('Run the patient migration now? Make a copy of the Google Sheet first (File → Make a copy). It only adds patients and links records; it never changes who a record belongs to.')) return;
    setBusy('real');
    try {
      const res = await api.migratePatients(false);
      if (res.error) {
        onToast(res.message || 'Migration failed.', 'error');
        return;
      }
      const m: MigrationSummary = res.migration;
      onToast(`Migration done: ${m.patientsCreated} patients created, ${m.recordsLinked} records linked, ${m.newConflicts} numbers need a decision.`, 'success');
      setDryRun(null);
      load();
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (c: PatientConflict) => {
    const one = together[c.contactKey] || '';
    let payload: Parameters<typeof api.resolvePatientConflict>[0];
    if (one) {
      payload = { contact: c.contact, agentEmail: one };
    } else {
      const assignments = c.people
        .map((p) => ({ patientId: p.ID || undefined, name: p.Name, agentEmail: perPerson[c.contactKey + '|' + p.Name] || '' }))
        .filter((a) => a.agentEmail);
      if (!assignments.length) {
        onToast('Choose an agent for the household, or for each person.', 'error');
        return;
      }
      payload = { contact: c.contact, assignments };
    }
    setBusy(c.contactKey);
    try {
      const res = await api.resolvePatientConflict(payload);
      if (res.error) onToast(res.message || 'Could not save.', 'error');
      else {
        onToast(`Saved. ${res.moved.length} open record(s) moved` + (res.remainingConflicts ? `; ${res.remainingConflicts} person(s) still undecided.` : '.'), 'success');
        load();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-title">Patient owners</div>
      <p className="muted small-text" style={{ marginBottom: '14px' }}>
        Every patient has one agent. Relatives sharing a phone number are handled by the same agent unless you split them.
      </p>

      {isAdmin && (
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="secondary" disabled={!!busy} onClick={runDry}>
              {busy === 'dry' ? 'Checking…' : 'Check migration (dry run)'}
            </button>
            <button type="button" disabled={!!busy || !dryRun} onClick={runReal} title={dryRun ? '' : 'Run the dry run first'}>
              {busy === 'real' ? 'Migrating…' : 'Run migration'}
            </button>
          </div>
          {dryRun && (
            <div className="contact-check" style={{ marginTop: '10px' }}>
              Dry run: {dryRun.households} phone numbers, {dryRun.patientsCreated} patients to create, {dryRun.recordsLinked} records to
              link, {dryRun.newConflicts} numbers with more than one agent (listed below after the migration). Nothing has been saved.
            </div>
          )}
        </div>
      )}

      {conflicts.length === 0 ? (
        <p className="muted small-text">No phone numbers need a decision.</p>
      ) : (
        conflicts.map((c) => (
          <div key={c.contactKey} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600 }}>
              {c.contact}{' '}
              <span className="muted small-text">handled before by {c.agents.map((a) => `${a.name} (${a.open} open, ${a.closed} closed)`).join(', ')}</span>
            </div>
            <table className="data-table" style={{ marginTop: '8px' }}>
              <tbody>
                {c.people.map((p) => (
                  <tr key={p.Name}>
                    <td style={{ width: '30%' }}>
                      <strong>{p.Name}</strong>
                      {!p.Conflict && p.OwnerName && <div className="muted small-text">handled by {p.OwnerName}</div>}
                    </td>
                    <td className="small-text">
                      {p.records.map((r, i) => (
                        <div key={i}>{r.module} · {r.status} · {r.agentName} · {formatDate(r.date)}</div>
                      ))}
                    </td>
                    {isAdmin && !together[c.contactKey] && (
                      <td style={{ width: '28%' }}>
                        <select
                          aria-label={`Agent for ${p.Name}`}
                          value={perPerson[c.contactKey + '|' + p.Name] || ''}
                          onChange={(e) => setPerPerson({ ...perPerson, [c.contactKey + '|' + p.Name]: e.target.value })}
                        >
                          <option value="">— Agent for {p.Name} —</option>
                          {team.map((u) => <option key={u.ID} value={u.Email}>{u.Name}</option>)}
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {isAdmin && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                <select
                  aria-label="Keep everyone on this number with"
                  value={together[c.contactKey] || ''}
                  onChange={(e) => setTogether({ ...together, [c.contactKey]: e.target.value })}
                >
                  <option value="">Choose an agent per person</option>
                  {team.map((u) => <option key={u.ID} value={u.Email}>Keep everyone with {u.Name}</option>)}
                </select>
                <button type="button" disabled={!!busy} onClick={() => resolve(c)}>
                  {busy === c.contactKey ? 'Saving…' : 'Save decision'}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};
