/**
 * Utility for exporting data to CSV with UTF-8 BOM for Microsoft Excel & Google Sheets compatibility.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (item: T) => string | number | boolean | null | undefined;
}

export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], data: T[]): void {
  const escapeCell = (val: any): string => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Stop spreadsheet formula injection: a customer name like =HYPERLINK(...)
    // would run as a formula when the file is opened in Excel / Sheets.
    if (typeof val === 'string' && /^[=+\-@\t\r]/.test(str)) str = "'" + str;
    // Escape quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const headerRow = columns.map((col) => escapeCell(col.header)).join(',');
  const dataRows = data.map((item) =>
    columns.map((col) => escapeCell(col.accessor(item))).join(',')
  );

  const csvContent = [headerRow, ...dataRows].join('\r\n');

  // Prefix with UTF-8 BOM so Excel recognises encoding and currency symbols
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
