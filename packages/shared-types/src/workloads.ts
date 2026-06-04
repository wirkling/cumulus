/**
 * Workload definitions and per-workload placement weights.
 *
 * In v1 the 3 mock workloads are hardcoded (spec §5 defers the `workloads`
 * table). Placement weights live HERE as config — never as constants scattered
 * through the scorer (spec §4.5). Batch workloads set w_distance ≈ 0; a future
 * latency-sensitive class would set it high.
 */
import type { WorkloadType, MergeStrategy } from './domain.js';

export interface PlacementWeights {
  /** Locality: prefer nodes near the request origin. Soft, never a hard filter. */
  distance: number;
  /** Prefer nodes with shorter queues (load balancing). */
  queue: number;
  /** Prefer nodes with better recent benchmark scores for this workload. */
  benchmark: number;
  /** Prefer cheaper nodes (estimated). */
  cost: number;
}

export interface WorkloadDefinition {
  type: WorkloadType;
  /** Hard-filter requirements a node must satisfy to be eligible at all. */
  requiredCapabilities: Record<string, unknown>;
  /** Default merge strategy if the caller doesn't override. */
  defaultMergeStrategy: MergeStrategy;
  /** Whether this workload meaningfully fans out (split_map_merge does). */
  fanOutable: boolean;
  placementWeights: PlacementWeights;
  /** Default per-request timeout if the caller doesn't override. */
  defaultTimeoutSeconds: number;
}

export const WORKLOADS: Record<WorkloadType, WorkloadDefinition> = {
  echo_sleep: {
    type: 'echo_sleep',
    requiredCapabilities: {},
    defaultMergeStrategy: 'collect',
    fanOutable: true,
    // Batch/relaxed — route on availability/cost, locality barely matters.
    placementWeights: { distance: 0.1, queue: 0.5, benchmark: 0.1, cost: 0.3 },
    defaultTimeoutSeconds: 60,
  },
  cpu_benchmark: {
    type: 'cpu_benchmark',
    requiredCapabilities: {},
    defaultMergeStrategy: 'collect',
    fanOutable: false,
    placementWeights: { distance: 0.0, queue: 0.4, benchmark: 0.4, cost: 0.2 },
    defaultTimeoutSeconds: 120,
  },
  split_map_merge: {
    type: 'split_map_merge',
    requiredCapabilities: {},
    defaultMergeStrategy: 'ordered_array',
    fanOutable: true,
    // The locality demo: nearer nodes are preferred but the request is still
    // servable by a far node when the near one is busy/down.
    placementWeights: { distance: 0.5, queue: 0.3, benchmark: 0.1, cost: 0.1 },
    defaultTimeoutSeconds: 120,
  },

  // ── Real model workloads (Stage 2). Gated on the node having the executor. ──
  embeddings: {
    type: 'embeddings',
    requiredCapabilities: { executor: 'embeddings' },
    defaultMergeStrategy: 'collect',
    fanOutable: true, // split the text batch across shards
    placementWeights: { distance: 0.1, queue: 0.5, benchmark: 0.3, cost: 0.1 },
    defaultTimeoutSeconds: 120,
  },
  ocr: {
    type: 'ocr',
    requiredCapabilities: { executor: 'ocr' },
    defaultMergeStrategy: 'collect',
    fanOutable: false,
    placementWeights: { distance: 0.1, queue: 0.5, benchmark: 0.3, cost: 0.1 },
    defaultTimeoutSeconds: 120,
  },
  transcription: {
    type: 'transcription',
    requiredCapabilities: { executor: 'transcription' },
    defaultMergeStrategy: 'collect',
    fanOutable: false,
    // Heavy on CPU — favour the best-benchmarking node.
    placementWeights: { distance: 0.05, queue: 0.35, benchmark: 0.5, cost: 0.1 },
    defaultTimeoutSeconds: 300,
  },
  llm_generate: {
    type: 'llm_generate',
    requiredCapabilities: { executor: 'llm' },
    defaultMergeStrategy: 'collect',
    fanOutable: false,
    placementWeights: { distance: 0.05, queue: 0.35, benchmark: 0.5, cost: 0.1 },
    defaultTimeoutSeconds: 300,
  },
  // GPU tier — gated to nodes advertising the `gpu` executor; runs a bigger
  // model at interactive speed. On a CPU-only fleet this is skipped.
  gpu_llm: {
    type: 'gpu_llm',
    requiredCapabilities: { executor: 'gpu' },
    defaultMergeStrategy: 'collect',
    fanOutable: false,
    placementWeights: { distance: 0.0, queue: 0.3, benchmark: 0.6, cost: 0.1 },
    defaultTimeoutSeconds: 300,
  },
};

/** A few preset German origins for the dashboard's submit form (spec §8). */
export const PRESET_ORIGINS: { label: string; lat: number; lng: number }[] = [
  { label: 'Dresden', lat: 51.0504, lng: 13.7373 },
  { label: 'Potsdam', lat: 52.3906, lng: 13.0645 },
  { label: 'Berlin', lat: 52.52, lng: 13.405 },
  { label: 'Leipzig', lat: 51.3397, lng: 12.3731 },
];
