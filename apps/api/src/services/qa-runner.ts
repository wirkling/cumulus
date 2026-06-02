/**
 * QA orchestrator — runs the standardized suite against the current fleet and
 * stores comparable metrics (latency p50/p95, throughput, node distribution,
 * overflow ratio). Runs in the background; the launch endpoint returns the run
 * id immediately. As the hardware evolves, the same suite produces directly
 * comparable runs.
 */
import type { FastifyBaseLogger } from 'fastify';
import { nodes, qa, orchestration } from '@cumulus/db';
import {
  QA_SUITE_V1,
  type QaScenario,
  type FleetSnapshotNode,
  type QaRunSummary,
  type Request as JobRequest,
} from '@cumulus/shared-types';
import { enqueueRequest } from './submit.js';
import { dispatchPlaceableJobs } from './placement.js';

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]!);
}

async function snapshotFleet(): Promise<FleetSnapshotNode[]> {
  const list = await nodes.listNodes();
  const out: FleetSnapshotNode[] = [];
  for (const n of list) {
    const [loc, benches] = await Promise.all([
      n.locationId ? nodes.getLocation(n.locationId) : Promise.resolve(null),
      nodes.listBenchmarksForNode(n.id),
    ]);
    const cpu = benches.find((b) => b.benchmarkType === 'cpu' && b.status === 'completed');
    out.push({
      nodeId: n.id,
      name: n.name,
      nodeType: n.nodeType,
      city: loc?.city,
      cpuBenchmark: cpu?.score,
    });
  }
  return out;
}

/** Expand a scenario's input template into a concrete per-request input. */
function buildInput(scenario: QaScenario): Record<string, unknown> {
  const input = { ...scenario.input };
  if (scenario.workloadType === 'split_map_merge' && typeof input.itemCount === 'number') {
    const n = input.itemCount;
    delete input.itemCount;
    input.items = Array.from({ length: n }, (_, i) => `qa-item-${i}`);
  }
  return input;
}

async function runScenario(
  runId: string,
  customerId: string,
  scenario: QaScenario,
  log: FastifyBaseLogger,
): Promise<void> {
  const startMs = Date.now();

  // Build a real burst: enqueue all requests, then a single dispatch pass.
  const created = await Promise.all(
    Array.from({ length: scenario.requestCount }, () =>
      enqueueRequest({
        workloadType: scenario.workloadType,
        fanOut: scenario.fanOut,
        originLocation: scenario.origin,
        mergeStrategy: scenario.mergeStrategy,
        completionPolicy: scenario.completionPolicy,
        onPartial: 'return_partial',
        timeoutSeconds: scenario.timeoutSeconds,
        input: buildInput(scenario),
        customerId,
        qaRunId: runId,
      }).catch(() => null),
    ),
  );
  const ids = created.filter((r): r is JobRequest => r !== null).map((r) => r.id);
  await dispatchPlaceableJobs(log);

  // Poll until all reach a terminal state (background sweeps drive completion).
  const deadline = Date.now() + (scenario.timeoutSeconds + 30) * 1000;
  let requests: JobRequest[] = [];
  for (;;) {
    requests = await orchestration.getRequestsByIds(ids);
    const pending = requests.filter((r) => !TERMINAL.has(r.status));
    if (pending.length === 0 || Date.now() > deadline) break;
    await sleep(1000);
  }
  const wallClockMs = Date.now() - startMs;

  // Latency per request = terminal time − created time.
  const latencies = requests
    .filter((r) => TERMINAL.has(r.status))
    .map((r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);

  const succeeded = requests.filter((r) => r.status === 'completed' || r.status === 'partial').length;
  const failed = requests.filter((r) => r.status === 'failed').length;

  const perNodeJobs = await orchestration.nodeDistributionForRequests(ids);
  const totalJobs = Object.values(perNodeJobs).reduce((a, b) => a + b, 0);
  const busiest = Math.max(0, ...Object.values(perNodeJobs));
  const overflowRatio = totalJobs > 0 ? Math.round((1 - busiest / totalJobs) * 100) / 100 : 0;

  // A few real merged outputs so the test user sees actual work product back.
  const sampleResults = requests.slice(0, 3).map((r) => ({
    requestId: r.id,
    status: r.status,
    mergedResult: r.mergedResult ?? null,
  }));

  await qa.addQaResult({
    runId,
    scenarioKey: scenario.key,
    useCase: scenario.useCase,
    requestCount: ids.length,
    succeeded,
    failed,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    latencyMaxMs: latencies.length ? latencies[latencies.length - 1] : undefined,
    throughputPerSec:
      wallClockMs > 0 ? Math.round((succeeded / (wallClockMs / 1000)) * 100) / 100 : 0,
    metrics: { perNodeJobs, wallClockMs, overflowRatio, sampleResults },
  });

  log.info(
    { runId, scenario: scenario.key, succeeded, failed, p95: percentile(latencies, 95) },
    'QA scenario complete',
  );
}

export interface LaunchQaOptions {
  envLabel: string;
  scenarioKeys?: string[];
  /** The customer this run is attributed to (the test user). */
  customerId?: string;
}

/** Launch a run in the background; returns the run id immediately. */
export async function launchQaRun(opts: LaunchQaOptions, log: FastifyBaseLogger): Promise<string> {
  const fleet = await snapshotFleet();
  const run = await qa.createQaRun({
    suiteVersion: QA_SUITE_V1.version,
    envLabel: opts.envLabel,
    fleetSnapshot: fleet,
    customerId: opts.customerId,
  });
  // Requests are attributed to the owning customer (or an internal QA actor).
  const requestCustomerId = opts.customerId ?? 'qa-internal';

  const scenarios = QA_SUITE_V1.scenarios.filter(
    (s) => !opts.scenarioKeys || opts.scenarioKeys.includes(s.key),
  );

  // Fire-and-forget; the dashboard polls the run for progress.
  void (async () => {
    try {
      for (const scenario of scenarios) {
        await runScenario(run.id, requestCustomerId, scenario, log);
      }
      const results = await qa.listQaResults(run.id);
      const summary: QaRunSummary = {
        scenarios: results.length,
        totalRequests: results.reduce((a, r) => a + r.requestCount, 0),
        totalSucceeded: results.reduce((a, r) => a + r.succeeded, 0),
        totalFailed: results.reduce((a, r) => a + r.failed, 0),
        overallLatencyP95Ms: Math.max(0, ...results.map((r) => r.latencyP95Ms ?? 0)) || undefined,
      };
      await qa.finishQaRun(run.id, 'completed', summary);
      log.info({ runId: run.id }, 'QA run complete');
    } catch (err) {
      log.error({ err, runId: run.id }, 'QA run failed');
      await qa
        .finishQaRun(run.id, 'failed', {
          scenarios: 0,
          totalRequests: 0,
          totalSucceeded: 0,
          totalFailed: 0,
        })
        .catch(() => {});
    }
  })();

  return run.id;
}
