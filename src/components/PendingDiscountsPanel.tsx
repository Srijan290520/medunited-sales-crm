import React, { useEffect, useState } from 'react';
import { User, PendingDiscount } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';
import { formatMoney, formatDate } from '../utils/date';

interface Props {
  user: User;
  refreshKey: number;
  onToast: (msg: string, type?: 'error' | 'success') => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}

// Medpass discounts waiting for an admin or senior manager. Managers see the
// list; approvers can approve or reject from here.
export const PendingDiscountsPanel: React.FC<Props> = ({ user, refreshKey, onToast, onChanged, onOpen }) => {
  const [items, setItems] = useState<PendingDiscount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const canDecide = isSeniorRole(user.Role);

  const load = async () => {
    const res = await api.listPendingDiscounts();
    if (!res.error) setItems(res.discounts || []);
  };
  useEffect(() => {
    load();
  }, [refreshKey]);

  const decide = async (d: PendingDiscount, approve: boolean) => {
    let note = '';
    if (!approve) {
      note = window.prompt(`Why is the ${formatMoney(d.DiscountAmount)} discount for ${d.CustomerName} rejected?`) || '';
      if (note.trim().length < 3) return;
    }
    setBusy(d.ID);
    try {
      const res = await api.decideMedpassDiscount(d.ID, approve, note.trim());
      if (res.error) onToast(res.message || 'Could not save the decision.', 'error');
      else {
        onToast(`Discount ${approve ? 'approved' : 'rejected'} for ${d.CustomerName}.`, 'success');
        load();
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) return null;
  return (
    <div className="table-card" style={{ marginBottom: '16px' }}>
      <div style={{ padding: '12px 18px', fontWeight: 600 }}>
        Discounts waiting for approval ({items.length})
        {!canDecide && <span className="muted small-text"> — an admin or senior manager approves these</span>}
      </div>
      <div className="table-container">
        <table className="data-table">
          <tbody>
            {items.map((d) => (
              <tr key={d.ID}>
                <td>
                  <button type="button" className="link-button" onClick={() => onOpen(d.ID)} style={{ fontWeight: 600, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--accent-dark)' }}>
                    {d.CustomerName}
                  </button>
                  <div className="muted small-text">{d.AgentName}</div>
                </td>
                <td>− {formatMoney(d.DiscountAmount)} → {formatMoney(d.Amount)}</td>
                <td className="small-text">{d.DiscountReason}<div className="muted">asked by {d.DiscountRequestedBy} · {formatDate(d.UpdatedAt)}</div></td>
                {canDecide && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="secondary" disabled={busy === d.ID} onClick={() => decide(d, false)} style={{ padding: '5px 12px', fontSize: '0.8rem', marginRight: '8px' }}>Reject</button>
                    <button type="button" disabled={busy === d.ID} onClick={() => decide(d, true)} style={{ padding: '5px 12px', fontSize: '0.8rem' }}>Approve</button>
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
