/**
 * Cumulus domain model — single source of truth (Phase 0a).
 *
 * Imported by the API, the node agent, and the dashboard. Apply the spec's
 * §5 deltas on top of the companion plan's §7 base. Nothing here is allowed to
 * assume a platform, architecture, or topology — capabilities and location are
 * always data (spec §3.2).
 */

// ─── Enums / unions ──────────────────────────────────────────────────────────

export type NodeStatus =
  | 'provisioning'
  | 'online'
  | 'offline'
  | 'draining'
  | 'maintenance'
  | 'disabled';

/** Which prototype phase a node belongs to. 0a uses `0a_vpc` exclusively. */
export type NodePhase =
  | '0a_vpc'
  | '0b_macmini'
  | '1_revenue'
  | '2_gpu'
  | '3_real_estate';

export type NodeType = 'vpc' | 'mac_mini' | 'gpu_server' | 'edge_appliance';

export type Architecture = 'x64' | 'arm64';

export type LocationType =
  | 'cloud_region'
  | 'home'
  | 'office'
  | 'ground_floor_shop'
  | 'technical_room'
  | 'commercial_unit';

export type InternetType = 'fiber' | 'dsl' | 'cable' | 'mobile' | 'cloud_internal';

export type PowerProfile =
  | 'unknown'
  | 'single_phase'
  | 'three_phase'
  | 'commercial_63a'
  | 'commercial_125a_plus';

/**
 * Workloads. The first three are the v1 routing proxies; the latter four are
 * real CPU model inference added in Stage 2 (the QA suite measures these).
 */
export type WorkloadType =
  | 'echo_sleep'
  | 'cpu_benchmark'
  | 'split_map_merge'
  | 'embeddings'
  | 'ocr'
  | 'transcription'
  | 'llm_generate'
  | 'gpu_llm';

/** Executors a node can run — advertised in capabilities, gated at placement.
 * A GPU node advertises `gpu` (+ a high benchmark), so GPU-gated workloads route
 * there and the rest overflows to the CPU pool — zero control-plane change. */
export type ExecutorKind = 'embeddings' | 'ocr' | 'transcription' | 'llm' | 'gpu';

export type BenchmarkType =
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'network'
  | 'gpu'
  | 'llm_inference'
  | 'embedding'
  | 'custom';

export type BenchmarkStatus = 'running' | 'completed' | 'failed';

export type RequestStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type JobStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying';

export type JobAttemptStatus =
  | 'assigned'
  | 'started'
  | 'completed'
  | 'failed'
  | 'timed_out';

export type Priority = 'low' | 'normal' | 'high';

export type MergeStrategy = 'concat' | 'ordered_array' | 'sum' | 'collect' | 'single';

/**
 * Completion policy is a FIRST-CLASS, pluggable concept (spec §4.4). v1 ships
 * the first two. The third is intentionally NOT implemented — its presence in
 * the type keeps the orchestration interface able to express hedging later
 * without a rewrite (spec §3.5, §9).
 */
export type CompletionPolicy =
  | 'wait_for_all'
  | 'wait_for_quorum'
  | 'first_valid_wins_cancel_siblings'; // SEAM ONLY — do not implement in v1

export type OnPartial = 'return_partial' | 'fail';

// ─── Service model + GPU sizing (inference serving) ──────────────────────────

/**
 * The two products Cumulus serves over ONE control plane (the doc's Model A/B):
 *  - `hosted` — we host open-weight models and sell inference (Model B). Runs
 *               through the Request → Job pipeline.
 *  - `rent`   — the customer rents whole GPUs/cards and brings their own model
 *               (Model A). Realised as a {@link DeviceLease}, NOT a Job: a lease
 *               is a stateful, time-bounded, customer-exclusive hold over
 *               physical cards, not a decompose-and-merge request.
 */
export type ServiceModel = 'rent' | 'hosted';

/** Weight precision — first-class because it determines which node can serve a
 * model: weights GB ≈ params(B) × bytes/param (see BYTES_PER_PARAM). */
export type Precision = 'fp16' | 'int8' | 'int4';

export type DeviceLeaseStatus = 'active' | 'released' | 'expired';

// ─── Geo ─────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
}

// ─── Entities ────────────────────────────────────────────────────────────────

