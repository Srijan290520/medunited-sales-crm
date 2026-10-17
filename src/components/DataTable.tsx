import React, { useMemo, useState } from 'react';

// Shared pieces for the list tables (module pages, Patients): sortable
// column headers and sorting that keeps the server's order until someone
// picks a column. Styles: .dt-* in styles.css.

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number;
export interface SortState {
  key: string;
  dir: SortDir;
}

// Sorts by the chosen column; empty values always go last. Equal values keep
// their original order. No column chosen = the order the rows came in.
export function useTableSort<T>(rows: T[], getters: Record<string, (row: T) => SortValue>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const sorted = useMemo(() => {
    if (!sort || !getters[sort.key]) return rows;
    const get = getters[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i, v: get(row) }))
      .sort((a, b) => {
        const ea = a.v === '' || a.v === null || a.v === undefined;
        const eb = b.v === '' || b.v === null || b.v === undefined;
        if (ea !== eb) return ea ? 1 : -1;
        if (!ea && a.v !== b.v) {
          const c = typeof a.v === 'number' && typeof b.v === 'number'
            ? a.v - b.v
            : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
          if (c) return c * sign;
        }
        return a.i - b.i;
      })
      .map((x) => x.row);
    // getters are rebuilt each render; the sort only needs to follow rows and the choice
  }, [rows, sort]);
  // Click: ascending, then descending, then back to the default order.
  const toggle = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  return { sorted, sort, toggle };
}

// A column header. With sortKey it's a button that sorts by that column.
export const Th: React.FC<{
  label: string;
  sortKey?: string;
  sort?: SortState | null;
  onSort?: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
}> = ({ label, sortKey, sort, onSort, className, align }) => {
  const active = !!sortKey && sort?.key === sortKey;
  const cls = [className, align === 'right' ? 'dt-right' : ''].filter(Boolean).join(' ') || undefined;
  if (!sortKey || !onSort) {
    return (
      <th scope="col" className={cls}>
        {label}
      </th>
    );
  }
  return (
    <th scope="col" className={cls} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`dt-sort${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="dt-arrow" aria-hidden="true">
          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
};
