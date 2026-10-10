export type CsvRecord = Record<string, string | number | null | undefined>;

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(records: CsvRecord[]): string {
  if (records.length === 0) return "";
  const headers = Object.keys(records[0]);
  const rows = records.map((record) => headers.map((header) => escapeCsv(record[header])).join(","));
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}
