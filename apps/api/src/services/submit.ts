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
  ServiceModel,
  Precision,
} from '@cumulus/shared-types';
import { decomposeRequest, requiredCapabilitiesFor } from '@cumulus/orchestration';
import { dispatchPlaceableJobs } from './placement.js';
import { finalizeRequest } from './completion.js';

export interface SubmitInput {
  workloadType: WorkloadType;
  /** hosted (Model B) only here; defaults to hosted. rent (Model A) = a lease. */
  serviceModel?: ServiceModel;
  fanOut: number;
  originLocation?: GeoPoint;
  mergeStrategy?: MergeStrategy;
  completionPolicy?: CompletionPolicy;
  quorum?: number;
  onPartial?: OnPartial;
  timeoutSeconds?: number;
  priority?: Priority;
  /** Hosted-inference serving hints (the placeable (model, precision) unit). */
  model?: string;
  precision?: Precision;
  contextLen?: number;
  maxTokens?: number;
  /** Require a node with an NVLink TP group of >= N cards (big models). */
  tpGroupMinCards?: number;
  input: Record<string, unknown>;
  customerId?: string;
  qaRunId?: string;
}

/** Create the request + its child jobs and mark it running, WITHOUT dispatching.
 * Used to build a real burst (QA load) before a single dispatch pass. */
export async function enqueueRequest(body: SubmitInput): Promise<JobRequest> {
  const def = WORKLOADS[body.workloadType];
  const timeoutSeconds = body.timeoutSeconds ?? def.defaultTimeoutSeconds;

  // Fold (model, precision, context, maxTokens) serving hints into the request
  // input so they travel to the executor. The placeable unit is (model,
  // precision) — the VRAM-fit filter that consumes them is Sprint 2. Stored
  // under a reserved `__serving` key so it never clobbers caller-supplied input.
  const serving: Record<string, unknown> = {};
  if (body.model) serving.model = body.model;
  if (body.precision) serving.precision = body.precision;
  if (body.contextLen) serving.contextLen = body.contextLen;
  if (body.maxTokens) serving.maxTokens = body.maxTokens;
  const input =
    Object.keys(serving).length > 0 ? { ...body.input, __serving: serving } : body.input;

  const request = await orchestration.createRequest({
    workloadType: body.workloadType,
    serviceModel: body.serviceModel ?? 'hosted',
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
    input,
    customerId: body.customerId,
    qaRunId: body.qaRunId,
  });

  // A model that needs a tensor-parallel group becomes a hard CAPABILITY filter
  // (the grouped node, never scattered single cards — the doc's one-box rule).
  const extraCaps: Record<string, unknown> = {};
  if (body.tpGroupMinCards) extraCaps.tpGroupMinCards = body.tpGroupMinCards;

  const shards = decomposeRequest(request);
  await orchestration.createJobs(
    request.id,
    request.workloadType,
    shards,
    requiredCapabilitiesFor(request.workloadType, extraCaps),
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
