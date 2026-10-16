import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { api } from '../services/api';

interface Props {
  from: User; // whose patients move
  team: User[];
  onClose: () => void;
  onDone: (message: string) => void;
}

// Hand everything one person handles to someone else (leave, workload),
// without deactivating them. Completed sales stay in their name.
export const HandoverModal: React.FC<Props> = ({ from, team, onClose, onDone }) => {
  const successors = team.filter((u) => u.Active && u.ID !== from.ID && (u.Role === 'agent' || u.Role === 'manager'));
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ patients: number; records: number; reminders: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!to) return;
    api.handoverAgent({ fromEmail: from.Email, toEmail: to, dryRun: true }).then((res) => {
      if (res.error) setError(res.message || 'Could not check.');
      else setPreview(res.preview);
    });
  }, [to]);

  const submit = async () => {
    setError(null);
    if (!to) return setError('Choose who takes over.');
    if (reason.trim().length < 3) return setError('Give a reason, e.g. "On leave until 30 Nov".');
    setBusy(true);
    try {
      const res = await api.handoverAgent({ fromEmail: from.Email, toEmail: to, dryRun: false, reason: reason.trim() });
      if (res.error) return setError(res.message || 'Could not hand over.');
      const m = res.moved;
      onDone(`${m.patients} patient(s), ${m.records} open record(s) and ${m.reminders} reminder(s) moved from ${from.Name}.`);
    } finally {
      setBusy(false);
    }
  };

  const nothing = preview && !preview.patients && !preview.records && !preview.reminders;
  return (
    <>
      <div className="overlay open" style={{ zIndex: 1200 }} onClick={onClose} />
      <div className="sales-modal-popup open" style={{ maxWidth: '480px', zIndex: 1201 }} role="dialog" aria-modal="true" aria-labelledby="handover-title">
        <div className="modal-header-hero">
          <div className="modal-header-title">
            <div>
              <h3 id="handover-title">Hand over {from.Name}'s patients</h3>
              <div className="modal-header-sub">
                Their patients, open records in every module and reminders move. {from.Name} stays active; completed sales stay in their name.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label htmlFor="handover-to">Who takes over *</label>
            <select id="handover-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">— Choose —</option>
              {successors.map((u) => <option key={u.ID} value={u.Email}>{u.Name}{u.Role === 'manager' ? ' (manager)' : ''}</option>)}
            </select>
          </div>
          {preview && (
            <div className="contact-check" style={{ marginBottom: '12px' }}>
              {nothing ? `${from.Name} has nothing to hand over.` : `${preview.patients} patient(s), ${preview.records} open record(s) and ${preview.reminders} reminder(s) will move.`}
            </div>
          )}
          <div className="form-group">
            <label htmlFor="handover-reason">Reason *</label>
            <input id="handover-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. On leave until 30 Nov" />
          </div>
          {error && <div className="contact-check blocking" style={{ marginTop: '10px' }}>{error}</div>}
        </div>
        <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !preview || !!nothing}>{busy ? 'Moving…' : 'Hand over'}</button>
        </div>
      </div>
    </>
  );
};
