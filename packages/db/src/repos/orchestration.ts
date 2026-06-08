import type {
  Request as JobRequest,
  Job,
  JobAttempt,
  RequestStatus,
  JobStatus,
  ResourceUsage,
  SubmitRequestBody,
  MergeStrategy,
  CompletionPolicy,
  OnPartial,
  Priority,
  ServiceModel,
  WorkloadType,
  JobAttemptStatus,
  ActiveJobAllocation,
} from '@cumulus/shared-types';
import type { ShardSpec } from '@cumulus/orchestration';
import { getSql, toJson } from '../client.js';
import { mapRequest, mapJob, mapAttempt } from '../mappers.js';

// ─── Requests ────────────────────────────────────────────────────────────────

export async function createRequest(
  body: Required<
    Pick<SubmitRequestBody, 'workloadType' | 'fanOut' | 'mergeStrategy' | 'completionPolicy' | 'onPartial' | 'timeoutSeconds' | 'input'>
  > & {
    mergeStrategy: MergeStrategy;
    completionPolicy: CompletionPolicy;
    onPartial: OnPartial;
    priority: Priority;
    serviceModel?: ServiceModel;
    quorum?: number;
    originLocation?: { lat: number; lng: number; label?: string };
    customerId?: string;
    qaRunId?: string;
  },
): Promise<JobRequest> {
  const sql = getSql();
  const rows = await sql`
    insert into requests
      (workload_type, service_model, fan_out, origin_lat, origin_lng, origin_label, merge_strategy,
       completion_policy, quorum, on_partial, timeout_seconds, input, customer_id, priority,
       status, deadline_at, qa_run_id)
    values
      (${body.workloadType}, ${body.serviceModel ?? 'hosted'}, ${body.fanOut}, ${body.originLocation?.lat ?? null},
       ${body.originLocation?.lng ?? null}, ${body.originLocation?.label ?? null},
       ${body.mergeStrategy}, ${body.completionPolicy}, ${body.quorum ?? null},
       ${body.onPartial}, ${body.timeoutSeconds}, ${sql.json(toJson(body.input))},
       ${body.customerId ?? null}, ${body.priority}, 'queued',
       now() + (${body.timeoutSeconds} * interval '1 second'), ${body.qaRunId ?? null})
    returning *`;
  return mapRequest(rows[0]!);
}

/** Fetch a batch of requests by id (for QA latency aggregation). */
export async function getRequestsByIds(ids: string[]): Promise<JobRequest[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  const rows = await sql`select * from requests where id in ${sql(ids)}`;
  return rows.map(mapRequest);
}

/** Count completed job attempts per node across a set of requests (distribution). */
export async function nodeDistributionForRequests(
  requestIds: string[],
): Promise<Record<string, number>> {
  if (requestIds.length === 0) return {};
  const sql = getSql();
  const rows = await sql<{ node_id: string; n: number }[]>`
    select a.node_id, count(*)::int as n
    from job_attempts a
    join jobs j on j.id = a.job_id
    where j.request_id in ${sql(requestIds)} and a.status = 'completed'
    group by a.node_id`;
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.node_id)] = Number(r.n);
  return out;
}

export async function getRequest(id: string): Promise<JobRequest | null> {
  const sql = getSql();
  const rows = await sql`select * from requests where id = ${id}`;
  return rows[0] ? mapRequest(rows[0]) : null;
}

export async function listRequests(limit = 100): Promise<JobRequest[]> {
  const sql = getSql();
  const rows = await sql`select * from requests order by created_at desc limit ${limit}`;
  return rows.map(mapRequest);
}

export async function setRequestStatus(id: string, status: RequestStatus): Promise<void> {
  const sql = getSql();
  await sql`update requests set status = ${status}, updated_at = now() where id = ${id}`;
}

export async function setRequestResult(
  id: string,
  status: RequestStatus,
  mergedResult: unknown,
): Promise<void> {
  const sql = getSql();
  await sql`
    update requests
    set status = ${status}, merged_result = ${sql.json(toJson(mergedResult))}, updated_at = now()
    where id = ${id}`;
}

/** Requests still in a non-terminal state — scanned by the completion sweep. */
export async function listActiveRequests(): Promise<JobRequest[]> {
  const sql = getSql();
  const rows = await sql`select * from requests where status in ('queued','running') order by created_at`;
  return rows.map(mapRequest);
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function createJobs(
  requestId: string,
  workloadType: Job['workloadType'],
  shards: ShardSpec[],
  requiredCapabilities: Record<string, unknown>,
  maxRetries: number,
  timeoutSeconds: number,
): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`
    insert into jobs ${sql(
      shards.map((s) => ({
        request_id: requestId,
        shard_index: s.shardIndex,
        workload_type: workloadType,
        status: 'queued' as JobStatus,
        required_capabilities: sql.json(toJson(requiredCapabilities)),
        input: sql.json(toJson(s.input)),
        max_retries: maxRetries,
        timeout_seconds: timeoutSeconds,
      })),
    )}
    returning *`;
  return rows.map(mapJob);
}

