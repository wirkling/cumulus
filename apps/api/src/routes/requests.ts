/** Caller / request endpoints (spec §7). Submit a mock request; it decomposes
 * into child jobs, gets placed with locality preference, and merges on
 * completion. v1 keeps these internal (no customer auth, spec §7.3). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orchestration, nodes } from '@cumulus/db';
import { WORKLOADS } from '@cumulus/shared-types';
import type { RequestDetail, RequestJobView } from '@cumulus/shared-types';
import { decomposeRequest, requiredCapabilitiesFor } from '@cumulus/orchestration';
import { parseOr400 } from '../validate.js';
import { dispatchPlaceableJobs } from '../services/placement.js';
import { finalizeRequest } from '../services/completion.js';

const submitSchema = z
  .object({
    workloadType: z.enum(['echo_sleep', 'cpu_benchmark', 'split_map_merge']),
    fanOut: z.number().int().min(1).max(100),
    originLocation: z
      .object({ lat: z.number(), lng: z.number(), label: z.string().optional() })
      .optional(),
    mergeStrategy: z.enum(['concat', 'ordered_array', 'sum', 'collect', 'single']).optional(),
    completionPolicy: z.enum(['wait_for_all', 'wait_for_quorum']).optional(),
    quorum: z.number().int().min(1).optional(),
    onPartial: z.enum(['return_partial', 'fail']).optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    input: z.record(z.unknown()).default({}),
  })
  .refine((b) => b.completionPolicy !== 'wait_for_quorum' || (b.quorum ?? 0) >= 1, {
    message: 'quorum is required when completionPolicy is wait_for_quorum',
    path: ['quorum'],
  });

async function buildRequestDetail(requestId: string): Promise<RequestDetail | null> {
  const req = await orchestration.getRequest(requestId);
  if (!req) return null;
  const jobs = await orchestration.listJobsForRequest(requestId);
  const attempts = await orchestration.getLatestAttemptsByJob(jobs.map((j) => j.id));
  // Denormalize node names for the dashboard scatter view.
  const nodeList = await nodes.listNodes();
  const nodeNames = new Map(nodeList.map((n) => [n.id, n.name]));
  const jobViews: RequestJobView[] = jobs.map((j) => {
    const latestAttempt = attempts.get(j.id);
    return {
      ...j,
      latestAttempt,
      nodeName: latestAttempt ? nodeNames.get(latestAttempt.nodeId) : undefined,
    };
  });
  return { ...req, jobs: jobViews };
}

export function registerRequestRoutes(app: FastifyInstance): void {
  app.post('/api/requests', async (req, reply) => {
    const body = parseOr400(submitSchema, req.body, reply);
    if (!body) return;

    const def = WORKLOADS[body.workloadType];
    const timeoutSeconds = body.timeoutSeconds ?? def.defaultTimeoutSeconds;

    const request = await orchestration.createRequest({
      workloadType: body.workloadType,
      fanOut: body.fanOut,
      originLocation: body.originLocation,
      mergeStrategy: body.mergeStrategy ?? def.defaultMergeStrategy,
      completionPolicy: body.completionPolicy ?? 'wait_for_all',
      quorum: body.quorum,
      onPartial: body.onPartial ?? 'fail',
      timeoutSeconds,
      priority: body.priority ?? 'normal',
      input: body.input ?? {},
      customerId: 'internal', // single internal customer in v1 (spec §5)
    });

    const shards = decomposeRequest(request);
    await orchestration.createJobs(
      request.id,
      request.workloadType,
      shards,
      requiredCapabilitiesFor(request.workloadType),
      2, // maxRetries
      timeoutSeconds,
    );
    await orchestration.setRequestStatus(request.id, 'running');

    // Place immediately for a snappy demo; the dispatch sweep is the safety net.
    await dispatchPlaceableJobs(req.log);
    // A zero-shard / already-resolvable request shouldn't hang.
    await finalizeRequest(request.id, req.log);

    req.log.info(
      { requestId: request.id, workload: request.workloadType, shards: shards.length },
      'request submitted',
    );
    const detail = await buildRequestDetail(request.id);
    return reply.code(201).send(detail);
  });

  app.get<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    const detail = await buildRequestDetail(req.params.id);
    if (!detail) return reply.code(404).send({ error: 'not_found', message: 'request not found' });
    return reply.send(detail);
  });

  app.get<{ Params: { id: string } }>('/api/requests/:id/result', async (req, reply) => {
    const request = await orchestration.getRequest(req.params.id);
    if (!request) return reply.code(404).send({ error: 'not_found', message: 'request not found' });
    return reply.send({
      requestId: request.id,
      status: request.status,
      mergedResult: request.mergedResult ?? null,
    });
  });
}
