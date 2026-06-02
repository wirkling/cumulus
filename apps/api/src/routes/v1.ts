/** Public customer API (the product front door). Authenticated with a customer
 * API key. This is how a real user connects to Cumulus — the same submit path
 * as internal requests, but attributed to the customer. */
import type { FastifyInstance } from 'fastify';
import { authenticateCustomer } from '../auth.js';
import { parseOr400 } from '../validate.js';
import { submitAndDispatch } from '../services/submit.js';
import { submitSchema, buildRequestDetail } from './requests.js';
import { orchestration } from '@cumulus/db';

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
}
