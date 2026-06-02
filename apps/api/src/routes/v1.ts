/** Public customer API (the product front door). Authenticated with a customer
 * API key. This is how a real user connects to Cumulus — the same submit path
 * as internal requests, but attributed to the customer. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCustomer } from '../auth.js';
import { parseOr400 } from '../validate.js';
import { submitAndDispatch } from '../services/submit.js';
import { submitSchema, buildRequestDetail } from './requests.js';
import { launchQaRun } from '../services/qa-runner.js';
import { orchestration, qa } from '@cumulus/db';
import { QA_SUITE, type QaRunDetail } from '@cumulus/shared-types';

export function registerV1Routes(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/v1/')) await authenticateCustomer(req, reply);
  });

  // Submit a job as a customer.
  app.post('/v1/requests', async (req, reply) => {
    const body = parseOr400(submitSchema, req.body, reply);
    if (!body) return;
    const request = await submitAndDispatch(
      {
        ...body,
        input: body.input ?? {},
        originLocation: body.originLocation as { lat: number; lng: number; label?: string } | undefined,
        customerId: req.customerId,
      },
      req.log,
    );
    return reply.code(201).send(await buildRequestDetail(request.id));
  });

  // Customers can only see their own requests.
  app.get<{ Params: { id: string } }>('/v1/requests/:id', async (req, reply) => {
    const request = await orchestration.getRequest(req.params.id);
    if (!request || request.customerId !== req.customerId) {
      return reply.code(404).send({ error: 'not_found', message: 'request not found' });
    }
    return reply.send(await buildRequestDetail(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/v1/requests/:id/result', async (req, reply) => {
    const request = await orchestration.getRequest(req.params.id);
    if (!request || request.customerId !== req.customerId) {
      return reply.code(404).send({ error: 'not_found', message: 'request not found' });
    }
    return reply.send({
      requestId: request.id,
      status: request.status,
      mergedResult: request.mergedResult ?? null,
    });
  });

  // ── QA suite, run BY the customer (the real product mechanism) ───────────────
  // The test user runs the tests we defined and gets results back, scoped to
  // their account. This is exactly how a real customer would self-test the pool.
  app.get('/v1/qa/suite', async (_req, reply) => reply.send(QA_SUITE));

  const launchSchema = z.object({
    envLabel: z.string().min(1).max(80).optional(),
    scenarioKeys: z.array(z.string()).optional(),
  });

  app.post('/v1/qa/runs', async (req, reply) => {
    const body = parseOr400(launchSchema, req.body, reply);
    if (!body) return;
    const runId = await launchQaRun(
      {
        envLabel: body.envLabel ?? 'customer-run',
        scenarioKeys: body.scenarioKeys,
        customerId: req.customerId,
      },
      req.log,
    );
    return reply.code(201).send({ runId });
  });

  app.get('/v1/qa/runs', async (req, reply) => {
    return reply.send(await qa.listQaRunsForCustomer(req.customerId!));
  });

  app.get<{ Params: { id: string } }>('/v1/qa/runs/:id', async (req, reply) => {
    const run = await qa.getQaRun(req.params.id);
    if (!run || run.customerId !== req.customerId) {
      return reply.code(404).send({ error: 'not_found', message: 'run not found' });
    }
    const results = await qa.listQaResults(run.id);
    const detail: QaRunDetail = { ...run, results };
    return reply.send(detail);
  });
}