export async function getJob(id: string): Promise<Job | null> {
  const sql = getSql();
  const rows = await sql`select * from jobs where id = ${id}`;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listJobsForRequest(requestId: string): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`select * from jobs where request_id = ${requestId} order by shard_index`;
  return rows.map(mapJob);
}

/** Jobs needing placement: queued or retrying, scanned by the dispatch sweep. */
export async function listPlaceableJobs(): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`
    select * from jobs where status in ('queued','retrying')
    order by created_at limit 200`;
  return rows.map(mapJob);
}

export async function listRecentJobs(limit = 100): Promise<Job[]> {
  const sql = getSql();
  const rows = await sql`select * from jobs order by created_at desc limit ${limit}`;
  return rows.map(mapJob);
}

export async function setJobStatus(id: string, status: JobStatus): Promise<void> {
  const sql = getSql();
  await sql`update jobs set status = ${status}, updated_at = now() where id = ${id}`;
}

// ─── Attempts ────────────────────────────────────────────────────────────────

/**
 * Atomically place a job on a node: create the attempt and flip the job to
 * 'assigned' in one transaction. Guards against double-placement by only
 * transitioning jobs that are still queued/retrying.
 * Returns the new attempt, or null if the job was already taken.
 */
export async function placeJobOnNode(params: {
  jobId: string;
  nodeId: string;
  timeoutSeconds: number;
  placementDistanceKm?: number;
  placementScore?: number;
}): Promise<JobAttempt | null> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update jobs set status = 'assigned', attempt_count = attempt_count + 1, updated_at = now()
      where id = ${params.jobId} and status in ('queued','retrying')
      returning id`;
    if (!updated[0]) return null; // already placed by another sweep tick

    const rows = await tx`
      insert into job_attempts
        (job_id, node_id, status, deadline_at, placement_distance_km, placement_score)
      values
        (${params.jobId}, ${params.nodeId}, 'assigned',
         now() + (${params.timeoutSeconds} * interval '1 second'),
         ${params.placementDistanceKm ?? null}, ${params.placementScore ?? null})
      returning *`;
    return mapAttempt(rows[0]!);
  });
}

export async function getAttempt(id: string): Promise<JobAttempt | null> {
  const sql = getSql();
  const rows = await sql`select * from job_attempts where id = ${id}`;
  return rows[0] ? mapAttempt(rows[0]) : null;
}

/** The next assigned attempt for a polling node, flipped to 'started' atomically. */
export async function claimNextAttemptForNode(nodeId: string): Promise<
  | { attempt: JobAttempt; job: Job }
  | null
> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx`
      select * from job_attempts
      where node_id = ${nodeId} and status = 'assigned'
      order by created_at limit 1
      for update skip locked`;
    if (!rows[0]) return null;
    const attempt = mapAttempt(rows[0]);
    const jobRows = await tx`select * from jobs where id = ${attempt.jobId}`;
    if (!jobRows[0]) return null;
    return { attempt, job: mapJob(jobRows[0]) };
  });
}

export async function markAttemptStarted(attemptId: string): Promise<void> {
  const sql = getSql();
  await sql.begin(async (tx) => {
    const rows = await tx<{ job_id: string }[]>`
      update job_attempts set status = 'started', started_at = now()
      where id = ${attemptId} and status = 'assigned'
      returning job_id`;
    if (rows[0]) {
      await tx`update jobs set status = 'running', updated_at = now() where id = ${rows[0].job_id}`;
    }
  });
}

/** Complete an attempt and its job; records the result on the job. */
export async function completeAttempt(params: {
  attemptId: string;
  result: unknown;
  resourceUsage?: ResourceUsage;
  exitCode?: number;
}): Promise<{ jobId: string; requestId: string } | null> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx<{ job_id: string }[]>`
      update job_attempts
      set status = 'completed', completed_at = now(),
          resource_usage = ${params.resourceUsage ? tx.json(toJson(params.resourceUsage)) : null},
          exit_code = ${params.exitCode ?? null}
      where id = ${params.attemptId} and status in ('assigned','started')
      returning job_id`;
    if (!rows[0]) return null;
    const jobId = rows[0].job_id;
    const jobRows = await tx<{ request_id: string }[]>`
      update jobs set status = 'completed', result = ${tx.json(toJson(params.result))}, updated_at = now()
      where id = ${jobId}
      returning request_id`;
    return { jobId, requestId: jobRows[0]!.request_id };
  });
}

/**
 * Fail an attempt. If the job still has retries left, flip it to 'retrying'
 * (the dispatch sweep re-places it on a possibly-different node); otherwise
 * mark the job failed. Returns the resulting job status.
 */
export async function failAttempt(params: {
  attemptId: string;
  errorMessage: string;
  exitCode?: number;
  timedOut?: boolean;
}): Promise<{ jobId: string; requestId: string; jobStatus: JobStatus } | null> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const aRows = await tx<{ job_id: string }[]>`
      update job_attempts
      set status = ${params.timedOut ? 'timed_out' : 'failed'}, completed_at = now(),
          error_message = ${params.errorMessage}, exit_code = ${params.exitCode ?? null}
      where id = ${params.attemptId} and status in ('assigned','started')
      returning job_id`;
    if (!aRows[0]) return null;
    const jobId = aRows[0].job_id;

    const jRows = await tx<{ request_id: string; attempt_count: number; max_retries: number }[]>`
      select request_id, attempt_count, max_retries from jobs where id = ${jobId}`;
    const job = jRows[0]!;
    const canRetry = job.attempt_count <= job.max_retries; // attempt_count already incremented at placement
    const newStatus: JobStatus = canRetry ? 'retrying' : 'failed';
    await tx`update jobs set status = ${newStatus}, updated_at = now() where id = ${jobId}`;
    return { jobId, requestId: job.request_id, jobStatus: newStatus };
  });
}

/** Timeout sweep: active attempts whose deadline has passed. */
export async function listExpiredAttempts(): Promise<JobAttempt[]> {
  const sql = getSql();
  const rows = await sql`
    select * from job_attempts
    where status in ('assigned','started') and deadline_at < now()`;
  return rows.map(mapAttempt);
}

/** Active attempts on a set of nodes — used to fail jobs when a node goes offline. */
export async function listActiveAttemptsForNodes(nodeIds: string[]): Promise<JobAttempt[]> {
  if (nodeIds.length === 0) return [];
  const sql = getSql();
  const rows = await sql`
    select * from job_attempts
    where status in ('assigned','started') and node_id in ${sql(nodeIds)}`;
  return rows.map(mapAttempt);
}

export async function getLatestAttemptsByJob(jobIds: string[]): Promise<Map<string, JobAttempt>> {
  const map = new Map<string, JobAttempt>();
  if (jobIds.length === 0) return map;
  const sql = getSql();
  const rows = await sql`
    select distinct on (job_id) * from job_attempts
    where job_id in ${sql(jobIds)}
    order by job_id, created_at desc`;
  for (const r of rows) {
    const a = mapAttempt(r);
    map.set(a.jobId, a);
  }
  return map;
}

export async function recentAttemptsForNode(nodeId: string, limit = 20): Promise<JobAttempt[]> {
  const sql = getSql();
  const rows = await sql`
    select * from job_attempts where node_id = ${nodeId}
    order by created_at desc limit ${limit}`;
  return rows.map(mapAttempt);
}

export async function queueLengthForNode(nodeId: string): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from job_attempts
    where node_id = ${nodeId} and status in ('assigned','started')`;
  return rows[0]?.n ?? 0;
}

