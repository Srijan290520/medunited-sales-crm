import React, { useEffect, useState } from 'react';
import { Sale, SaleActivity, SaleType } from '../types';
import { api } from '../services/api';
import { formatDate, formatMoney, formatTimeAgo } from '../utils/date';

interface Props {
  type: SaleType;
  sale: Sale;
  canManageAll: boolean;
  onClose: () => void;
  onEdit: () => void;
  onLogCall: () => void;
}

// WhatsApp needs the number with the country code; Indian numbers are stored as 10 digits.
function whatsappLink(contact: string): string {
  const d = contact.replace(/\D/g, '');
  return `https://wa.me/${d.length === 10 ? '91' + d : d}`;
}

const STATUS_LABEL: Record<string, string> = { Pending: 'Open', Completed: 'Completed', Cancelled: 'Lost' };

// The record's details beside the list: who, what, the next step and the
// latest contacts, with the everyday actions. Editing opens the full form.
export const RecordPanel: React.FC<Props> = ({ type, sale, canManageAll, onClose, onEdit, onLogCall }) => {
  const [activity, setActivity] = useState<SaleActivity[] | null>(null);

  useEffect(() => {
    let live = true;
    setActivity(null);
    api.getSale(type, sale.ID).then((res) => {
      if (live && !res.error) setActivity((res.activities || []).slice(0, 3));
    });
    return () => {
      live = false;
    };
  }, [type, sale.ID, sale.AttemptCount, sale.Status]);

  const chips: string[] = [];
  if (sale.AlsoIn && sale.AlsoIn.length) chips.push(`Also in: ${sale.AlsoIn.join(', ')}`);
  if ((sale.HouseholdSize || 1) > 1) chips.push(`${sale.HouseholdSize} people on this number`);
  if (sale.DoNotCall) chips.push('Do not call');
  if (sale.DiscountStatus === 'Requested') chips.push('Discount waiting for approval');
  if (sale.PassStatus === 'active') chips.push(`Valid until ${formatDate(sale.ValidUntil || '')}`);
  if (sale.PassStatus === 'expired') chips.push('Pass expired');

  const next =
    sale.Status === 'Pending'
      ? sale.NextFollowUp
        ? `${sale.FollowUpStatus === 'overdue' ? 'Overdue — ' : ''}follow up ${sale.FollowUpStatus === 'today' ? 'today' : formatDate(sale.NextFollowUp)}`
        : 'No follow-up date set'
      : sale.Status === 'Completed'
      ? 'Sale completed'
      : `Lost${sale.LostReason ? ` — ${sale.LostReason}` : ''}. Reopen if they come back.`;

  return (
    <aside className="mp-panel" aria-label={`Details of ${sale.CustomerName}`}>
      <div className="mp-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{sale.CustomerName}</h2>
          <div className="mp-muted">
            {sale.Contact || 'No phone'}
            {canManageAll ? ` · handled by ${sale.AgentName}` : ''}
          </div>
        </div>
        <button type="button" className="mp-icon-btn" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </div>

      <div className="mp-chips">
        <span className={`mp-pill status-${sale.Status.toLowerCase()}`}>{STATUS_LABEL[sale.Status] || sale.Status}</span>
        {sale.Temperature && <span className={`mp-pill temp-${sale.Temperature.toLowerCase()}`}>{sale.Temperature}</span>}
        {chips.map((c) => (
          <span key={c} className="mp-chip-static">
            {c}
          </span>
        ))}
      </div>

      <div className="mp-panel-actions">
        <button type="button" className="mp-btn-primary" onClick={onLogCall}>
          Log a call
        </button>
        {sale.Contact && !sale.DoNotCall ? (
          <a className="mp-btn" href={whatsappLink(sale.Contact)} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        ) : (
          <button type="button" className="mp-btn" disabled title={sale.DoNotCall ? 'Marked Do Not Call' : 'No phone number'}>
            WhatsApp
          </button>
        )}
        <button type="button" className="mp-btn" onClick={onEdit}>
          Edit
        </button>
      </div>

      <section className="mp-panel-section">
        <h3>{type === 'medpass' ? 'Pass' : type === 'pharmacy' ? 'Medicines' : type === 'homekare' ? 'Services' : 'Tests'}</h3>
        {type === 'medpass' && (
          <>
            <div>
              {sale.PriceType || 'Full Price'} · {formatMoney(sale.Amount)}
              {sale.PayableNow !== undefined && sale.PayableNow !== sale.Amount ? ` · pays ${formatMoney(sale.PayableNow)} now` : ''}
            </div>
            <div className="mp-muted">
              {sale.Members && sale.Members.length
                ? sale.Members.map((m) => `${m.name} (${m.relation.toLowerCase()})`).join(', ')
                : 'Family members not added yet'}
            </div>
          </>
        )}
        {type === 'homekare' &&
          ((sale.Services || []).length ? (
            (sale.Services || []).map((l, i) => (
              <div key={i} className="mp-line">
                <span>{l.service.replace(/^HOMEKARE\s*-?\s*/i, '')}</span>
                <span>{formatMoney(l.price)}</span>
              </div>
            ))
          ) : (
            <div className="mp-muted">No services added yet</div>
          ))}
        {type === 'lab' && (
          <>
            {(sale.Tests || []).length ? (
              (sale.Tests || []).map((l, i) => (
                <div key={i} className="mp-line">
                  <span>
                    {l.name} <span className="mp-muted">· {l.kind}</span>
                  </span>
                  <span>{formatMoney(l.price)}</span>
                </div>
              ))
            ) : (
              <div className="mp-muted">No tests added yet</div>
            )}
            <div className="mp-muted">
              {sale.ReportDeliveredOn
                ? `Report sent ${formatDate(sale.ReportDeliveredOn)} by ${sale.ReportDeliveredVia}`
                : sale.AppointmentDate
                ? `Appointment ${formatDate(sale.AppointmentDate)}`
                : sale.HomeCollection
                ? `Home collection${sale.CollectionDate ? ' ' + formatDate(sale.CollectionDate) : ''}`
                : 'Report not sent yet'}
            </div>
          </>
        )}
        {type === 'pharmacy' && <div>{sale.Detail || 'No medicines added yet'}</div>}
        {type !== 'medpass' && <div className="mp-muted">Total {formatMoney(sale.Amount)}</div>}
      </section>

      <section className="mp-panel-section">
        <h3>Next step</h3>
        <div>{next}</div>
        {sale.Notes && <div className="mp-muted mp-clamp">{sale.Notes}</div>}
      </section>

      <section className="mp-panel-section">
        <h3>Recent activity</h3>
        {activity === null ? (
          <div className="mp-muted">Loading…</div>
        ) : activity.length === 0 ? (
          <div className="mp-muted">No calls or notes yet</div>
        ) : (
          activity.map((a) => (
            <div key={a.ID} className="mp-line">
              <span>
                {a.Type}
                {a.Direction ? ` (${a.Direction.toLowerCase()})` : ''}
                {a.Outcome ? ` · ${a.Outcome}` : ''}
                {a.Notes ? ` — ${a.Notes}` : ''}
              </span>
              <span className="mp-muted">{formatTimeAgo(a.Date)}</span>
            </div>
          ))
        )}
        <button type="button" className="mp-link" onClick={onEdit}>
          Full history
        </button>
      </section>
    </aside>
  );
};
