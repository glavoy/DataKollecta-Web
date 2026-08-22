/**
 * Fetches every row of a query, not just the first page.
 *
 * PostgREST (and this project's Supabase config, `supabase/config.toml`'s
 * `api.max_rows`) caps any response at 1000 rows with no error and no
 * indication of truncation -- a `select()` with no `.range()` silently
 * returns only the first 1000 rows. On a research platform that means a
 * form card can read "5,000 records" (an uncapped `count: 'exact', head:
 * true` query) while its CSV export silently contains only the first 1000.
 *
 * `buildQuery` must construct a FRESH query each call and apply `.range()`
 * to it -- Supabase's query builder is not safely reusable across awaits,
 * and re-building from scratch is what lets each page carry its own
 * `.range(from, to)`.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < pageSize) break; // short page -- that was the last one
    from += pageSize;
  }

  return all;
}

/**
 * Splits an array of ids into chunks small enough for a `.in()` filter.
 *
 * A GET request's querystring has a practical length ceiling well under
 * what 1000 UUIDs need (~37KB) -- PostgREST/most proxies reject it as a 414
 * before the row cap above is even relevant. Used for `.in('record_uuid',
 * ids)`-style lookups following a paged fetch.
 */
export function chunkIds(ids: string[], chunkSize = 200): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}
