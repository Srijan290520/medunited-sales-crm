import React from 'react';
import { MedpassMember, MedpassRelation, MedpassSettings, PriceType } from '../types';
import { formatMoney } from '../utils/date';

// Whole years between two YYYY-MM-DD days (same rule as the server's ageOn).
export function ageOn(dob: string, on: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [oy, om, od] = on.split('-').map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

export interface MedpassQuote {
  total: number;
  extraFee: number;
  discount: number;
  opCredit: number;
  amount: number; // revenue
  payableNow: number;
}

// A preview of what the server will charge. The server works out the real
// amount when the record is saved.
export function medpassQuote(
  s: MedpassSettings,
  members: MedpassMember[],
  priceType: PriceType,
  discount: string,
  opCredit: string
): MedpassQuote {
  const children = members.filter((m) => m.relation === 'Child').length;
  const extraFee = Math.max(0, children - s.includedChildren) * s.extraChildFee;
  const total = s.price + extraFee;
  const d = priceType === 'Discounted' ? Math.min(Math.max(Number(discount) || 0, 0), s.maxDiscount) : 0;
  const op = priceType === 'Converted From OP' ? Math.min(Math.max(Number(opCredit) || 0, 0), total) : 0;
  const amount = total - d;
  return { total, extraFee, discount: d, opCredit: op, amount, payableNow: amount - op };
}

interface MembersProps {
  members: MedpassMember[];
  onChange: (m: MedpassMember[]) => void;
  settings: MedpassSettings | null;
  saleDate: string;
  disabled?: boolean;
}

const RELATIONS: MedpassRelation[] = ['Father', 'Mother', 'Child'];

// Who the family pass covers: father, mother and children under the age
// limit on the sale date. Older children and other relatives need their own pass.
export const MedpassMembersEditor: React.FC<MembersProps> = ({ members, onChange, settings, saleDate, disabled }) => {
  const maxChildren = settings ? settings.includedChildren + settings.maxExtraChildren : 3;
  const childMax = settings?.childMaxAge ?? 21;
  const set = (i: number, patch: Partial<MedpassMember>) => onChange(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = (relation: MedpassRelation) => onChange([...members, { name: '', relation, dob: '' }]);
  const count = (r: MedpassRelation) => members.filter((m) => m.relation === r).length;

  return (
    <div>
      <label style={{ fontWeight: 600 }}>Family members on this pass</label>
      <p className="muted small-text" style={{ margin: '2px 0 8px' }}>
        Father, mother and children under {childMax} on the sale date
        {settings ? ` (${settings.includedChildren} children included, up to ${settings.maxExtraChildren} more at ${formatMoney(settings.extraChildFee)} each)` : ''}.
        Older children and other relatives need their own Medpass.
      </p>
      {members.length === 0 && <div className="muted small-text" style={{ marginBottom: '8px' }}>No members yet. Add them before completing the sale.</div>}
      {members.map((m, i) => {
        const age = m.dob ? ageOn(m.dob, saleDate) : null;
        const tooOld = m.relation === 'Child' && age !== null && age >= childMax;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.1fr auto', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
            <input aria-label={`Name of member ${i + 1}`} placeholder="Full name" value={m.name} disabled={disabled}
              onChange={(e) => set(i, { name: e.target.value })} />
            <select aria-label={`Relation of member ${i + 1}`} value={m.relation} disabled={disabled}
              onChange={(e) => set(i, { relation: e.target.value as MedpassRelation })}>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input aria-label={`Date of birth of member ${i + 1}`} type="date" value={m.dob} disabled={disabled}
              max={saleDate || undefined}
              title={m.relation === 'Child' ? 'Required for children' : 'Optional for parents'}
              onChange={(e) => set(i, { dob: e.target.value })}
              style={tooOld || (m.relation === 'Child' && !m.dob) ? { borderColor: '#ef4444' } : undefined} />
            <button type="button" className="secondary" disabled={disabled} aria-label={`Remove member ${i + 1}`}
              onClick={() => onChange(members.filter((_, j) => j !== i))} style={{ padding: '6px 10px' }}>✕</button>
            {tooOld && (
              <div style={{ gridColumn: '1 / -1', color: '#b91c1c', fontSize: '0.78rem' }}>
                {m.name || 'This child'} is {age}. Children must be under {childMax}; they need their own Medpass.
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
          <button type="button" className="secondary" disabled={count('Father') >= 1} onClick={() => add('Father')}>+ Father</button>
          <button type="button" className="secondary" disabled={count('Mother') >= 1} onClick={() => add('Mother')}>+ Mother</button>
          <button type="button" className="secondary" disabled={count('Child') >= maxChildren} onClick={() => add('Child')}>+ Child</button>
        </div>
      )}
    </div>
  );
};

const DISCOUNT_NOTE: Record<string, string> = { Approved: 'approved', Rejected: 'rejected', Requested: 'waiting for approval' };

export const MedpassQuoteBox: React.FC<{ quote: MedpassQuote; priceType: PriceType; legacyAmount?: number | null; discountStatus?: string }> = ({ quote, priceType, legacyAmount, discountStatus }) => {
  if (legacyAmount !== undefined && legacyAmount !== null) {
    return <div className="contact-check">Recorded before the Medpass price rules: {formatMoney(legacyAmount)}.</div>;
  }
  return (
    <div className="contact-check" style={{ lineHeight: 1.7 }}>
      <div>Medpass: <strong>{formatMoney(quote.total - quote.extraFee)}</strong>{quote.extraFee ? <> + extra child {formatMoney(quote.extraFee)}</> : null}</div>
      {priceType === 'Discounted' && <div>Discount: − {formatMoney(quote.discount)} ({DISCOUNT_NOTE[discountStatus || ''] || 'needs approval'})</div>}
      <div>Total{priceType === 'Converted From OP' ? ' (revenue)' : ''}: <strong>{formatMoney(quote.amount)}</strong></div>
      {priceType === 'Converted From OP' && <div>OP fee already paid: − {formatMoney(quote.opCredit)} (shown on the bill as a discount)</div>}
      <div>Customer pays now: <strong>{formatMoney(quote.payableNow)}</strong></div>
    </div>
  );
};
