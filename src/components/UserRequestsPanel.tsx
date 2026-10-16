import React, { useEffect, useState } from 'react';
import { User, UserRequest } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';
import { formatDate } from '../utils/date';

interface Props {
  user: User;
  refreshKey: number;
  onToast: (msg: string, type?: 'error' | 'success') => void;
  onChanged: () => void;
}

// Pending deactivation requests. Managers see what they've asked for;
// admins approve (hand over + deactivate) or reject.
export const UserRequestsPanel: React.FC<Props> = ({ user, refreshKey, onToast, onChanged }) => {
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = isSeniorRole(user.Role); // who can approve

  const load = async () => {
    const res = await api.listUserRequests(false);
    if (!res.error) setRequests(res.requests || []);
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const decide = async (r: UserRequest, approve: boolean) => {
    const verb = approve ? 'Approve' : 'Reject';
    if (!window.confirm(`${verb} deactivating ${r.UserName}?` + (approve ? ` Their open work goes to ${r.SuccessorName}.` : ''))) return;
    setBusyId(r.ID);
    try {
      const res = await api.decideUserRequest(r.ID, approve);
      if (res.error) {
        onToast(res.message || 'Could not update the request.', 'error');
        return;
      }
      const h = res.handover;
      onToast(
        approve && h
          ? `${r.UserName} deactivated. ${h.patients} patient(s), ${h.records} open record(s) and ${h.reminders} reminder(s) moved to ${r.SuccessorName}.`
          : 'Request rejected.',
        'success'
      );
      load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;
  return (
    <div className="table-card" style={{ marginBottom: '16px' }}>
      <div style={{ padding: '14px 18px', fontWeight: 600 }}>Deactivation requests waiting for an admin</div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Deactivate</th>
              <th>Hand over to</th>
              <th>Reason</th>
              <th>Asked by</th>
              {isAdmin && <th style={{ textAlign: 'right' }}>Decision</th>}
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.ID}>
                <td><strong>{r.UserName}</strong><div><small className="muted">{r.UserEmail}</small></div></td>
                <td>{r.SuccessorName}</td>
                <td>{r.Reason}</td>
                <td>{r.RequestedByName}<div><small className="muted">{formatDate(r.CreatedAt)}</small></div></td>
                {isAdmin && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="secondary" disabled={busyId === r.ID} onClick={() => decide(r, false)}
                      style={{ padding: '5px 12px', fontSize: '0.8rem', marginRight: '8px' }}>Reject</button>
                    <button type="button" className="danger" disabled={busyId === r.ID} onClick={() => decide(r, true)}
                      style={{ padding: '5px 12px', fontSize: '0.8rem' }}>Approve</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
