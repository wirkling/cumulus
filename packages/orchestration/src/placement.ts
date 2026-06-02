/**
 * Locality-aware soft placement (spec §4.5).
 *
 * Hard filters first (pass/fail), then SCORE the survivors — lowest score wins.
 * Locality is a soft preference, NEVER a hard filter: a Dresden-origin request
 * must still be servable by Potsdam if the Dresden node is busy/down. That is
 * the whole "one virtual pool" premise.
 *
 * Pure functions only — no DB, no Hetzner, no I/O. The caller assembles
 * candidates from whatever store it uses.
 */
import type {
  GeoPoint,
  NodeStatus,
  PlacementWeights,
  WorkloadType,
} from '@cumulus/shared-types';
import { WORKLOADS } from '@cumulus/shared-types';
import { haversineKm } from './geo.js';

export interface PlacementCandidate {
  nodeId: string;
  status: NodeStatus;
  /** True if the node is draining/maintenance/disabled (excluded by hard filter). */
  unavailable: boolean;
  location?: GeoPoint;
  capabilities: Record<string, unknown>;
  /** Number of jobs currently queued/running on this node. */
  queueLength: number;
  /** Recent benchmark score for this workload type (higher = better), or undefined. */
  benchmarkScore?: number;
  /** Estimated cost to run on this node (relative units), or undefined. */
  costEstimate?: number;
}

export interface PlacementContext {
  workloadType: WorkloadType;
  origin?: GeoPoint;
  requiredCapabilities: Record<string, unknown>;
  /** Override the per-workload default weights (rare; mostly for tests/tuning). */
  weights?: PlacementWeights;
}

export interface PlacementResult {
  nodeId: string;
  score: number;
  distanceKm?: number;
}

/** A candidate satisfies the workload's required capabilities (hard filter 1). */
export function nodeMatchesRequiredCapabilities(
  candidate: PlacementCandidate,
  required: Record<string, unknown>,
): boolean {
  for (const [key, want] of Object.entries(required)) {
    // Special case: `executor` requires membership in the node's executors[].
    if (key === 'executor') {
      const executors = candidate.capabilities.executors;
      if (!Array.isArray(executors) || !executors.includes(want)) return false;
      continue;
    }
    const have = candidate.capabilities[key];
    if (typeof want === 'boolean') {
      if (have !== true) return false;
    } else if (typeof want === 'number') {
      if (typeof have !== 'number' || have < want) return false;
    } else if (have !== want) {
      return false;
    }
  }
  return true;
}

function passesHardFilters(
  candidate: PlacementCandidate,
  required: Record<string, unknown>,
): boolean {
  if (candidate.status !== 'online') return false;
  if (candidate.unavailable) return false;
  return nodeMatchesRequiredCapabilities(candidate, required);
}

/**
 * Normalize a raw value into 0..1 against the spread of the candidate set, so
 * the weighted terms are comparable. Returns 0 when there is no spread.
 */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return (value - min) / (max - min);
}

/**
 * Score and rank eligible nodes. Lowest score wins. Returns [] if none are
 * eligible (caller should queue/retry). Deterministic — ties broken by nodeId.
 */
export function scoreNodes(
  candidates: PlacementCandidate[],
  ctx: PlacementContext,
): PlacementResult[] {
  const eligible = candidates.filter((c) =>
    passesHardFilters(c, ctx.requiredCapabilities),
  );
  if (eligible.length === 0) return [];

  const weights = ctx.weights ?? WORKLOADS[ctx.workloadType].placementWeights;

  // Precompute per-term ranges across the eligible set for normalization.
  const distances = new Map<string, number>();
  if (ctx.origin) {
    for (const c of eligible) {
      if (c.location) distances.set(c.nodeId, haversineKm(c.location, ctx.origin));
    }
  }
  const distVals = [...distances.values()];
  const distMin = distVals.length ? Math.min(...distVals) : 0;
  const distMax = distVals.length ? Math.max(...distVals) : 0;

  const queues = eligible.map((c) => c.queueLength);
  const queueMin = Math.min(...queues);
  const queueMax = Math.max(...queues);

  const benches = eligible
    .map((c) => c.benchmarkScore)
    .filter((s): s is number => typeof s === 'number');
  const benchMin = benches.length ? Math.min(...benches) : 0;
  const benchMax = benches.length ? Math.max(...benches) : 0;

  const costs = eligible
    .map((c) => c.costEstimate)
    .filter((s): s is number => typeof s === 'number');
  const costMin = costs.length ? Math.min(...costs) : 0;
  const costMax = costs.length ? Math.max(...costs) : 0;

  const results: PlacementResult[] = eligible.map((c) => {
    // Distance term — only when both origin and node location exist (spec §4.5).
    const distanceKm = distances.get(c.nodeId);
    const distTerm =
      ctx.origin && distanceKm !== undefined
        ? weights.distance * normalize(distanceKm, distMin, distMax)
        : 0;

    const queueTerm = weights.queue * normalize(c.queueLength, queueMin, queueMax);

    // Higher benchmark is better, so invert the normalized score.
    const benchTerm =
      typeof c.benchmarkScore === 'number'
        ? weights.benchmark * (1 - normalize(c.benchmarkScore, benchMin, benchMax))
        : 0;

    const costTerm =
      typeof c.costEstimate === 'number'
        ? weights.cost * normalize(c.costEstimate, costMin, costMax)
        : 0;

    return {
      nodeId: c.nodeId,
      score: distTerm + queueTerm + benchTerm + costTerm,
      distanceKm,
    };
  });

  results.sort((a, b) => a.score - b.score || a.nodeId.localeCompare(b.nodeId));
  return results;
}

/** Convenience: the single best node, or null when nothing is eligible. */
export function selectNode(
  candidates: PlacementCandidate[],
  ctx: PlacementContext,
): PlacementResult | null {
  const ranked = scoreNodes(candidates, ctx);
  return ranked[0] ?? null;
}
