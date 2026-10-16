import React from 'react';
import { HomekareService } from '../types';
import { formatMoney } from '../utils/date';

// Typed price lines for Homekare services and Lab & Radiology tests. Prices
// are kept as text while typing; the server checks them and adds them up.

export interface ServiceDraft {
  service: string;
  price: string;
}
export interface TestDraft {
  name: string;
  kind: 'Lab' | 'Radiology';
  price: string;
}

export const linesTotal = (lines: { price: string }[]) =>
  lines.reduce((t, l) => t + (Number(l.price) > 0 ? Number(l.price) : 0), 0);

const row: React.CSSProperties = { display: 'grid', gap: '8px', marginBottom: '6px', alignItems: 'center' };

export const HomekareServicesEditor: React.FC<{
  lines: ServiceDraft[];
  onChange: (l: ServiceDraft[]) => void;
  catalogue: HomekareService[];
  disabled?: boolean;
}> = ({ lines, onChange, catalogue, disabled }) => {
  const set = (i: number, patch: Partial<ServiceDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const unitOf = (name: string) => catalogue.find((s) => s.name === name);
  return (
    <div>
      <label style={{ fontWeight: 600 }}>Services</label>
      <p className="muted small-text" style={{ margin: '2px 0 8px' }}>Pick each service and type the price agreed with this patient.</p>
      {lines.length === 0 && <div className="muted small-text" style={{ marginBottom: '8px' }}>No services yet. Add them before completing the sale.</div>}
      {lines.map((l, i) => {
        const s = unitOf(l.service);
        return (
          <div key={i} style={{ ...row, gridTemplateColumns: '2.4fr 1fr auto' }}>
            <select aria-label={`Service ${i + 1}`} value={l.service} disabled={disabled} onChange={(e) => set(i, { service: e.target.value })}>
              <option value="">— Choose a service —</option>
              {catalogue.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input aria-label={`Price of service ${i + 1}`} type="number" min="0" step="0.01" placeholder="₹ price" value={l.price}
              disabled={disabled} onChange={(e) => set(i, { price: e.target.value })} />
            <button type="button" className="secondary" disabled={disabled} aria-label={`Remove service ${i + 1}`}
              onClick={() => onChange(lines.filter((_, j) => j !== i))} style={{ padding: '6px 10px' }}>✕</button>
            {s && (
              <div className="muted small-text" style={{ gridColumn: '1 / -1', marginTop: '-4px' }}>
                {s.unit}{s.monthly ? ' · monthly package — a renewal reminder is set when the sale is completed' : ''}
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <button type="button" className="secondary" onClick={() => onChange([...lines, { service: '', price: '' }])} style={{ marginTop: '6px' }}>+ Add service</button>
      )}
      <div style={{ marginTop: '10px', fontWeight: 600 }}>Total: {formatMoney(linesTotal(lines))}</div>
    </div>
  );
};

export const LabTestsEditor: React.FC<{
  lines: TestDraft[];
  onChange: (l: TestDraft[]) => void;
  kinds: string[];
  disabled?: boolean;
}> = ({ lines, onChange, kinds, disabled }) => {
  const set = (i: number, patch: Partial<TestDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <label style={{ fontWeight: 600 }}>Tests &amp; packages</label>
      <p className="muted small-text" style={{ margin: '2px 0 8px' }}>Type each test or package and its price.</p>
      {lines.length === 0 && <div className="muted small-text" style={{ marginBottom: '8px' }}>No tests yet. Add them before completing the sale.</div>}
      {lines.map((l, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <input aria-label={`Test ${i + 1}`} placeholder="e.g. CBC, MRI Brain, Full body package" value={l.name} disabled={disabled}
            onChange={(e) => set(i, { name: e.target.value })} />
          <select aria-label={`Type of test ${i + 1}`} value={l.kind} disabled={disabled} onChange={(e) => set(i, { kind: e.target.value as TestDraft['kind'] })}>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input aria-label={`Price of test ${i + 1}`} type="number" min="0" step="0.01" placeholder="₹ price" value={l.price} disabled={disabled}
            onChange={(e) => set(i, { price: e.target.value })} />
          <button type="button" className="secondary" disabled={disabled} aria-label={`Remove test ${i + 1}`}
            onClick={() => onChange(lines.filter((_, j) => j !== i))} style={{ padding: '6px 10px' }}>✕</button>
        </div>
      ))}
      {!disabled && (
        <button type="button" className="secondary" onClick={() => onChange([...lines, { name: '', kind: 'Lab', price: '' }])} style={{ marginTop: '6px' }}>+ Add test</button>
      )}
      <div style={{ marginTop: '10px', fontWeight: 600 }}>Total: {formatMoney(linesTotal(lines))}</div>
    </div>
  );
};

export interface LabTracking {
  homeCollection: boolean;
  collectionDate: string;
  appointmentDate: string;
  reportDeliveredOn: string;
  reportDeliveredVia: string;
}

// Optional; agents can keep this up to date after the sale (reports come later).
export const LabTrackingFields: React.FC<{ value: LabTracking; onChange: (v: LabTracking) => void; via: string[] }> = ({ value, onChange, via }) => {
  const set = (patch: Partial<LabTracking>) => onChange({ ...value, ...patch });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '14px' }}>
      <div>
        <label htmlFor="lab-home">Home sample collection</label>
        <select id="lab-home" value={value.homeCollection ? 'yes' : 'no'} onChange={(e) => set({ homeCollection: e.target.value === 'yes' })}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </div>
      {value.homeCollection && (
        <div>
          <label htmlFor="lab-collection">Collection date</label>
          <input id="lab-collection" type="date" value={value.collectionDate} onChange={(e) => set({ collectionDate: e.target.value })} />
        </div>
      )}
      <div>
        <label htmlFor="lab-appointment">Appointment date</label>
        <input id="lab-appointment" type="date" value={value.appointmentDate} onChange={(e) => set({ appointmentDate: e.target.value })} />
      </div>
      <div>
        <label htmlFor="lab-report-on">Report delivered on</label>
        <input id="lab-report-on" type="date" value={value.reportDeliveredOn} onChange={(e) => set({ reportDeliveredOn: e.target.value })} />
      </div>
      <div>
        <label htmlFor="lab-report-via">Report delivered by</label>
        <select id="lab-report-via" value={value.reportDeliveredVia} onChange={(e) => set({ reportDeliveredVia: e.target.value })}>
          <option value="">—</option>
          {via.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    </div>
  );
};
