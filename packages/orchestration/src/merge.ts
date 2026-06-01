/**
 * Merge strategies (spec §5). Combine successful child-job results into the
 * single result returned to the caller. Pure functions.
 */
import type { MergeStrategy } from '@cumulus/shared-types';

export interface ShardResult {
  shardIndex: number;
  result: unknown;
}

/**
 * Merge shard results according to the strategy. Inputs may arrive out of
 * order and may be partial (quorum / return_partial) — strategies that care
 * about order sort by shardIndex first.
 */
export function mergeResults(
  strategy: MergeStrategy,
  shards: ShardResult[],
): unknown {
  const sorted = [...shards].sort((a, b) => a.shardIndex - b.shardIndex);

  switch (strategy) {
    case 'ordered_array':
      // Flatten array-results in shard order into one ordered array.
      return sorted.flatMap((s) =>
        Array.isArray(s.result) ? (s.result as unknown[]) : [s.result],
      );

    case 'concat': {
      // String concatenation in shard order; falls back to JSON for non-strings.
      return sorted
        .map((s) => (typeof s.result === 'string' ? s.result : JSON.stringify(s.result)))
        .join('');
    }

    case 'sum': {
      return sorted.reduce((acc, s) => acc + (Number(s.result) || 0), 0);
    }

    case 'collect':
      // Keep each shard's result keyed by index — no assumptions about shape.
      return sorted.map((s) => ({ shardIndex: s.shardIndex, result: s.result }));

    case 'single':
      // Single-shard workloads: return the one result verbatim.
      return sorted[0]?.result ?? null;

    default:
      return sorted.map((s) => s.result);
  }
}
