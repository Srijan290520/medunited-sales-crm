import React from 'react';

// Grey rows shaped like the list, shown until the first answer arrives, so
// the page looks alive instead of blank.
export const PlaceholderRows: React.FC<{ label: string; rows?: number }> = ({ label, rows = 6 }) => (
  <div className="ph-rows" role="status" aria-live="polite">
    <span className="sr-only">{label}…</span>
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="ph-row" aria-hidden="true">
        <span className="ph-block ph-who">
          <span className="ph-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          <span className="ph-line ph-small" style={{ width: `${35 + ((i * 11) % 25)}%` }} />
        </span>
        <span className="ph-block ph-pill" />
        <span className="ph-block ph-pill" />
        <span className="ph-block ph-amount" />
      </div>
    ))}
  </div>
);

// A thin bar above a list that's showing the last copy while the fresh one loads.
export const UpdatingBar: React.FC = () => (
  <div className="ph-updating" role="status" aria-live="polite">
    <span className="ph-updating-track" aria-hidden="true"><span /></span>
    Updating…
  </div>
);
