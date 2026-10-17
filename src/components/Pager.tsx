import React from 'react';

export const PAGE_SIZES = [25, 50, 100];

// "1–25 of 140 · ‹ Previous · Page 1 of 6 · Next ›", with a rows-per-page choice.
export const Pager: React.FC<{
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label: string; // what the rows are, for screen readers ("patients")
}> = ({ page, pageSize, total, onPage, onPageSize, label }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pg-bar" aria-label={`Pages of ${label}`}>
      <span className="pg-range" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <span className="pg-nav">
        <button type="button" className="pg-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          ‹ Previous
        </button>
        <span className="pg-of">
          Page {page} of {pages}
        </span>
        <button type="button" className="pg-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next ›
        </button>
      </span>
      <label className="pg-size">
        Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
};
