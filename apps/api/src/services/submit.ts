/**
 * Shared request-submission path: decompose → create jobs → dispatch → finalize.
 * Used by the internal route, the public /v1 customer API, and the QA
 * orchestrator, so all three behave identically.
 */
import type { FastifyBaseLogger } from 'fastify';
import { orchestration } from '@cumulus/db';
import { WORKLOADS } from '@cumulus/shared-types';
import type {
  Request as JobRequest,
  WorkloadType,
  MergeStrategy,
  CompletionPolicy,
  OnPartial,
  Priority,
  GeoPoint,
} from '@cumulus/shared-types';
import { decomposeRequest, requiredCapabilitiesFor } from '@cumulus/orchestration';
import { dispatchPlaceableJobs } from './placement.js';
import { finalizeRequest } from './completion.js';

export interface SubmitInput {
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
  customerId?: string;
  qaRunId?: string;
}

/** Create the request + its child jobs and mark it running, WITHOUT dispatching.
 * Used to build a real burst (QA load) before a single dispatch pass. */
export async function enqueueRequest(body: SubmitInput): Promise<JobRequest> {
  const def = WORKLOADS[body.workloadType];
  const timeoutSeconds = body.timeoutSeconds ?? def.defaultTimeoutSeconds;

  const request = await orchestration.createRequest({
    workloadType: body.workloadType,
    fanOut: body.fanOut,
    originLocation: body.originLocation
      ? { lat: body.originLocation.lat, lng: body.originLocation.lng, label: body.originLocation.label }
      : undefined,
    mergeStrategy: body.mergeStrategy ?? def.defaultMergeStrategy,
    completionPolicy: body.completionPolicy ?? 'wait_for_all',
    quorum: body.quorum,
    onPartial: body.onPartial ?? 'fail',
    timeoutSeconds,
    priority: body.priority ?? 'normal',
    input: body.input,
    customerId: body.customerId,
    qaRunId: body.qaRunId,
  });

  const shards = decomposeRequest(request);
  await orchestration.createJobs(
    request.id,
    request.workloadType,
    shards,
    requiredCapabilitiesFor(request.workloadType),
    2,
    timeoutSeconds,
  );
  await orchestration.setRequestStatus(request.id, 'running');
  return request;
}

export async function submitAndDispatch(
  body: SubmitInput,
  log: FastifyBaseLogger,
): Promise<JobRequest> {
  const request = await enqueueRequest(body);
  await dispatchPlaceableJobs(log);
  await finalizeRequest(request.id, log);
  return request;
}
