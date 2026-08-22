/**
 * Shared CSV serialization.
 *
 * `ProjectData.tsx` used to have two independent CSV writers -- one for
 * submissions, one for formchanges -- that had each grown the same set of
 * gaps: a lone `\r` (as opposed to `\r\n` or `\n`) was never escaped even
 * though it breaks a row exactly like an unescaped `\n` would; header cells
 * were written raw although they come from device-submitted field names,
 * not a fixed schema; a non-scalar value (a submission field that ended up
 * an object or array) stringified to the literal text `[object Object]`;
 * and there was no UTF-8 BOM, so Excel -- which sniffs BOM rather than
 * defaulting to UTF-8 -- silently mangles accented characters. This project
 * has French-language content, so that last one is not hypothetical.
 */

const NEEDS_QUOTING = /[",\r\n]/;

/** One CSV cell, correctly escaped. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return NEEDS_QUOTING.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * A full CSV document: header row, data rows, each cell escaped, prefixed
 * with a UTF-8 BOM so Excel opens it as UTF-8 rather than the system
 * codepage.
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return '\uFEFF' + lines.join('\n');
}
