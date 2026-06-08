/**
 * Row → domain mappers. The DB uses snake_case + Date objects; the domain model
 * (packages/shared-types) uses camelCase + ISO strings. Convert at this seam so
 * nothing downstream sees raw rows.
 */
import type {
  Node,
  NodeLocation,
  NodeCapability,
  NodeHeartbeat,
  NodeBenchmark,
  Request as JobRequest,
  Job,
  JobAttempt,
  DeviceLease,
  UsageEvent,
  OperatorAction,
  Customer,
  QaRun,
  QaResult,
} from '@cumulus/shared-types';

type Row = Record<string, unknown>;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '';
const isoOpt = (v: unknown): string | undefined =>
  v == null ? undefined : iso(v);
const num = (v: unknown): number | undefined =>
  v == null ? undefined : Number(v);
const str = (v: unknown): string | undefined =>
  v == null ? undefined : String(v);

export function mapLocation(r: Row): NodeLocation {
  return {
    id: String(r.id),
    name: String(r.name),
    locationType: r.location_type as NodeLocation['locationType'],
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    city: str(r.city),
    state: str(r.state),
    country: str(r.country),
    internetType: r.internet_type as NodeLocation['internetType'],
    powerProfile: r.power_profile as NodeLocation['powerProfile'],
    maxPowerKw: num(r.max_power_kw),
    notes: str(r.notes),
  };
}

