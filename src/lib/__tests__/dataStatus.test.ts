import { describe, expect, it } from 'vitest';
import {
  countFor,
  exportFileSuffix,
  exportScopeLabel,
  parseDataStatusFilter,
  withDataStatus,
  type DataStatusFilter,
} from '@/lib/dataStatus';

describe('parseDataStatusFilter', () => {
  it('reads each known filter', () => {
    expect(parseDataStatusFilter('deployed')).toBe('deployed');
    expect(parseDataStatusFilter('test')).toBe('test');
    expect(parseDataStatusFilter('all')).toBe('all');
  });

  it('defaults to deployed, so test data is never shown without asking for it', () => {
    expect(parseDataStatusFilter(null)).toBe('deployed');
    expect(parseDataStatusFilter(undefined)).toBe('deployed');
    expect(parseDataStatusFilter('')).toBe('deployed');
    expect(parseDataStatusFilter('TEST')).toBe('deployed');
  });
});

describe('countFor', () => {
  const counts = { test: 4, deployed: 10 };

  it('picks one status, or sums both for all', () => {
    expect(countFor(counts, 'test')).toBe(4);
    expect(countFor(counts, 'deployed')).toBe(10);
    expect(countFor(counts, 'all')).toBe(14);
  });
});

describe('withDataStatus', () => {
  class FakeQuery {
    filters: [string, string][] = [];
    eq(column: string, value: string): FakeQuery {
      this.filters.push([column, value]);
      return this;
    }
  }

  it.each<[DataStatusFilter, [string, string][]]>([
    ['test', [['data_status', 'test']]],
    ['deployed', [['data_status', 'deployed']]],
    ['all', []],
  ])('%s', (filter, expected) => {
    expect(withDataStatus(new FakeQuery(), filter).filters).toEqual(expected);
  });
});

describe('export naming', () => {
  it('keeps the existing file name for deployed data and marks the others', () => {
    expect(exportFileSuffix('deployed')).toBe('');
    expect(exportFileSuffix('test')).toBe('_test');
    expect(exportFileSuffix('all')).toBe('_all');
  });

  it('says in the scope which data an export holds', () => {
    expect(exportScopeLabel('deployed')).toBe('deployed data only');
    expect(exportScopeLabel('test')).toBe('test data only');
    expect(exportScopeLabel('all')).toBe('test and deployed data');
  });
});