export interface Node {
  id: string;
  name: string;
  status: NodeStatus;
  phase: NodePhase;
  nodeType: NodeType;
  locationId?: string;
  agentVersion: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeLocation {
  id: string;
  name: string;
  locationType: LocationType;
  /** Delta from companion spec: lat/long are required for haversine placement. */
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  country?: string;
  internetType?: InternetType;
  powerProfile?: PowerProfile;
  maxPowerKw?: number;
  notes?: string;
}

export interface NodeCapability {
  nodeId: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  ramGb?: number;
  diskGb?: number;
  gpuCount?: number;
  gpuModels?: string[];
  gpuVramGb?: number[];
  /**
   * Tensor-parallel-capable GPU groups: each inner array is the set of card
   * indices that are NVLink-connected and therefore usable as ONE logical
   * worker (e.g. `[[0,1,2,3]]` = a 4-card TP group). Cards not listed here are
   * independent single-card workers. Detected via `nvidia-smi topo -m`; absent
   * off-NVIDIA. This is how placement knows a node can host an N-card model —
   * the doc's hard rule that a sharded model stays inside ONE box. */
  tpGroups?: number[][];
  os?: string;
  architecture?: Architecture;
  dockerAvailable?: boolean;
  cudaAvailable?: boolean;
  rocmAvailable?: boolean;
  metalAvailable?: boolean;
  /** Which model executors this node can run (Stage 2 capability-gating). */
  executors?: ExecutorKind[];
  updatedAt: string;
}

export interface HeartbeatMetrics {
  cpuUsagePct?: number;
  ramUsagePct?: number;
  diskUsagePct?: number;
  temperatureC?: number;
  /** Measured by the agent on each heartbeat — drives the benchmark/latency view. */
  controlPlaneLatencyMs?: number;
  /** GPU telemetry (when present) — utilization, VRAM, thermals, and power draw.
   * Power feeds the economics + heat-reuse story. */
  gpuUsagePct?: number;
  gpuMemUsedMb?: number;
  gpuTempC?: number;
  gpuPowerW?: number;
}

export interface NodeHeartbeat {
  id: string;
  nodeId: string;
  status: NodeStatus;
  metrics: HeartbeatMetrics;
  receivedAt: string;
}

export interface NodeBenchmark {
  id: string;
  nodeId: string;
  benchmarkType: BenchmarkType;
  score?: number;
  unit?: string;
  rawResult: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  status: BenchmarkStatus;
  errorMessage?: string;
}

/**
 * The parent entity that sits above Job (spec §4.3, §5). What the caller
 * actually submitted; it decomposes into 1..N child jobs.
 */
export interface Request {
  id: string;
  workloadType: WorkloadType;
  /** Which product this request belongs to. The Request → Job pipeline only
   * serves `hosted` (Model B) work; `rent` (Model A) is a {@link DeviceLease}. */
  serviceModel: ServiceModel;
  status: RequestStatus;
  /** How many child jobs to split into. */
  fanOut: number;
  originLocation?: GeoPoint;
  mergeStrategy: MergeStrategy;
  completionPolicy: CompletionPolicy;
  /** Required when completionPolicy === 'wait_for_quorum'. */
  quorum?: number;
  onPartial: OnPartial;
  timeoutSeconds: number;
  input: Record<string, unknown>;
  mergedResult?: unknown;
  /** Single internal customer in v1; real customer model is deferred. */
  customerId?: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  /** FK to the parent request (delta from companion spec). */
  requestId: string;
  /** Position of this shard within the fan-out (delta from companion spec). */
  shardIndex: number;
  workloadType: WorkloadType;
  status: JobStatus;
  requiredCapabilities: Record<string, unknown>;
  input: Record<string, unknown>;
  result?: unknown;
  maxRetries: number;
  timeoutSeconds: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceUsage {
  cpuSeconds?: number;
  gpuSeconds?: number;
  maxRamMb?: number;
  networkInMb?: number;
  networkOutMb?: number;
}

export interface JobAttempt {
  id: string;
  jobId: string;
  nodeId: string;
  status: JobAttemptStatus;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  errorMessage?: string;
  resourceUsage?: ResourceUsage;
  /** Observability deltas (spec §5): why this node, and how far it was. */
  placementDistanceKm?: number;
  placementScore?: number;
  createdAt: string;
}

/**
 * Model A — a customer's exclusive, time-bounded hold over specific GPU cards on
 * one node. Lives ALONGSIDE Request/Job; it is NOT a job. A lease has a
 * duration, exclusivity, and teardown that the job lifecycle does not model, so
 * forcing it into Job/JobAttempt would corrupt both. Placement treats a node
 * with an active lease as unavailable to `hosted` (Model B) work. Execution of
 * the customer's own model/container is deferred (Phase 2); Sprint 1 builds the
 * lease abstraction + placement exclusion + raw metering (usage_events).
 */
export interface DeviceLease {
  id: string;
  nodeId: string;
  customerId: string;
  /** Which cards are held. Empty = whole node (Sprint 1 leases the whole box). */
  gpuIndices: number[];
  status: DeviceLeaseStatus;
  startedAt: string;
  expiresAt: string;
  releasedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type UsageEventType =
  | 'cpu_seconds'
  | 'gpu_seconds'
  | 'gb_transfer'
  | 'storage_gb_hours'
  | 'job_completed'
  | 'heat_kwh_recovered';

export interface UsageEvent {
  id: string;
  jobId?: string;
  requestId?: string;
  nodeId: string;
  customerId?: string;
  eventType: UsageEventType;
  quantity: number;
  unit: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export type OperatorActionType =
  | 'pause_node'
  | 'drain_node'
  | 'disable_node'
  | 'enable_node'
  | 'trigger_benchmark'
  | 'retry_job'
  | 'cancel_request'
  | 'create_lease'
  | 'release_lease';

export interface OperatorAction {
  id: string;
  actionType: OperatorActionType;
  targetType: 'node' | 'job' | 'request' | 'lease';
  targetId: string;
  actor: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