/**
 * Live hosted-inference (Model B) attempts currently occupying nodes, joined to
 * their job + request so the allocation view can show customer + model per node.
 * The serving model rides the request input under the reserved `__serving` key
 * (set by submit); absent when the caller gave no model hint. customerName is
 * resolved by the caller (customer_id may be the literal 'internal').
 */
export async function listActiveAllocations(): Promise<ActiveJobAllocation[]> {
  const sql = getSql();
  const rows = await sql`
    select a.id as attempt_id, a.node_id, a.status, a.started_at,
           j.id as job_id, j.workload_type, j.request_id,
           r.customer_id, r.input
    from job_attempts a
    join jobs j on j.id = a.job_id
    join requests r on r.id = j.request_id
    where a.status in ('assigned','started')
    order by a.created_at desc`;
  return rows.map((r): ActiveJobAllocation => {
    const input = (r.input as Record<string, unknown>) ?? {};
    const serving = input.__serving as Record<string, unknown> | undefined;
    const model = serving && typeof serving.model === 'string' ? serving.model : undefined;
    return {
      attemptId: String(r.attempt_id),
      jobId: String(r.job_id),
      requestId: String(r.request_id),
      nodeId: String(r.node_id),
      customerId: r.customer_id != null ? String(r.customer_id) : undefined,
      workloadType: r.workload_type as WorkloadType,
      model,
      status: r.status as JobAttemptStatus,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : undefined,
    };
  });
}
