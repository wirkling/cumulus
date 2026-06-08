/**
 * Wire contracts (DTOs) for the v1 API surface (spec §7). Shared by the API,
 * the agent, and the dashboard so request/response shapes can never drift.
 */
import type {
  Architecture,
  CompletionPolicy,
  DeviceLease,
  ExecutorKind,
  GeoPoint,
  HeartbeatMetrics,
  Job,
  JobAttempt,
  JobAttemptStatus,
  MergeStrategy,
  Node,
  NodeBenchmark,
  NodeCapability,
  NodeLocation,
  NodeStatus,
  OnPartial,
  Precision,
  Priority,
  Request as JobRequest,
  ResourceUsage,
  ServiceModel,
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
  /** NVLink-connected card-index sets usable as one tensor-parallel worker. */
  tpGroups?: number[][];
  os?: string;
  architecture?: Architecture;
  dockerAvailable?: boolean;
  cudaAvailable?: boolean;
  rocmAvailable?: boolean;
  metalAvailable?: boolean;
  executors?: ExecutorKind[];
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
  /** Always `hosted` here — Model B inference. `rent` (Model A) is provisioned
   * via the leases endpoint, not the request pipeline. Defaults to `hosted`. */
  serviceModel?: ServiceModel;
  fanOut: number;
  originLocation?: GeoPoint;
  mergeStrategy?: MergeStrategy;
  completionPolicy?: CompletionPolicy;
  quorum?: number;
  onPartial?: OnPartial;
  timeoutSeconds?: number;
  priority?: Priority;
  /** Serving hints for hosted inference. The placeable unit is (model, precision)
   * — see the doc's size-aware-placement requirement. The hard VRAM-fit filter
   * is Sprint 2; Sprint 1 records these + can require a TP group. */
  model?: string;
  precision?: Precision;
  contextLen?: number;
  maxTokens?: number;
  /** Require a node with an NVLink TP group of at least N cards (big models). */
  tpGroupMinCards?: number;
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

// ─── Device leases (Model A — rent a GPU) ────────────────────────────────────

export interface CreateLeaseRequest {
  nodeId: string;
  customerId: string;
  /** Lease length in seconds; the lease expires (and frees the node) after it. */
  durationSeconds: number;
  /** Cards to hold. Omit / empty = whole node (Sprint 1 leases the whole box). */
  gpuIndices?: number[];
  metadata?: Record<string, unknown>;
}

/** A lease enriched with display names for the operator view. */
export interface LeaseView extends DeviceLease {
  nodeName?: string;
  customerName?: string;
}

// ─── Fleet allocation (ops view: who is on which hardware for which model) ────

/** A node's hardware/capability summary for the allocation view. */
export interface AllocationNode {
  id: string;
  name: string;
  status: NodeStatus;
  city?: string;
  cpuCores?: number;
  ramGb?: number;
  gpuCount?: number;
  gpuModels?: string[];
  gpuVramGb?: number[];
  tpGroups?: number[][];
  executors?: ExecutorKind[];
}

/** A live hosted-inference (Model B) job currently occupying a node. */
export interface ActiveJobAllocation {
  attemptId: string;
  jobId: string;
  requestId: string;
  nodeId: string;
  customerId?: string;
  customerName?: string;
  workloadType: WorkloadType;
  /** Serving model, when the caller supplied one (else show the workload). */
  model?: string;
  status: JobAttemptStatus;
  startedAt?: string;
}

/**
 * The fleet allocation snapshot — the building blocks the dashboard pivots
 * either by node ("what is my fleet doing") or by customer ("what is each
 * customer consuming"). `leases` are active Model-A holds; `jobs` are live
 * Model-B inference attempts.
 */
export interface FleetAllocation {
  nodes: AllocationNode[];
  leases: LeaseView[];
  jobs: ActiveJobAllocation[];
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}