export function mapNode(r: Row): Node {
  return {
    id: String(r.id),
    name: String(r.name),
    status: r.status as Node['status'],
    phase: r.phase as Node['phase'],
    nodeType: r.node_type as Node['nodeType'],
    locationId: str(r.location_id),
    agentVersion: String(r.agent_version),
    lastHeartbeatAt: isoOpt(r.last_heartbeat_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapCapability(r: Row): NodeCapability {
  return {
    nodeId: String(r.node_id),
    cpuModel: str(r.cpu_model),
    cpuCores: num(r.cpu_cores),
    cpuThreads: num(r.cpu_threads),
    ramGb: num(r.ram_gb),
    diskGb: num(r.disk_gb),
    gpuCount: num(r.gpu_count),
    gpuModels: (r.gpu_models as string[]) ?? undefined,
    gpuVramGb: (r.gpu_vram_gb as number[]) ?? undefined,
    tpGroups: (r.tp_groups as number[][]) ?? undefined,
    os: str(r.os),
    architecture: r.architecture as NodeCapability['architecture'],
    dockerAvailable: r.docker_available as boolean | undefined,
    cudaAvailable: r.cuda_available as boolean | undefined,
    rocmAvailable: r.rocm_available as boolean | undefined,
    metalAvailable: r.metal_available as boolean | undefined,
    executors: (r.executors as NodeCapability['executors']) ?? undefined,
    updatedAt: iso(r.updated_at),
  };
}

export function mapHeartbeat(r: Row): NodeHeartbeat {
  return {
    id: String(r.id),
    nodeId: String(r.node_id),
    status: r.status as NodeHeartbeat['status'],
    metrics: (r.metrics as NodeHeartbeat['metrics']) ?? {},
    receivedAt: iso(r.received_at),
  };
}

export function mapBenchmark(r: Row): NodeBenchmark {
  return {
    id: String(r.id),
    nodeId: String(r.node_id),
    benchmarkType: r.benchmark_type as NodeBenchmark['benchmarkType'],
    score: num(r.score),
    unit: str(r.unit),
    rawResult: (r.raw_result as Record<string, unknown>) ?? {},
    startedAt: iso(r.started_at),
    completedAt: isoOpt(r.completed_at),
    status: r.status as NodeBenchmark['status'],
    errorMessage: str(r.error_message),
  };
}

export function mapRequest(r: Row): JobRequest {
  const originLat = num(r.origin_lat);
  const originLng = num(r.origin_lng);
  return {
    id: String(r.id),
    workloadType: r.workload_type as JobRequest['workloadType'],
    serviceModel: (r.service_model as JobRequest['serviceModel']) ?? 'hosted',
    status: r.status as JobRequest['status'],
    fanOut: Number(r.fan_out),
    originLocation:
      originLat != null && originLng != null
        ? { lat: originLat, lng: originLng, label: str(r.origin_label) }
        : undefined,
    mergeStrategy: r.merge_strategy as JobRequest['mergeStrategy'],
    completionPolicy: r.completion_policy as JobRequest['completionPolicy'],
    quorum: num(r.quorum),
    onPartial: r.on_partial as JobRequest['onPartial'],
    timeoutSeconds: Number(r.timeout_seconds),
    input: (r.input as Record<string, unknown>) ?? {},
    mergedResult: r.merged_result ?? undefined,
    customerId: str(r.customer_id),
    priority: r.priority as JobRequest['priority'],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapJob(r: Row): Job {
  return {
    id: String(r.id),
    requestId: String(r.request_id),
    shardIndex: Number(r.shard_index),
    workloadType: r.workload_type as Job['workloadType'],
    status: r.status as Job['status'],
    requiredCapabilities: (r.required_capabilities as Record<string, unknown>) ?? {},
    input: (r.input as Record<string, unknown>) ?? {},
    result: r.result ?? undefined,
    maxRetries: Number(r.max_retries),
    timeoutSeconds: Number(r.timeout_seconds),
    attemptCount: Number(r.attempt_count),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapAttempt(r: Row): JobAttempt {
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    nodeId: String(r.node_id),
    status: r.status as JobAttempt['status'],
    startedAt: isoOpt(r.started_at),
    completedAt: isoOpt(r.completed_at),
    exitCode: num(r.exit_code),
    errorMessage: str(r.error_message),
    resourceUsage: (r.resource_usage as JobAttempt['resourceUsage']) ?? undefined,
    placementDistanceKm: num(r.placement_distance_km),
    placementScore: num(r.placement_score),
    createdAt: iso(r.created_at),
  };
}

export function mapDeviceLease(r: Row): DeviceLease {
  return {
    id: String(r.id),
    nodeId: String(r.node_id),
    customerId: String(r.customer_id),
    gpuIndices: (r.gpu_indices as number[]) ?? [],
    status: r.status as DeviceLease['status'],
    startedAt: iso(r.started_at),
    expiresAt: iso(r.expires_at),
    releasedAt: isoOpt(r.released_at),
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    createdAt: iso(r.created_at),
  };
}

export function mapUsageEvent(r: Row): UsageEvent {
  return {
    id: String(r.id),
    jobId: str(r.job_id),
    requestId: str(r.request_id),
    nodeId: String(r.node_id),
    customerId: str(r.customer_id),
    eventType: r.event_type as UsageEvent['eventType'],
    quantity: Number(r.quantity),
    unit: String(r.unit),
    occurredAt: iso(r.occurred_at),
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
  };
}

export function mapCustomer(r: Row): Customer {
  return {
    id: String(r.id),
    name: String(r.name),
    keyPrefix: String(r.key_prefix),
    status: r.status as Customer['status'],
    createdAt: iso(r.created_at),
  };
}

export function mapQaRun(r: Row): QaRun {
  return {
    id: String(r.id),
    suiteVersion: String(r.suite_version),
    envLabel: String(r.env_label),
    status: r.status as QaRun['status'],
    customerId: str(r.customer_id),
    fleetSnapshot: (r.fleet_snapshot as QaRun['fleetSnapshot']) ?? [],
    summary: (r.summary as QaRun['summary']) ?? undefined,
    startedAt: iso(r.started_at),
    finishedAt: isoOpt(r.finished_at),
  };
}

export function mapQaResult(r: Row): QaResult {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    scenarioKey: String(r.scenario_key),
    useCase: String(r.use_case),
    requestCount: Number(r.request_count),
    succeeded: Number(r.succeeded),
    failed: Number(r.failed),
    latencyP50Ms: num(r.latency_p50_ms),
    latencyP95Ms: num(r.latency_p95_ms),
    latencyMaxMs: num(r.latency_max_ms),
    throughputPerSec: num(r.throughput_per_sec),
    metrics: (r.metrics as QaResult['metrics']) ?? {},
    createdAt: iso(r.created_at),
  };
}

export function mapOperatorAction(r: Row): OperatorAction {
  return {
    id: String(r.id),
    actionType: r.action_type as OperatorAction['actionType'],
    targetType: r.target_type as OperatorAction['targetType'],
    targetId: String(r.target_id),
    actor: String(r.actor),
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    createdAt: iso(r.created_at),
  };
}
