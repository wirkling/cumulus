/**
 * Token auth (spec §6 / §14.1). Per-node tokens are random, stored only as a
 * sha256 hash, and revocable. The control plane authenticates every agent
 * request; operator routes require a separate key. No secrets in logs.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { nodes, customers } from '@cumulus/db';
import { config } from './config.js';

export function mintToken(): string {
  return `node_${randomBytes(32).toString('hex')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a customer API key. Returns the full key (shown once), its hash, and a
 * display prefix. Format: ck_live_<hex>. */
export function mintCustomerKey(): { key: string; hash: string; prefix: string } {
  const key = `ck_live_${randomBytes(24).toString('hex')}`;
  return { key, hash: hashToken(key), prefix: key.slice(0, 16) };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice('Bearer '.length).trim();
}

/** Decorated onto the request by authenticateAgent. */
declare module 'fastify' {
  interface FastifyRequest {
    nodeId?: string;
    customerId?: string;
  }
}

/**
 * preHandler for agent endpoints. The body must carry `nodeId`; the Bearer
 * token must match that node's stored hash and not be revoked.
 */
export async function authenticateAgent(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = bearer(req);
  const body = (req.body ?? {}) as { nodeId?: string };
  const nodeId = body.nodeId;

  if (!token || !nodeId) {
    await reply.code(401).send({ error: 'unauthorized', message: 'missing node token or nodeId' });
    return;
  }
  const auth = await nodes.getNodeAuth(nodeId);
  if (!auth || !auth.tokenHash || auth.revoked) {
    await reply.code(401).send({ error: 'unauthorized', message: 'unknown or revoked node' });
    return;
  }
  if (!safeEqual(auth.tokenHash, hashToken(token))) {
    await reply.code(401).send({ error: 'unauthorized', message: 'invalid node token' });
    return;
  }
  req.nodeId = nodeId;
}

/** preHandler for /api/agent/register — gated by the shared bootstrap token. */
export async function authenticateBootstrap(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = bearer(req) ?? (req.headers['x-bootstrap-token'] as string | undefined);
  if (!token || !safeEqual(token, config.agentBootstrapToken)) {
    await reply.code(401).send({ error: 'unauthorized', message: 'invalid bootstrap token' });
  }
}

/** preHandler for the public /v1/* API — resolves a customer API key. */
export async function authenticateCustomer(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = bearer(req) ?? (req.headers['x-api-key'] as string | undefined);
  if (!key) {
    await reply.code(401).send({ error: 'unauthorized', message: 'missing API key' });
    return;
  }
  const customer = await customers.findCustomerByKeyHash(hashToken(key));
  if (!customer) {
    await reply.code(401).send({ error: 'unauthorized', message: 'invalid API key' });
    return;
  }
  req.customerId = customer.id;
}

/** preHandler for /api/operator/* — gated by the operator API key. */
export async function authenticateOperator(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = (req.headers['x-operator-key'] as string | undefined) ?? bearer(req);
  if (!key || !safeEqual(key, config.operatorApiKey)) {
    await reply.code(401).send({ error: 'unauthorized', message: 'invalid operator key' });
  }
}
