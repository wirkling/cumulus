/**
 * QA / Test Center + customer front-door types (Stage 1).
 *
 * The QA suite is versioned and each run snapshots the fleet, so results stay
 * comparable as the hardware evolves (CPU → virtual GPU → Mac mini → GPU racks).
 */
import type { WorkloadType, CompletionPolicy, MergeStrategy } from './domain.js';

// ─── Customers (the product front door) ──────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  keyPrefix: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

/** Returned exactly once at creation — the full key is never stored or shown again. */
export interface CustomerWithKey extends Customer {
  apiKey: string;
}

// ─── QA suite definition ─────────────────────────────────────────────────────

export type QaScenarioKind = 'latency' | 'load' | 'overflow';

/**
 * One scenario in the suite. In Stage 1, `workloadType` maps a use-case slot to
 * an existing mock workload; in Stage 2 these become embeddings/ocr/etc.
 */
export interface QaScenario {
  key: string;
  useCase: string;
  kind: QaScenarioKind;
  workloadType: WorkloadType;
  /** How many requests this scenario submits. */
  requestCount: number;
  /** Fan-out per request. */
  fanOut: number;
  completionPolicy: CompletionPolicy;
  mergeStrategy: MergeStrategy;
  timeoutSeconds: number;
  /** Workload input template (e.g. item count, sleep ms). */
  input: Record<string, unknown>;
  /** Optional origin for locality-sensitive scenarios. */
  origin?: { lat: number; lng: number; label?: string };
  description: string;
}

export interface QaSuite {
  version: string;
  scenarios: QaScenario[];
}

// ─── QA run + results ────────────────────────────────────────────────────────

export type QaRunStatus = 'running' | 'completed' | 'failed';

export interface FleetSnapshotNode {
  nodeId: string;
  name: string;
  nodeType: string;
  city?: string;
  cpuBenchmark?: number;
}

/** A real merged output from one request in the scenario — shown in the unfold
 * so the test user sees actual work product come back, not just metrics. */
export interface QaSampleResult {
  requestId: string;
  status: string;
  mergedResult: unknown;
}

export interface QaResultMetrics {
  /** Per-node job distribution for this scenario (the pooling proof). */
  perNodeJobs?: Record<string, number>;
  wallClockMs?: number;
  /** Fraction of work that ran off the single nearest/primary node. */
  overflowRatio?: number;
  /** A few real merged outputs, for the "unfold to JSON" view. */
  sampleResults?: QaSampleResult[];
  [key: string]: unknown;
}

export interface QaResult {
  id: string;
  runId: string;
  scenarioKey: string;
  useCase: string;
  requestCount: number;
  succeeded: number;
  failed: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyMaxMs?: number;
  throughputPerSec?: number;
  metrics: QaResultMetrics;
  createdAt: string;
}

export interface QaRunSummary {
  scenarios: number;
  totalRequests: number;
  totalSucceeded: number;
  totalFailed: number;
  overallLatencyP95Ms?: number;
}

export interface QaRun {
  id: string;
  suiteVersion: string;
  envLabel: string;
  status: QaRunStatus;
  /** The customer who owns/ran this QA run (the test user). */
  customerId?: string;
  fleetSnapshot: FleetSnapshotNode[];
  summary?: QaRunSummary;
  startedAt: string;
  finishedAt?: string;
}

export interface QaRunDetail extends QaRun {
  results: QaResult[];
}

// ─── API DTOs ────────────────────────────────────────────────────────────────

export interface CreateCustomerBody {
  name: string;
}

export interface LaunchQaRunBody {
  envLabel: string;
  /** Optional: restrict to specific scenario keys; default = whole suite. */
  scenarioKeys?: string[];
}

const DRESDEN = { lat: 51.0504, lng: 13.7373, label: 'Dresden' };

/**
 * QA suite v1. Stage 1 maps each use-case slot to an existing mock workload;
 * Stage 2 swaps in real models (embeddings/ocr/transcription/llm) while keeping
 * the same scenario shapes, so runs stay comparable across the change. Keep
 * counts modest so a run finishes in minutes on a small CPU fleet.
 *
 * For split_map_merge, `input.itemCount` is expanded into an items array by the
 * orchestrator (so the suite stays small).
 */
export const QA_SUITE_V1: QaSuite = {
  version: 'qa-v1',
  scenarios: [
    {
      key: 'routing_latency',
      useCase: 'routing-latency',
      kind: 'latency',
      workloadType: 'echo_sleep',
      requestCount: 20,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 30,
      input: { ms: 200 },
      description: 'Baseline submit→route→execute→return latency (200ms work).',
    },
    {
      key: 'cpu_compute',
      useCase: 'cpu-compute',
      kind: 'latency',
      workloadType: 'cpu_benchmark',
      requestCount: 12,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'single',
      timeoutSeconds: 60,
      input: { iterations: 5_000_000 },
      description: 'Per-node CPU compute latency (proxy for model inference).',
    },
    {
      key: 'scatter_gather',
      useCase: 'scatter-gather',
      kind: 'latency',
      workloadType: 'split_map_merge',
      requestCount: 10,
      fanOut: 3,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'ordered_array',
      timeoutSeconds: 60,
      input: { itemCount: 60 },
      origin: DRESDEN,
      description: 'Locality-aware split→map→merge latency (proxy for batch jobs).',
    },
    {
      key: 'throughput_burst',
      useCase: 'throughput',
      kind: 'load',
      workloadType: 'echo_sleep',
      requestCount: 100,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 120,
      input: { ms: 300 },
      description: 'Burst of 100 requests — aggregate throughput + per-node distribution.',
    },
    {
      key: 'overflow',
      useCase: 'overflow',
      kind: 'overflow',
      workloadType: 'split_map_merge',
      requestCount: 30,
      fanOut: 4,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'ordered_array',
      timeoutSeconds: 120,
      input: { itemCount: 40 },
      origin: DRESDEN,
      description:
        'Saturating Dresden-origin load — measures how much work overflows the nearest node onto the wider pool.',
    },
  ],
};
