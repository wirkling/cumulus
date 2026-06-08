/** Operator endpoints (spec §7). Guarded by the operator API key. Drive the
 * dashboard's node overview/detail and manual controls; every mutating action
 * is recorded in the operator_actions audit log (spec §14.1). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nodes, orchestration, events, customers, leases, qa } from '@cumulus/db';
import type {
  Node,
  NodeStatus,
  NodeSummary,
  NodeDetail,
  CustomerWithKey,
  LeaseView,
  FleetAllocation,
  AllocationNode,
  ActiveJobAllocation,
  QaRunDetail,
} from '@cumulus/shared-types';
import { QA_SUITE } from '@cumulus/shared-types';
import { authenticateOperator, mintCustomerKey } from '../auth.js';
import { parseOr400 } from '../validate.js';
import { enqueueDirective } from '../services/directives.js';
import { dispatchPlaceableJobs } from '../services/placement.js';
import { createLease, releaseLease, expireDueLeases } from '../services/leases.js';
import { launchQaRun } from '../services/qa-runner.js';

const ACTOR = 'operator'; // single operator identity in v1

async function toSummary(
  node: Node,
  stats: Map<string, { jobsCompletedToday: number; failureRatePct: number }>,
): Promise<NodeSummary> {
  const [location, capability, queueLength, latestMetrics] = await Promise.all([
    node.locationId ? nodes.getLocation(node.locationId) : Promise.resolve(null),
    nodes.getCapabilities(node.id),
    orchestration.queueLengthForNode(node.id),
    nodes.latestMetrics(node.id),
  ]);
  const s = stats.get(node.id);
  return {
    ...node,
    location: location ?? undefined,
    capability: capability ?? undefined,
    queueLength,
    jobsCompletedToday: s?.jobsCompletedToday ?? 0,
    failureRatePct: s?.failureRatePct ?? 0,
    latestMetrics,
  };
}

const listFilterSchema = z.object({
  status: z
    .enum(['provisioning', 'online', 'offline', 'draining', 'maintenance', 'disabled'])
    .optional(),
  locationId: z.string().optional(),
});

export function registerOperatorRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/operator')) await authenticateOperator(req, reply);
  });

  // ── Nodes ───────────────────────────────────────────────────────────────────
  app.get('/api/operator/nodes', async (req, reply) => {
    const filters = parseOr400(listFilterSchema, req.query, reply);
    if (!filters) return;
    const list = await nodes.listNodes(filters);
    const stats = await events.getNodeStats();
    const summaries = await Promise.all(list.map((n) => toSummary(n, stats)));
    return reply.send(summaries);
  });

  app.get<{ Params: { id: string } }>('/api/operator/nodes/:id', async (req, reply) => {
    const node = await nodes.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: 'not_found', message: 'node not found' });
    const stats = await events.getNodeStats();
    const summary = await toSummary(node, stats);
    const [benchmarks, recentAttempts] = await Promise.all([
      nodes.listBenchmarksForNode(node.id),
      orchestration.recentAttemptsForNode(node.id),
    ]);
    const detail: NodeDetail = { ...summary, benchmarks, recentAttempts };
    return reply.send(detail);
  });

  // ── Manual controls (audited) ────────────────────────────────────────────────
  const control = (
    path: string,
    status: NodeStatus,
    actionType: 'pause_node' | 'drain_node' | 'disable_node',
  ) =>
    app.post<{ Params: { id: string } }>(path, async (req, reply) => {
      const node = await nodes.getNode(req.params.id);
      if (!node) return reply.code(404).send({ error: 'not_found', message: 'node not found' });
      await nodes.setNodeStatus(node.id, status);
      enqueueDirective(node.id, { type: status === 'draining' ? 'drain' : 'pause' });
      await events.insertOperatorAction({
        actionType,
        targetType: 'node',
        targetId: node.id,
        actor: ACTOR,
      });
      req.log.info({ nodeId: node.id, status }, 'operator changed node status');
      return reply.send({ ok: true, status });
    });

  control('/api/operator/nodes/:id/pause', 'maintenance', 'pause_node');
  control('/api/operator/nodes/:id/drain', 'draining', 'drain_node');
  control('/api/operator/nodes/:id/disable', 'disabled', 'disable_node');

  app.post<{ Params: { id: string } }>('/api/operator/nodes/:id/benchmark', async (req, reply) => {
    const node = await nodes.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: 'not_found', message: 'node not found' });
    enqueueDirective(node.id, { type: 'run_benchmark', benchmarkType: 'cpu' });
    await events.insertOperatorAction({
      actionType: 'trigger_benchmark',
      targetType: 'node',
      targetId: node.id,
      actor: ACTOR,
    });
    return reply.send({ ok: true });
  });

  // ── Requests & jobs ──────────────────────────────────────────────────────────
  app.get('/api/operator/requests', async (_req, reply) => {
    return reply.send(await orchestration.listRequests());
  });

  app.get('/api/operator/jobs', async (_req, reply) => {
    const jobs = await orchestration.listRecentJobs();
    const attempts = await orchestration.getLatestAttemptsByJob(jobs.map((j) => j.id));
    const nodeList = await nodes.listNodes();
    const nodeNames = new Map(nodeList.map((n) => [n.id, n.name]));
    return reply.send(
      jobs.map((j) => {
        const a = attempts.get(j.id);
        return { ...j, latestAttempt: a, nodeName: a ? nodeNames.get(a.nodeId) : undefined };
      }),
    );
  });

  app.post<{ Params: { id: string } }>('/api/operator/jobs/:id/retry', async (req, reply) => {
    const job = await orchestration.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'not_found', message: 'job not found' });
    await orchestration.setJobStatus(job.id, 'retrying');
    await events.insertOperatorAction({
      actionType: 'retry_job',
      targetType: 'job',
      targetId: job.id,
      actor: ACTOR,
    });
    await dispatchPlaceableJobs(req.log);
    return reply.send({ ok: true });
  });

  // ── Customers (front door key management) ────────────────────────────────────
  const createCustomerSchema = z.object({ name: z.string().min(1).max(120) });

  app.post('/api/operator/customers', async (req, reply) => {
    const body = parseOr400(createCustomerSchema, req.body, reply);
    if (!body) return;
    const { key, hash, prefix } = mintCustomerKey();
    const customer = await customers.createCustomer({
      name: body.name,
      apiKeyHash: hash,
      keyPrefix: prefix,
    });
    // The full key is returned exactly once.
    const res: CustomerWithKey = { ...customer, apiKey: key };
    return reply.code(201).send(res);
  });

  app.get('/api/operator/customers', async (_req, reply) => {
    return reply.send(await customers.listCustomers());
  });

  // ── Device leases (Model A — rent a GPU) ─────────────────────────────────────
  const createLeaseSchema = z.object({
    nodeId: z.string().uuid(),
    customerId: z.string().uuid(),
    durationSeconds: z.number().int().min(1).max(60 * 60 * 24 * 90), // up to 90 days
    gpuIndices: z.array(z.number().int().min(0)).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.post('/api/operator/leases', async (req, reply) => {
    const body = parseOr400(createLeaseSchema, req.body, reply);
    if (!body) return;
    const result = await createLease(body, req.log);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }
    await events.insertOperatorAction({
      actionType: 'create_lease',
      targetType: 'lease',
      targetId: result.lease.id,
      actor: ACTOR,
      metadata: { nodeId: result.lease.nodeId, customerId: result.lease.customerId },
    });
    return reply.code(201).send(result.lease);
  });

  app.get('/api/operator/leases', async (req, reply) => {
    // Refresh stale statuses (and meter them) so the view shows expired as such.
    await expireDueLeases(req.log);
    const [list, nodeList, customerList] = await Promise.all([
      leases.listLeases(),
      nodes.listNodes(),
      customers.listCustomers(),
    ]);
    const nodeNames = new Map(nodeList.map((n) => [n.id, n.name]));
    const customerNames = new Map(customerList.map((c) => [c.id, c.name]));
    const views: LeaseView[] = list.map((l) => ({
      ...l,
      nodeName: nodeNames.get(l.nodeId),
      customerName: customerNames.get(l.customerId),
    }));
    return reply.send(views);
  });

  app.post<{ Params: { id: string } }>('/api/operator/leases/:id/release', async (req, reply) => {
    const released = await releaseLease(req.params.id, req.log);
    if (!released) {
      return reply.code(404).send({ error: 'not_found', message: 'active lease not found' });
    }
    await events.insertOperatorAction({
      actionType: 'release_lease',
      targetType: 'lease',
      targetId: released.id,
      actor: ACTOR,
    });
    return reply.send(released);
  });

  // ── Fleet allocation (who is on which hardware for which model) ───────────────
  app.get('/api/operator/allocation', async (req, reply) => {
    // Free + meter any naturally-expired leases first so the snapshot is honest.
    await expireDueLeases(req.log);
    const [nodeList, locations, customerList, activeLeases, allocations] = await Promise.all([
      nodes.listNodes(),
      nodes.listLocations(),
      customers.listCustomers(),
      leases.listActiveLeases(),
      orchestration.listActiveAllocations(),
    ]);
    const caps = await Promise.all(nodeList.map((n) => nodes.getCapabilities(n.id)));

    const locById = new Map(locations.map((l) => [l.id, l]));
    const nodeNames = new Map(nodeList.map((n) => [n.id, n.name]));
    const customerNames = new Map(customerList.map((c) => [c.id, c.name]));

    const allocNodes: AllocationNode[] = nodeList.map((n, i) => {
      const cap = caps[i];
      const loc = n.locationId ? locById.get(n.locationId) : undefined;
      return {
        id: n.id,
        name: n.name,
        status: n.status,
        city: loc?.city,
        cpuCores: cap?.cpuCores,
        ramGb: cap?.ramGb,
        gpuCount: cap?.gpuCount,
        gpuModels: cap?.gpuModels,
        gpuVramGb: cap?.gpuVramGb,
        tpGroups: cap?.tpGroups,
        executors: cap?.executors,
      };
    });

    const leaseViews: LeaseView[] = activeLeases.map((l) => ({
      ...l,
      nodeName: nodeNames.get(l.nodeId),
      customerName: customerNames.get(l.customerId),
    }));

    const jobViews: ActiveJobAllocation[] = allocations.map((a) => ({
      ...a,
      customerName: a.customerId ? customerNames.get(a.customerId) : undefined,
    }));

    const payload: FleetAllocation = { nodes: allocNodes, leases: leaseViews, jobs: jobViews };
    return reply.send(payload);
  });

  // ── QA / Test Center ─────────────────────────────────────────────────────────
  app.get('/api/operator/qa/suite', async (_req, reply) => reply.send(QA_SUITE));

  const launchSchema = z.object({
    envLabel: z.string().min(1).max(80),
    scenarioKeys: z.array(z.string()).optional(),
    // Run "as" a selected test user (the review UI sets this).
    customerId: z.string().optional(),
  });

  app.post('/api/operator/qa/runs', async (req, reply) => {
    const body = parseOr400(launchSchema, req.body, reply);
    if (!body) return;
    const runId = await launchQaRun(
      { envLabel: body.envLabel, scenarioKeys: body.scenarioKeys, customerId: body.customerId },
      req.log,
    );
    return reply.code(201).send({ runId });
  });

  app.get('/api/operator/qa/runs', async (_req, reply) => {
    return reply.send(await qa.listQaRuns());
  });

  app.get<{ Params: { id: string } }>('/api/operator/qa/runs/:id', async (req, reply) => {
    const run = await qa.getQaRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'not_found', message: 'run not found' });
    const results = await qa.listQaResults(run.id);
    const detail: QaRunDetail = { ...run, results };
    return reply.send(detail);
  });
}
