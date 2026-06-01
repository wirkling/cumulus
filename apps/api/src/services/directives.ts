/**
 * Transient per-node directive queue (the seam for operator → agent commands).
 *
 * Operator actions (drain/pause/benchmark) enqueue a directive; the node drains
 * its queue on the next heartbeat ack. In-memory is fine for the single-process
 * v1 control plane; a durable queue is deferred (spec §9). The agent stays
 * outbound-only — the control plane never connects to it (spec §3.1).
 */
import type { AgentDirective } from '@cumulus/shared-types';

const pending = new Map<string, AgentDirective[]>();

export function enqueueDirective(nodeId: string, directive: AgentDirective): void {
  const list = pending.get(nodeId) ?? [];
  list.push(directive);
  pending.set(nodeId, list);
}

export function drainDirectives(nodeId: string): AgentDirective[] {
  const list = pending.get(nodeId);
  if (!list || list.length === 0) return [];
  pending.delete(nodeId);
  return list;
}
