/**
 * One CSV line as trimmed cells. Handles quoted fields (including an
 * embedded comma or an escaped `""`) since a real uploaded file is more
 * likely to have one than not. Not a general CSV parser: a newline inside a
 * quoted field is not supported, and the app's own reader does not support
 * it either.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
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
      cells.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  cells.push(field.trim());
  return cells;
}

/** A leading byte-order mark, which Excel writes and the app's reader trims. */
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Parses just the header row of a CSV file's text content -- enough to
 * populate a column picker.
 */
export function parseCsvHeaderRow(content: string): string[] {
  const firstLine = stripBom(content).split(/\r\n|\r|\n/, 1)[0] ?? '';
  if (!firstLine.trim()) return [];
  return parseCsvLine(firstLine).filter((h) => h.length > 0);
}

/**
 * Every distinct non-empty value in one column of a CSV file's text content
 * -- what a csv-backed response list can actually offer, for checking a
 * skip or logic value against. Values are kept as written: codes are often
 * zero-padded and the app compares them numerically where both sides parse.
 */
export function parseCsvColumnValues(content: string, column: string): Set<string> {
  const lines = stripBom(content).split(/\r\n|\r|\n/);
  const header = lines.length ? parseCsvLine(lines[0]) : [];
  const index = header.indexOf(column);
  const values = new Set<string>();
  if (index < 0) return values;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cell = parseCsvLine(lines[i])[index] ?? '';
    if (cell) values.add(cell);
  }
  return values;
}
