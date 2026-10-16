import React, { useState } from 'react';
import { User } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';

interface Props {
  user: User; // who is signed in
  target: User; // who is being deactivated
  team: User[];
  onClose: () => void;
  onDone: (message: string) => void;
}

// Deactivating someone always says who takes over their patients.
// Managers send a request for an admin to approve; admins deactivate
// directly (the server hands the patients over first).
export const DeactivateUserModal: React.FC<Props> = ({ user, target, team, onClose, onDone }) => {
  const isAdmin = isSeniorRole(user.Role); // admins and senior managers deactivate directly
  const successors = team.filter(
    (u) => u.Active && u.ID !== target.ID && (u.Role === 'agent' || u.Role === 'manager')
  );
  const [successor, setSuccessor] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!isAdmin && !successor) return setError('Choose who takes over their patients.');
    if (!isAdmin && reason.trim().length < 3) return setError('Give a reason (at least 3 characters).');
    setBusy(true);
    try {
      const res = isAdmin
        ? await api.updateUser(target.ID, { active: false, ...(successor ? { successorEmail: successor } : {}) })
        : await api.requestDeactivation(target.ID, successor, reason.trim());
      if (res.error) {
        setError(res.message || 'Could not complete this.');
        return;
      }
      onDone(
        isAdmin
          ? `${target.Name} deactivated${successor ? '; their patients were handed over' : ''}.`
          : `Request sent. An admin will approve the deactivation of ${target.Name}.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <div className="sales-modal-popup open" style={{ maxWidth: '480px', zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="deactivate-title">{isAdmin ? 'Deactivate' : 'Request deactivation of'} {target.Name}</h3>
              <div className="modal-header-sub">
                Their open records, patients and refill reminders move to the person you choose. Completed sales stay in their
                name, so their incentives are kept.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label htmlFor="successor">Who takes over? {isAdmin ? '(needed if they still handle patients)' : '*'}</label>
            <select id="successor" value={successor} onChange={(e) => setSuccessor(e.target.value)}>
              <option value="">{isAdmin ? '— Nobody (they have no open work) —' : '— Choose —'}</option>
              {successors.map((u) => (
                <option key={u.ID} value={u.Email}>
                  {u.Name}{u.Role === 'manager' ? ' (manager)' : ''}
                </option>
              ))}
            </select>
          </div>
          {!isAdmin && (
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label htmlFor="deactivate-reason">Reason *</label>
              <textarea id="deactivate-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Left the company on 31 October" style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          )}
          {error && <div className="contact-check blocking">{error}</div>}
        </div>
        <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="danger" onClick={submit} disabled={busy}>
            {busy ? 'Working…' : isAdmin ? 'Hand over and deactivate' : 'Send request'}
          </button>
        </div>
      </div>
    </>
  );
};
