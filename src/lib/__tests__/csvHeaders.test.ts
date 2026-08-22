import { describe, it, expect } from 'vitest';
import { parseCsvHeaderRow } from '../csvHeaders';

describe('parseCsvHeaderRow', () => {
  it('splits a plain comma-separated header row', () => {
    expect(parseCsvHeaderRow('id,name,region')).toEqual(['id', 'name', 'region']);
  });

  it('reads only the first line -- data rows must not leak into the header', () => {
    expect(parseCsvHeaderRow('id,name\n1,Alice\n2,Bob')).toEqual(['id', 'name']);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsvHeaderRow('id,name\r\n1,Alice')).toEqual(['id', 'name']);
  });

  it('keeps a comma inside a quoted header intact', () => {
    // The real authoring mistake this guards: a column named e.g.
    // "City, State" would otherwise split into two bogus columns.
    expect(parseCsvHeaderRow('id,"City, State",region')).toEqual(['id', 'City, State', 'region']);
  });

  it('unescapes a doubled quote inside a quoted header', () => {
    expect(parseCsvHeaderRow('id,"the ""best"" name"')).toEqual(['id', 'the "best" name']);
  });

  it('trims surrounding whitespace on unquoted headers', () => {
    expect(parseCsvHeaderRow('id, name , region')).toEqual(['id', 'name', 'region']);
  });

  it('drops empty trailing columns from a trailing comma', () => {
    expect(parseCsvHeaderRow('id,name,')).toEqual(['id', 'name']);
  });

  it('returns an empty list for an empty or whitespace-only file', () => {
    expect(parseCsvHeaderRow('')).toEqual([]);
    expect(parseCsvHeaderRow('   \n1,2,3')).toEqual([]);
  });

  it('returns a single header for a file with no commas', () => {
    expect(parseCsvHeaderRow('id')).toEqual(['id']);
  });
});
