export type CsvValue = string | number | boolean | null | undefined;

function cleanText(value: string) {
  const withoutNulls = value.replaceAll('\u0000', '');
  const prefix = withoutNulls.match(/^(\s*)/u)?.[1] ?? '';
  const firstMeaningful = withoutNulls.slice(prefix.length);
  return /^[=+\-@\t\r]/u.test(firstMeaningful)
    ? `${prefix}'${firstMeaningful}`
    : withoutNulls;
}

/** RFC-4180 CSV encoding with spreadsheet formula neutralisation for text cells. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = cleanText(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly Record<string, CsvValue>[]): string {
  const lines = [
    headers.map((header) => csvCell(header)).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function textByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
