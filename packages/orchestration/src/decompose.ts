/**
 * Request → child jobs decomposition (spec §4.3).
 *
 * A request decomposes into 1..N jobs depending on fanOut and workload. Each
 * job is placed independently so shards can land on different nodes — that's
 * the point of scatter/gather.
 */
import type { Request, WorkloadType } from '@cumulus/shared-types';
import { WORKLOADS } from '@cumulus/shared-types';

export interface ShardSpec {
  shardIndex: number;
  input: Record<string, unknown>;
}

/**
 * Split an array into `parts` evenly-balanced contiguous chunks. Never produces
 * more chunks than items (no point splitting 4 items into 8 shards), and never
 * leaves wasteful trailing empties. Empty input yields a single empty shard.
 */
export function chunk<T>(items: T[], parts: number): T[][] {
  const p = Math.max(1, Math.floor(parts));
  if (items.length === 0) return [[]];
  const n = Math.min(p, items.length);
  const base = Math.floor(items.length / n);
  let rem = items.length % n;
  const out: T[][] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out;
}

export function decomposeRequest(req: Request): ShardSpec[] {
  const def = WORKLOADS[req.workloadType];
  const fanOut = Math.max(1, Math.floor(req.fanOut));

  // Non-fan-outable workloads always produce exactly one shard.
  if (!def.fanOutable) {
    return [{ shardIndex: 0, input: { ...req.input } }];
  }

  switch (req.workloadType) {
    case 'split_map_merge': {
      // Expect input.items: unknown[]; partition across shards.
      const items = Array.isArray(req.input.items) ? (req.input.items as unknown[]) : [];
      const chunks = chunk(items, fanOut);
      return chunks.map((items, shardIndex) => ({
        shardIndex,
        input: { ...req.input, items, _shardIndex: shardIndex },
      }));
    }
    case 'echo_sleep': {
      // Identical fan-out shards (each echoes + sleeps independently).
      return Array.from({ length: fanOut }, (_, shardIndex) => ({
        shardIndex,
        input: { ...req.input, _shardIndex: shardIndex },
      }));
    }
    default:
      return [{ shardIndex: 0, input: { ...req.input } }];
  }
}

/** Required capabilities for a workload (hard-filter input to placement). */
export function requiredCapabilitiesFor(
  workloadType: WorkloadType,
): Record<string, unknown> {
  return { ...WORKLOADS[workloadType].requiredCapabilities };
}
