import type {
  UsageEvent,
  UsageEventType,
  OperatorAction,
  OperatorActionType,
} from '@cumulus/shared-types';
import { getSql, toJson } from '../client.js';
import { mapUsageEvent, mapOperatorAction } from '../mappers.js';

// ─── Usage events (raw economics data; no billing in v1, spec §9) ────────────

export async function insertUsageEvent(params: {
  jobId?: string;
  requestId?: string;
  nodeId: string;
  customerId?: string;
  eventType: UsageEventType;
  quantity: number;
  unit: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sql = getSql();
  await sql`
    insert into usage_events (job_id, request_id, node_id, customer_id, event_type, quantity, unit, metadata)
    values (${params.jobId ?? null}, ${params.requestId ?? null}, ${params.nodeId},
            ${params.customerId ?? null}, ${params.eventType}, ${params.quantity}, ${params.unit},
            ${params.metadata ? sql.json(toJson(params.metadata)) : null})`;
}

export async function listUsageEventsForNode(nodeId: string, limit = 100): Promise<UsageEvent[]> {
  const sql = getSql();
  const rows = await sql`
    select * from usage_events where node_id = ${nodeId}
    order by occurred_at desc limit ${limit}`;
  return rows.map(mapUsageEvent);
}

// ─── Operator actions (audit log, spec §10.3 / §14.1) ────────────────────────

export async function insertOperatorAction(params: {
  actionType: OperatorActionType;
  targetType: OperatorAction['targetType'];
  targetId: string;
  actor: string;
  metadata?: Record<string, unknown>;
}): Promise<OperatorAction> {
  const sql = getSql();
  const rows = await sql`
    insert into operator_actions (action_type, target_type, target_id, actor, metadata)
    values (${params.actionType}, ${params.targetType}, ${params.targetId}, ${params.actor},
            ${params.metadata ? sql.json(toJson(params.metadata)) : null})
    returning *`;
  return mapOperatorAction(rows[0]!);
}

export async function listOperatorActions(limit = 100): Promise<OperatorAction[]> {
  const sql = getSql();
  const rows = await sql`select * from operator_actions order by created_at desc limit ${limit}`;
  return rows.map(mapOperatorAction);
}

// ─── Per-node dashboard stats ────────────────────────────────────────────────

export interface NodeStats {
  jobsCompletedToday: number;
  failureRatePct: number;
}

/**
 * Today's completed/failed attempt counts per node (UTC day), for the node
 * overview table. Returns a map keyed by nodeId.
 */
export async function getNodeStats(): Promise<Map<string, NodeStats>> {
  const sql = getSql();
  const rows = await sql<
    { node_id: string; completed: number; failed: number }[]
  >`
    select
      node_id,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where status in ('failed','timed_out'))::int as failed
    from job_attempts
    where created_at >= date_trunc('day', now())
    group by node_id`;
  const map = new Map<string, NodeStats>();
  for (const r of rows) {
    const total = r.completed + r.failed;
    map.set(r.node_id, {
      jobsCompletedToday: r.completed,
      failureRatePct: total > 0 ? Math.round((r.failed / total) * 100) : 0,
    });
  }
  return map;
}
