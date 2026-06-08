/**
 * Device-lease lifecycle (Model A — rent a GPU). A lease is the Model-A
 * counterpart to a hosted request: it grants a customer exclusive, time-bounded
 * hold over a node and excludes that node from hosted (Model B) placement.
 * Execution of the customer's own model/container is deferred (Phase 2); this
 * service creates/releases the lease and records raw device-time (no billing).
 */
import type { FastifyBaseLogger } from 'fastify';
import { leases, nodes, customers, events } from '@cumulus/db';
import type { CreateLeaseRequest, DeviceLease } from '@cumulus/shared-types';

export type CreateLeaseResult =
  | { ok: true; lease: DeviceLease }
  | { ok: false; code: number; error: string; message: string };

export async function createLease(
  body: CreateLeaseRequest,
  log: FastifyBaseLogger,
): Promise<CreateLeaseResult> {
  const node = await nodes.getNode(body.nodeId);
  if (!node) return { ok: false, code: 404, error: 'not_found', message: 'node not found' };
  if (node.status === 'disabled') {
    return { ok: false, code: 409, error: 'node_unavailable', message: 'node is disabled' };
  }
  const customer = await customers.getCustomer(body.customerId);
  if (!customer) return { ok: false, code: 404, error: 'not_found', message: 'customer not found' };

  // Specific cards must exist on the node and be distinct (gpuCount lives in
  // node_capabilities, NOT on the bare Node). This also bounds the per-card
  // metering math below. Empty gpuIndices = whole-node lease, always allowed.
  if (body.gpuIndices && body.gpuIndices.length > 0) {
    const cap = await nodes.getCapabilities(body.nodeId);
    const gpuCount = cap?.gpuCount ?? 0;
    const idx = body.gpuIndices;
    const invalid =
      gpuCount <= 0 ||
      idx.length > gpuCount ||
      new Set(idx).size !== idx.length ||
      idx.some((i) => i < 0 || i >= gpuCount);
    if (invalid) {
      return {
        ok: false,
        code: 400,
        error: 'invalid_gpu_indices',
        message: `gpuIndices must be distinct and within the node's ${gpuCount} card(s)`,
      };
    }
  }

  // Atomic: the repo locks the node row and rechecks for an active lease, so two
  // concurrent requests can't double-lease one node. null = already leased.
  const lease = await leases.createLease({
    nodeId: body.nodeId,
    customerId: body.customerId,
    durationSeconds: body.durationSeconds,
    gpuIndices: body.gpuIndices,
    metadata: body.metadata,
  });
  if (!lease) {
    return { ok: false, code: 409, error: 'already_leased', message: 'node already has an active lease' };
  }
  log.info(
    { leaseId: lease.id, nodeId: lease.nodeId, customerId: lease.customerId },
    'device lease created',
  );
  return { ok: true, lease };
}

/**
 * Record raw device-time for a lease that has ended (released OR expired). One
 * usage event per ended lease — no billing (spec §9). device-time = elapsed
 * seconds × cards held; a whole-node lease (empty gpuIndices) meters one card.
 */
async function meterLease(lease: DeviceLease): Promise<void> {
  if (!lease.releasedAt) return;
  const elapsedSec = Math.max(
    0,
    Math.round((Date.parse(lease.releasedAt) - Date.parse(lease.startedAt)) / 1000),
  );
  const cards = lease.gpuIndices.length > 0 ? lease.gpuIndices.length : 1;
  await events.insertUsageEvent({
    nodeId: lease.nodeId,
    customerId: lease.customerId,
    eventType: 'gpu_seconds',
    quantity: elapsedSec * cards,
    unit: 's',
    metadata: { leaseId: lease.id, gpuIndices: lease.gpuIndices, endedBy: lease.status },
  });
}

/** Release a lease and record elapsed device-time. null if it wasn't active. */
export async function releaseLease(
  id: string,
  log: FastifyBaseLogger,
): Promise<DeviceLease | null> {
  const released = await leases.releaseLease(id);
  if (!released || !released.releasedAt) return null;
  await meterLease(released);
  log.info({ leaseId: released.id }, 'device lease released');
  return released;
}

/**
 * Expire leases past their deadline and meter each exactly once. Idempotent
 * (the repo flips each row atomically), so it's safe to call from a background
 * sweep AND opportunistically from the operator view. Returns how many expired.
 */
export async function expireDueLeases(log: FastifyBaseLogger): Promise<number> {
  const expired = await leases.expireStaleLeases();
  for (const lease of expired) await meterLease(lease);
  if (expired.length > 0) log.info({ count: expired.length }, 'device leases expired');
  return expired.length;
}
