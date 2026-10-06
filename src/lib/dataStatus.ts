/**
 * Test vs deployed data.
 *
 * Every submission carries `data_status`: whether its survey was in testing or
 * deployed when the server FIRST received the record. It is stamped by a
 * database trigger (migration 20261006090000_submission_data_status.sql), not
 * by the device -- a phone never learns a survey's status, because a survey
 * moves test -> deployed in place with no re-download. A resync never changes
 * it; only the owner-only, audited `reclassify_submissions` RPC does.
 *
 * The data browser and every export filter on it. The default is deployed
 * data, so test records never reach an analysis unless someone asks for them.
 */

export type DataStatus = 'test' | 'deployed';
export type DataStatusFilter = DataStatus | 'all';

export const DATA_STATUS_FILTERS: readonly DataStatusFilter[] = ['deployed', 'test', 'all'];
export const DEFAULT_DATA_STATUS_FILTER: DataStatusFilter = 'deployed';

export const DATA_STATUS_FILTER_LABELS: Record<DataStatusFilter, string> = {
  deployed: 'Deployed',
  test: 'Test',
  all: 'All',
};

/** The filter named by a URL search param, falling back to the default. */
export function parseDataStatusFilter(value: string | null | undefined): DataStatusFilter {
  return DATA_STATUS_FILTERS.includes(value as DataStatusFilter)
    ? (value as DataStatusFilter)
    : DEFAULT_DATA_STATUS_FILTER;
}

/** Per-status record counts; `all` is always the sum, never a third query. */
export interface DataStatusCounts {
  test: number;
  deployed: number;
}

export function countFor(counts: DataStatusCounts, filter: DataStatusFilter): number {
  return filter === 'all' ? counts.test + counts.deployed : counts[filter];
}

/**
 * Narrows a submissions query to one status, or leaves it alone for `all`.
 *
 * Takes the builder as an unconstrained `Q` and narrows inside: constraining
 * `Q` to "has an `eq` returning `Q`" makes TypeScript unify that against
 * PostgrestFilterBuilder's own generic `eq`, which fails with "type
 * instantiation is excessively deep". Every Supabase filter builder has `eq`.
 */
export function withDataStatus<Q>(query: Q, filter: DataStatusFilter): Q {
  if (filter === 'all') return query;
  return (query as unknown as { eq(column: string, value: string): Q }).eq('data_status', filter);
}

/**
 * Appended to an export's file name, so a downloaded file says what it holds.
 * Deployed data, the default, keeps the name it always had.
 */
export function exportFileSuffix(filter: DataStatusFilter): string {
  return filter === 'deployed' ? '' : `_${filter}`;
}

/** Recorded in the export manifest scope and the audit trail. */
export function exportScopeLabel(filter: DataStatusFilter): string {
  return filter === 'all' ? 'test and deployed data' : `${filter} data only`;
}
