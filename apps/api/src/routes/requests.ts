/** Caller / request endpoints (spec §7). Submit a mock request; it decomposes
 * into child jobs, gets placed with locality preference, and merges on
 * completion. v1 keeps these internal (no customer auth, spec §7.3). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orchestration, nodes } from '@cumulus/db';
import type { RequestDetail, RequestJobView } from '@cumulus/shared-types';
import { parseOr400 } from '../validate.js';
import { submitAndDispatch } from '../services/submit.js';

export const submitSchema = z
  .object({
    // Mock routing proxies + the real hosted-inference workloads (Model B).
    workloadType: z.enum([
      'echo_sleep',
      'cpu_benchmark',
      'split_map_merge',
      'embeddings',
      'ocr',
      'transcription',
      'llm_generate',
      'gpu_llm',
    ]),
    // The request pipeline serves hosted (Model B) only; `rent` (Model A) is a
    // device lease, not a request. Defaults to hosted.
    serviceModel: z.enum(['rent', 'hosted']).optional(),
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
    // Hosted-inference serving hints. The placeable unit is (model, precision);
    // the VRAM-fit filter that consumes them is Sprint 2. `tpGroupMinCards`
    // requires a node with an NVLink group of >= N cards (big models).
    model: z.string().min(1).max(200).optional(),
    precision: z.enum(['fp16', 'int8', 'int4']).optional(),
    contextLen: z.number().int().min(1).max(1_048_576).optional(),
    maxTokens: z.number().int().min(1).max(1_048_576).optional(),
    tpGroupMinCards: z.number().int().min(1).max(64).optional(),
    input: z.record(z.unknown()).default({}),
  })
  .refine((b) => b.completionPolicy !== 'wait_for_quorum' || (b.quorum ?? 0) >= 1, {
    message: 'quorum is required when completionPolicy is wait_for_quorum',
    path: ['quorum'],
  })
  .refine((b) => b.serviceModel !== 'rent', {
    message:
      'serviceModel "rent" (Model A) is a device lease, not a request — use POST /api/operator/leases',
    path: ['serviceModel'],
  });

export async function buildRequestDetail(requestId: string): Promise<RequestDetail | null> {
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
    const request = await submitAndDispatch(
      {
        ...body,
        input: body.input ?? {},
        originLocation: body.originLocation as { lat: number; lng: number; label?: string } | undefined,
        customerId: 'internal', // single internal customer (spec §5)
      },
      req.log,
    );
    return reply.code(201).send(await buildRequestDetail(request.id));
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
