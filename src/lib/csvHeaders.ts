/**
 * Parses just the header row of a CSV file's text content -- enough to
 * populate a column picker, not a general CSV parser. Handles quoted
 * fields (including an embedded comma or an escaped `""`) since a real
 * uploaded file is more likely to have one than not.
 */
export function parseCsvHeaderRow(content: string): string[] {
  const firstLine = content.split(/\r\n|\r|\n/, 1)[0] ?? '';
  if (!firstLine.trim()) return [];

  const headers: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    if (inQuotes) {
      if (char === '"') {
        if (firstLine[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      headers.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  headers.push(field.trim());

  return headers.filter((h) => h.length > 0);
}
