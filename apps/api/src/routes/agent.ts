/** Agent-facing endpoints (spec §7). All token-authenticated; register is
 * gated by the bootstrap token. The agent is outbound-only — every interaction
 * is initiated by the node (spec §3.1). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nodes, orchestration, events } from '@cumulus/db';
import type {
  RegisterResponse,
  HeartbeatResponse,
  PollResponse,
  DispatchedJob,
} from '@cumulus/shared-types';
import { config } from '../config.js';
import { authenticateAgent, authenticateBootstrap, mintToken, hashToken } from '../auth.js';
import { parseOr400 } from '../validate.js';
import { drainDirectives } from '../services/directives.js';
import { dispatchPlaceableJobs } from '../services/placement.js';
import { finalizeRequest } from '../services/completion.js';

const capabilitySchema = z
  .object({
    cpuModel: z.string().optional(),
    cpuCores: z.number().optional(),
    cpuThreads: z.number().optional(),
    ramGb: z.number().optional(),
    diskGb: z.number().optional(),
    gpuCount: z.number().optional(),
    gpuModels: z.array(z.string()).optional(),
    gpuVramGb: z.array(z.number()).optional(),
    os: z.string().optional(),
    architecture: z.enum(['x64', 'arm64']).optional(),
    dockerAvailable: z.boolean().optional(),
    cudaAvailable: z.boolean().optional(),
    rocmAvailable: z.boolean().optional(),
    metalAvailable: z.boolean().optional(),
    executors: z.array(z.enum(['embeddings', 'ocr', 'transcription', 'llm'])).optional(),
  })
  .strict();

const registerSchema = z.object({
  nodeName: z.string().min(1),
  nodeType: z.enum(['vpc', 'mac_mini', 'gpu_server', 'edge_appliance']),
  agentVersion: z.string().min(1),
  capabilities: capabilitySchema.optional(),
  location: z
    .object({
      name: z.string().optional(),
      latitude: z.number(),
      longitude: z.number(),
      city: z.string().optional(),
      locationType: z
        .enum(['cloud_region', 'home', 'office', 'ground_floor_shop', 'technical_room', 'commercial_unit'])
        .optional(),
    })
    .optional(),
});

const heartbeatSchema = z.object({
  nodeId: z.string(),
  status: z.enum(['provisioning', 'online', 'offline', 'draining', 'maintenance', 'disabled']),
  metrics: z
    .object({
      cpuUsagePct: z.number().optional(),
      ramUsagePct: z.number().optional(),
      diskUsagePct: z.number().optional(),
      temperatureC: z.number().optional(),
      controlPlaneLatencyMs: z.number().optional(),
    })
    .default({}),
});

const capabilitiesSchema = z.object({ nodeId: z.string(), capabilities: capabilitySchema });
const pollSchema = z.object({ nodeId: z.string() });
const completeSchema = z.object({
  nodeId: z.string(),
  result: z.unknown(),
  resourceUsage: z.record(z.unknown()).optional(),
  exitCode: z.number().optional(),
});
const failSchema = z.object({
  nodeId: z.string(),
  errorMessage: z.string(),
  exitCode: z.number().optional(),
  resourceUsage: z.record(z.unknown()).optional(),
});
const benchmarkSchema = z.object({
  nodeId: z.string(),
  benchmarkType: z.enum(['cpu', 'memory', 'disk', 'network', 'gpu', 'llm_inference', 'embedding', 'custom']),
  score: z.number().optional(),
  unit: z.string().optional(),
  rawResult: z.record(z.unknown()).default({}),
  status: z.enum(['completed', 'failed']),
  errorMessage: z.string().optional(),
});

export function registerAgentRoutes(app: FastifyInstance): void {
  // ── Register ──────────────────────────────────────────────────────────────
  app.post('/api/agent/register', { preHandler: authenticateBootstrap }, async (req, reply) => {
    const body = parseOr400(registerSchema, req.body, reply);
    if (!body) return;

    // Resolve / create the node's location from its self-declaration. The
    // control plane stays provider-neutral: it just stores lat/long + label.
    let locationId: string | undefined;
    if (body.location) {
      const name = body.location.name ?? `${body.nodeName}-loc`;
      const existing = await nodes.findLocationByName(name);
      locationId =
        existing?.id ??
        (
          await nodes.createLocation({
            name,
            locationType: body.location.locationType ?? 'cloud_region',
            latitude: body.location.latitude,
            longitude: body.location.longitude,
            city: body.location.city,
          })
        ).id;
    }

    const token = mintToken();
    const node = await nodes.createNode({
      name: body.nodeName,
      nodeType: body.nodeType,
      agentVersion: body.agentVersion,
      locationId,
      tokenHash: hashToken(token),
    });
    if (body.capabilities) await nodes.upsertCapabilities(node.id, body.capabilities);

    req.log.info({ nodeId: node.id, name: node.name }, 'node registered');
    const res: RegisterResponse = {
      nodeId: node.id,
      agentToken: token,
      config: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSeconds,
        jobPollIntervalSeconds: config.jobPollIntervalSeconds,
        benchmarksEnabled: true,
      },
    };
    return reply.code(201).send(res);
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  app.post('/api/agent/heartbeat', { preHandler: authenticateAgent }, async (req, reply) => {
    const body = parseOr400(heartbeatSchema, req.body, reply);
    if (!body) return;
    await nodes.recordHeartbeat(body.nodeId, body.status, body.metrics ?? {});
    const res: HeartbeatResponse = { ok: true, directives: drainDirectives(body.nodeId) };
    return reply.send(res);
  });

  // ── Capabilities ──────────────────────────────────────────────────────────
  app.post('/api/agent/capabilities', { preHandler: authenticateAgent }, async (req, reply) => {
    const body = parseOr400(capabilitiesSchema, req.body, reply);
    if (!body) return;
    await nodes.upsertCapabilities(body.nodeId, body.capabilities);
    return reply.send({ ok: true });
  });

  // ── Poll for a job ────────────────────────────────────────────────────────
  app.post('/api/agent/jobs/poll', { preHandler: authenticateAgent }, async (req, reply) => {
    const body = parseOr400(pollSchema, req.body, reply);
    if (!body) return;
    const claimed = await orchestration.claimNextAttemptForNode(body.nodeId);
    if (!claimed) return reply.send({ jobAvailable: false } satisfies PollResponse);

    const job: DispatchedJob = {
      jobId: claimed.job.id,
      attemptId: claimed.attempt.id,
      workloadType: claimed.job.workloadType,
      input: claimed.job.input,
      timeoutSeconds: claimed.job.timeoutSeconds,
    };
    return reply.send({ jobAvailable: true, job } satisfies PollResponse);
  });

  // ── Job lifecycle: start / complete / fail ──────────────────────────────────
  app.post<{ Params: { attemptId: string } }>(
    '/api/agent/jobs/:attemptId/start',
    { preHandler: authenticateAgent },
    async (req, reply) => {
      await orchestration.markAttemptStarted(req.params.attemptId);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { attemptId: string } }>(
    '/api/agent/jobs/:attemptId/complete',
    { preHandler: authenticateAgent },
    async (req, reply) => {
      const body = parseOr400(completeSchema, req.body, reply);
      if (!body) return;
      const res = await orchestration.completeAttempt({
        attemptId: req.params.attemptId,
        result: body.result,
        resourceUsage: body.resourceUsage,
        exitCode: body.exitCode,
      });
      if (res) {
        // Raw economics data (no billing in v1, spec §9).
        await events.insertUsageEvent({
          jobId: res.jobId,
          requestId: res.requestId,
          nodeId: body.nodeId,
          eventType: 'job_completed',
          quantity: 1,
          unit: 'job',
        });
        const cpuSeconds = Number((body.resourceUsage as { cpuSeconds?: number } | undefined)?.cpuSeconds);
        if (Number.isFinite(cpuSeconds) && cpuSeconds > 0) {
          await events.insertUsageEvent({
            jobId: res.jobId,
            requestId: res.requestId,
            nodeId: body.nodeId,
            eventType: 'cpu_seconds',
            quantity: cpuSeconds,
            unit: 's',
          });
        }
        await finalizeRequest(res.requestId, req.log);
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { attemptId: string } }>(
    '/api/agent/jobs/:attemptId/fail',
    { preHandler: authenticateAgent },
    async (req, reply) => {
      const body = parseOr400(failSchema, req.body, reply);
      if (!body) return;
      const res = await orchestration.failAttempt({
        attemptId: req.params.attemptId,
        errorMessage: body.errorMessage,
        exitCode: body.exitCode,
      });
      if (res) {
        req.log.warn(
          { attemptId: req.params.attemptId, jobStatus: res.jobStatus },
          'job attempt failed',
        );
        await dispatchPlaceableJobs(req.log); // re-place if retrying
        await finalizeRequest(res.requestId, req.log);
      }
      return reply.send({ ok: true });
    },
  );

  // ── Submit benchmark result ─────────────────────────────────────────────────
  app.post('/api/agent/benchmarks', { preHandler: authenticateAgent }, async (req, reply) => {
    const body = parseOr400(benchmarkSchema, req.body, reply);
    if (!body) return;
    await nodes.insertBenchmark({
      nodeId: body.nodeId,
      benchmarkType: body.benchmarkType,
      score: body.score,
      unit: body.unit,
      rawResult: body.rawResult ?? {},
      status: body.status,
      errorMessage: body.errorMessage,
    });
    return reply.send({ ok: true });
  });
}
