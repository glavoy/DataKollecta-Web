import { describe, it, expect } from 'vitest';
import { csvCell, buildCsv } from '../csv';

describe('csvCell', () => {
  it('passes a plain value through unquoted', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(42)).toBe('42');
  });

  it('treats null and undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles an embedded quote', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value containing a bare \\r as well as \\n', () => {
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('stringifies a non-scalar as JSON rather than "[object Object]"', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"'); // the comma inside the JSON forces quoting
    expect(csvCell([1, 2])).toBe('"[1,2]"');
  });
});

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM', () => {
    const csv = buildCsv(['a'], [['1']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('escapes header cells the same as data cells', () => {
    // Headers come from device-submitted field names, not a fixed schema --
    // a stray comma in one must not silently shift every column after it.
    const csv = buildCsv(['id', 'weird,field'], [['1', 'x']]);
    expect(csv).toBe('﻿id,"weird,field"\n1,x');
  });

  it('joins headers and rows with the right delimiters', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(csv).toBe('﻿a,b\n1,2\n3,4');
  });

  it('produces just the header row for no data', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('﻿a,b');
  });
});
