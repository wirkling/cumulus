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
  /** Standardized quality metric for this scenario, e.g. 'WER' or 'accuracy'
   * (value 0..1). Present for transcription/LLM; absent for pure throughput. */
  qualityMetric?: string;
  qualityValue?: number;
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
 * QA suite v2 — real CPU model workloads (embeddings/OCR/transcription/LLM).
 * Same scenario *shapes* as v1 (latency / load / overflow) so the report stays
 * structurally comparable across the change. Counts kept modest because CPU
 * transcription/LLM are slow (that's the finding) and the first run also pays
 * one-time model downloads. `input.itemCount` is expanded into an items array
 * by the orchestrator for fan-out workloads (embeddings).
 */
export const QA_SUITE: QaSuite = {
  version: 'qa-v2',
  scenarios: [
    {
      key: 'embeddings_latency',
      useCase: 'embeddings',
      kind: 'latency',
      workloadType: 'embeddings',
      requestCount: 8,
      fanOut: 2,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 120,
      input: { itemCount: 64 },
      description: 'Sentence-embedding latency, batch split across shards (all-MiniLM).',
    },
    {
      key: 'throughput_burst',
      useCase: 'embeddings-batch',
      kind: 'load',
      workloadType: 'embeddings',
      requestCount: 30,
      fanOut: 2,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 180,
      input: { itemCount: 32 },
      description: 'Embedding burst — aggregate throughput + per-node distribution (economics anchor).',
    },
    {
      key: 'ocr_latency',
      useCase: 'ocr',
      kind: 'latency',
      workloadType: 'ocr',
      requestCount: 6,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 120,
      input: {},
      description: 'OCR throughput on a synthetic document (tesseract).',
    },
    {
      key: 'transcription_latency',
      useCase: 'transcription',
      kind: 'latency',
      workloadType: 'transcription',
      requestCount: 3,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 300,
      input: {},
      description: 'Speech-to-text real-time-factor on CPU (Whisper-tiny) — a likely CPU edge.',
    },
    {
      key: 'llm_latency',
      useCase: 'llm',
      kind: 'latency',
      workloadType: 'llm_generate',
      requestCount: 4,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 300,
      // MMLU multiple-choice → real accuracy metric (+ tokens/sec).
      input: { mmlu: true },
      description: 'Small-LLM on MMLU (Qwen2.5-0.5B): accuracy + tokens/sec on CPU — where we fall flat.',
    },
    {
      key: 'gpu_llm',
      useCase: 'llm-gpu',
      kind: 'latency',
      workloadType: 'gpu_llm',
      requestCount: 6,
      fanOut: 1,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 300,
      input: { mmlu: true },
      description: 'GPU-tier LLM on MMLU (bigger model, interactive) — runs only on GPU nodes; skipped on CPU-only fleets.',
    },
    {
      key: 'overflow',
      useCase: 'overflow',
      kind: 'overflow',
      workloadType: 'embeddings',
      requestCount: 18,
      fanOut: 3,
      completionPolicy: 'wait_for_all',
      mergeStrategy: 'collect',
      timeoutSeconds: 180,
      input: { itemCount: 48 },
      origin: DRESDEN,
      description:
        'Saturating Dresden-origin embedding load — how much work overflows the nearest node onto the pool.',
    },
  ],
};
