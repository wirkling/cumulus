/**
 * Device leases (Model A — rent a GPU). A lease is a stateful, time-bounded,
 * customer-exclusive hold over a node's cards. It lives alongside the Request →
 * Job pipeline, NOT inside it. Placement excludes a node with an active,
 * unexpired lease from hosted (Model B) work — see getPlacementCandidates.
 */
import type { DeviceLease } from '@cumulus/shared-types';
import { getSql, toJson } from '../client.js';
import { mapDeviceLease } from '../mappers.js';

/**
 * Create a lease atomically. Locks the node row and rechecks for an active,
 * unexpired lease inside the transaction, so two concurrent requests can't both
 * win (whole-node lease mode). Returns null if the node is already leased.
 */
export async function createLease(params: {
  nodeId: string;
  customerId: string;
  durationSeconds: number;
  gpuIndices?: number[];
  metadata?: Record<string, unknown>;
}): Promise<DeviceLease | null> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    // Serialize lease creation per node (the node row is the lock).
    await tx`select id from nodes where id = ${params.nodeId} for update`;
    const active = await tx`
      select 1 from device_leases
      where node_id = ${params.nodeId} and status = 'active' and expires_at > now()
      limit 1`;
    if (active[0]) return null;
    const rows = await tx`
      insert into device_leases (node_id, customer_id, gpu_indices, status, expires_at, metadata)
      values (${params.nodeId}, ${params.customerId},
              ${tx.json(toJson(params.gpuIndices ?? []))}, 'active',
              now() + (${params.durationSeconds} * interval '1 second'),
              ${params.metadata ? tx.json(toJson(params.metadata)) : null})
      returning *`;
    return mapDeviceLease(rows[0]!);
  });
}

export async function getLease(id: string): Promise<DeviceLease | null> {
  const sql = getSql();
  const rows = await sql`select * from device_leases where id = ${id}`;
  return rows[0] ? mapDeviceLease(rows[0]) : null;
}

/** Active, unexpired leases on a node — used to reject double-leasing a box. */
export async function listActiveLeasesForNode(nodeId: string): Promise<DeviceLease[]> {
  const sql = getSql();
  const rows = await sql`
    select * from device_leases
    where node_id = ${nodeId} and status = 'active' and expires_at > now()
    order by started_at desc`;
  return rows.map(mapDeviceLease);
}

/** All active, unexpired leases across the fleet (the allocation snapshot). */
export async function listActiveLeases(): Promise<DeviceLease[]> {
  const sql = getSql();
  const rows = await sql`
    select * from device_leases
    where status = 'active' and expires_at > now()
    order by started_at desc`;
  return rows.map(mapDeviceLease);
}

/** Recent leases for the operator view: live ones first, then recently ended. */
export async function listLeases(limit = 100): Promise<DeviceLease[]> {
  const sql = getSql();
  const rows = await sql`
    select * from device_leases
    order by (status = 'active' and expires_at > now()) desc, started_at desc
    limit ${limit}`;
  return rows.map(mapDeviceLease);
}

/**
 * Release an active lease (operator/customer ends it). Returns the released
 * lease so the caller can meter elapsed device-time. Idempotent: null if it
 * was not active.
 */
export async function releaseLease(id: string): Promise<DeviceLease | null> {
  const sql = getSql();
  const rows = await sql`
    update device_leases set status = 'released', released_at = now()
    where id = ${id} and status = 'active'
    returning *`;
  return rows[0] ? mapDeviceLease(rows[0]) : null;
}

/**
 * Flip leases past their deadline to 'expired', stamping released_at with the
 * deadline (the true end-of-hold). Atomic + idempotent: each row is flipped by
 * exactly one caller, so the returned set can be metered exactly once (the
 * caller records device-time for naturally-expired leases, mirroring release).
 * Returns the rows it flipped.
 */
export async function expireStaleLeases(): Promise<DeviceLease[]> {
  const sql = getSql();
  const rows = await sql`
    update device_leases set status = 'expired', released_at = expires_at
    where status = 'active' and expires_at <= now()
    returning *`;
  return rows.map(mapDeviceLease);
}
