import React, { useEffect, useState } from 'react';
import { User, HomekareService } from '../types';
import { isSeniorRole } from '../utils/roles';
import { api } from '../services/api';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

// Homekare services offered in the record form. Admins and senior managers
// add services or hide ones no longer offered; nothing is deleted, so older
// records keep their services. Prices are typed per patient.
export const HomekareCatalogueCard: React.FC<Props> = ({ user, onToast }) => {
  const canEdit = isSeniorRole(user.Role);
  const [list, setList] = useState<HomekareService[]>([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Per visit');
  const [monthly, setMonthly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getModules().then((res) => {
      if (!res.error) setList((res.modules || []).find((m: any) => m.id === 'homekare')?.services || []);
    });
  }, []);

  const change = async (data: Parameters<typeof api.updateHomekareCatalogue>[0], done: string) => {
    setBusy(true);
    try {
      const res = await api.updateHomekareCatalogue(data);
      if (res.error) return onToast(res.message || 'Could not save.', 'error');
      setList(res.services);
      onToast(done, 'success');
      return true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-title">Homekare services</div>
      <p className="muted small-text" style={{ marginBottom: '12px' }}>
        {list.filter((s) => !s.hidden).length} offered{list.some((s) => s.hidden) ? `, ${list.filter((s) => s.hidden).length} hidden` : ''}. Prices are typed per patient. Monthly packages get a renewal reminder.
      </p>
      {canEdit && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await change({ add: { name: name.trim(), unit: unit.trim(), monthly } }, `${name.trim()} added.`)) {
              setName('');
              setMonthly(false);
            }
          }}
          style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: '10px', alignItems: 'end', marginBottom: '14px' }}
        >
          <div className="mp-field"><label htmlFor="hk-name">New service</label><input id="hk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HOMEKARE PHYSIOTHERAPY" /></div>
          <div className="mp-field"><label htmlFor="hk-unit">Charged</label><input id="hk-unit" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', height: '38px' }}>
            <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} /> Monthly package
          </label>
          <button type="submit" className="mp-btn-primary" disabled={busy || name.trim().length < 3}>Add</button>
        </form>
      )}
      <div className="dw-list" style={{ maxHeight: '360px', overflowY: 'auto' }}>
        {list.map((s) => (
          <div key={s.name} className="dw-item dw-static">
            <strong style={{ color: s.hidden ? '#6b7280' : undefined }}>{s.name}{s.hidden ? ' (hidden)' : ''}</strong>
            <span className="mp-muted">{s.unit}{s.monthly ? ' · monthly package' : ''}{s.builtIn === false ? ' · added' : ''}</span>
            {canEdit ? (
              <button type="button" className="mp-link" disabled={busy}
                onClick={() => change(s.hidden ? { show: s.name } : { hide: s.name }, s.hidden ? `${s.name} is offered again.` : `${s.name} hidden from new orders.`)}>
                {s.hidden ? 'Show' : 'Hide'}
              </button>
            ) : <span />}
          </div>
        ))}
      </div>
    </div>
  );
};
