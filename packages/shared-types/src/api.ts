/**
 * Wire contracts (DTOs) for the v1 API surface (spec §7). Shared by the API,
 * the agent, and the dashboard so request/response shapes can never drift.
 */
import type {
  Architecture,
  CompletionPolicy,
  GeoPoint,
  HeartbeatMetrics,
  Job,
  JobAttempt,
  MergeStrategy,
  Node,
  NodeBenchmark,
  NodeCapability,
  NodeLocation,
  NodeStatus,
  OnPartial,
  Priority,
  Request as JobRequest,
  ResourceUsage,
  WorkloadType,
} from './domain.js';

// ─── Agent endpoints (token-authenticated) ──────────────────────────────────

export interface CapabilityReport {
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  ramGb?: number;
  diskGb?: number;
  gpuCount?: number;
  gpuModels?: string[];
  gpuVramGb?: number[];
  os?: string;
  architecture?: Architecture;
  dockerAvailable?: boolean;
  cudaAvailable?: boolean;
  rocmAvailable?: boolean;
  metalAvailable?: boolean;
}

export interface RegisterRequest {
  nodeName: string;
  nodeType: Node['nodeType'];
  agentVersion: string;
  capabilities?: CapabilityReport;
  /** Optional self-declared location (lat/long); else control plane assigns. */
  location?: Partial<NodeLocation> & { latitude: number; longitude: number };
}

export interface AgentConfig {
  heartbeatIntervalSeconds: number;
  jobPollIntervalSeconds: number;
  benchmarksEnabled: boolean;
}

export interface RegisterResponse {
  nodeId: string;
  /** Per-node token, presented as a Bearer on every subsequent agent call. */
  agentToken: string;
  config: AgentConfig;
}

export interface HeartbeatRequest {
  nodeId: string;
  status: NodeStatus;
  metrics: HeartbeatMetrics;
}

export interface HeartbeatResponse {
  ok: true;
  /** Control plane may push commands back via the heartbeat ack (e.g. drain). */
  directives?: AgentDirective[];
}

export type AgentDirective =
  | { type: 'drain' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'run_benchmark'; benchmarkType: NodeBenchmark['benchmarkType'] };

export interface CapabilitiesRequest {
  nodeId: string;
  capabilities: CapabilityReport;
}

export interface PollRequest {
  nodeId: string;
}

/** A unit of work handed to the agent in a poll response. */
export interface DispatchedJob {
  jobId: string;
  attemptId: string;
  workloadType: WorkloadType;
  input: Record<string, unknown>;
  timeoutSeconds: number;
}

export interface PollResponse {
  jobAvailable: boolean;
  job?: DispatchedJob;
}

export interface JobStartRequest {
  nodeId: string;
}

export interface JobCompleteRequest {
  nodeId: string;
  result: unknown;
  resourceUsage?: ResourceUsage;
  exitCode?: number;
}

export interface JobFailRequest {
  nodeId: string;
  errorMessage: string;
  exitCode?: number;
  resourceUsage?: ResourceUsage;
}

export interface BenchmarkSubmitRequest {
  nodeId: string;
  benchmarkType: NodeBenchmark['benchmarkType'];
  score?: number;
  unit?: string;
  rawResult: Record<string, unknown>;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

// ─── Caller / request endpoints ──────────────────────────────────────────────

export interface SubmitRequestBody {
  workloadType: WorkloadType;
  fanOut: number;
  originLocation?: GeoPoint;
  mergeStrategy?: MergeStrategy;
  completionPolicy?: CompletionPolicy;
  quorum?: number;
  onPartial?: OnPartial;
  timeoutSeconds?: number;
  priority?: Priority;
  input: Record<string, unknown>;
}

/** A child job enriched with its latest attempt for the request-detail view. */
export interface RequestJobView extends Job {
  latestAttempt?: JobAttempt;
  /** Denormalized for the dashboard scatter/gather view. */
  nodeName?: string;
}

export interface RequestDetail extends JobRequest {
  jobs: RequestJobView[];
}

// ─── Operator endpoints ──────────────────────────────────────────────────────

export interface NodeSummary extends Node {
  location?: NodeLocation;
  capability?: NodeCapability;
  queueLength: number;
  jobsCompletedToday: number;
  failureRatePct: number;
  latestMetrics?: HeartbeatMetrics;
}

export interface NodeDetail extends NodeSummary {
  benchmarks: NodeBenchmark[];
  recentAttempts: JobAttempt[];
}

export interface NodeListFilter {
  status?: NodeStatus;
  locationId?: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}
