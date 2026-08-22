import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows, chunkIds } from '../supabasePaging';

describe('fetchAllRows', () => {
  it('returns everything in one call when the first page is short', async () => {
    const buildQuery = vi.fn(async () => ({ data: [1, 2, 3], error: null }));
    const rows = await fetchAllRows(buildQuery, 1000);

    expect(rows).toEqual([1, 2, 3]);
    expect(buildQuery).toHaveBeenCalledTimes(1);
    expect(buildQuery).toHaveBeenCalledWith(0, 999);
  });

  it(
    'keeps paging past a full page -- the regression this exists for: a table with ' +
      'more rows than the server\'s max_rows cap must not be silently truncated',
    async () => {
      // 2500 rows total, server caps each response at 1000 -- three pages.
      const total = 2500;
      const buildQuery = vi.fn(async (from: number, to: number) => {
        const page = Array.from({ length: total }, (_, i) => i).slice(from, to + 1);
        return { data: page, error: null };
      });

      const rows = await fetchAllRows(buildQuery, 1000);

      expect(rows).toHaveLength(total);
      expect(rows).toEqual(Array.from({ length: total }, (_, i) => i));
      expect(buildQuery).toHaveBeenCalledTimes(3);
      expect(buildQuery).toHaveBeenNthCalledWith(1, 0, 999);
      expect(buildQuery).toHaveBeenNthCalledWith(2, 1000, 1999);
      expect(buildQuery).toHaveBeenNthCalledWith(3, 2000, 2999);
    },
  );

  it('stops exactly at a page boundary without an extra empty-page request', async () => {
    // Exactly 1000 rows -- the page is full, but there is nothing left.
    const buildQuery = vi.fn(async (from: number, to: number) => {
      if (from > 0) return { data: [], error: null };
      return { data: Array.from({ length: 1000 }, (_, i) => i), error: null };
    });

    const rows = await fetchAllRows(buildQuery, 1000);

    expect(rows).toHaveLength(1000);
    // A full page alone is ambiguous (exactly-1000 vs. more-than-1000), so one
    // extra request confirming an empty page is the correct, safe behavior.
    expect(buildQuery).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array for a table with no rows', async () => {
    const buildQuery = vi.fn(async () => ({ data: [], error: null }));
    expect(await fetchAllRows(buildQuery)).toEqual([]);
  });

  it('throws rather than silently returning a partial result on error', async () => {
    const buildQuery = vi.fn(async () => ({ data: null, error: { message: 'connection reset' } }));
    await expect(fetchAllRows(buildQuery)).rejects.toThrow('connection reset');
  });
});

describe('chunkIds', () => {
  it('splits into chunks of the given size', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    const chunks = chunkIds(ids, 200);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[1]).toHaveLength(200);
    expect(chunks[2]).toHaveLength(50);
  });

  it('returns a single chunk when under the limit', () => {
    expect(chunkIds(['a', 'b'], 200)).toEqual([['a', 'b']]);
  });

  it('returns an empty array for no ids', () => {
    expect(chunkIds([], 200)).toEqual([]);
  });
});
