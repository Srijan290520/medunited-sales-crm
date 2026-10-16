import React, { useEffect, useState } from 'react';
import { User, MedpassSettings } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

const FIELDS: { key: keyof MedpassSettings; label: string; hint: string }[] = [
  { key: 'price', label: 'Medpass price (₹)', hint: 'Family of four for one year' },
  { key: 'maxDiscount', label: 'Maximum discount (₹)', hint: 'Needs approval' },
  { key: 'extraChildFee', label: 'Extra child fee (₹)', hint: 'For each child beyond those included' },
  { key: 'includedChildren', label: 'Children included', hint: '' },
  { key: 'maxExtraChildren', label: 'Extra children allowed', hint: 'More than this needs a separate pass' },
  { key: 'childMaxAge', label: 'Children must be younger than', hint: 'Age on the sale date' },
];

// Medpass prices and family rules. Everyone sees them; admins and senior
// managers change them. Completed passes keep the price they were sold at.
export const MedpassSettingsCard: React.FC<Props> = ({ user, onToast }) => {
  const canEdit = isSeniorRole(user.Role);
  const [saved, setSaved] = useState<MedpassSettings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [singleParent, setSingleParent] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = (s: MedpassSettings) => {
    setSaved(s);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])));
    setSingleParent(s.singleParent);
  };
  useEffect(() => {
    api.getMedpassSettings().then((res) => !res.error && apply(res.settings));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.updateMedpassSettings({ ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])), singleParent });
      if (res.error) onToast(res.message || 'Could not save.', 'error');
      else {
        apply(res.settings);
        onToast('Medpass prices saved. Completed passes keep the price they were sold at.', 'success');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!saved) return null;
  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-title">Medpass prices &amp; family rules</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`mp-${f.key}`}>{f.label}</label>
            <input id={`mp-${f.key}`} type="number" min="0" disabled={!canEdit} value={form[f.key] ?? ''}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            {f.hint && <div className="muted small-text">{f.hint}</div>}
          </div>
        ))}
        <div>
          <label htmlFor="mp-single">Single parent may buy a family pass</label>
          <select id="mp-single" disabled={!canEdit} value={singleParent ? 'yes' : 'no'} onChange={(e) => setSingleParent(e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No — both parents</option>
          </select>
        </div>
      </div>
      {canEdit && (
        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Medpass prices'}</button>
        </div>
      )}
    </div>
  );
};
