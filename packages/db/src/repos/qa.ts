import type {
  QaRun,
  QaResult,
  QaRunStatus,
  QaRunSummary,
  FleetSnapshotNode,
  QaResultMetrics,
} from '@cumulus/shared-types';
import { getSql, toJson } from '../client.js';
import { mapQaRun, mapQaResult } from '../mappers.js';

export async function createQaRun(params: {
  suiteVersion: string;
  envLabel: string;
  fleetSnapshot: FleetSnapshotNode[];
}): Promise<QaRun> {
  const sql = getSql();
  const rows = await sql`
    insert into qa_runs (suite_version, env_label, fleet_snapshot, status)
    values (${params.suiteVersion}, ${params.envLabel}, ${sql.json(toJson(params.fleetSnapshot))}, 'running')
    returning *`;
  return mapQaRun(rows[0]!);
}

export async function finishQaRun(
  id: string,
  status: QaRunStatus,
  summary: QaRunSummary,
): Promise<void> {
  const sql = getSql();
  await sql`
    update qa_runs
    set status = ${status}, summary = ${sql.json(toJson(summary))}, finished_at = now()
    where id = ${id}`;
}

export async function addQaResult(params: {
  runId: string;
  scenarioKey: string;
  useCase: string;
  requestCount: number;
  succeeded: number;
  failed: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyMaxMs?: number;
  throughputPerSec?: number;
  metrics: QaResultMetrics;
}): Promise<QaResult> {
  const sql = getSql();
  const rows = await sql`
    insert into qa_results
      (run_id, scenario_key, use_case, request_count, succeeded, failed,
       latency_p50_ms, latency_p95_ms, latency_max_ms, throughput_per_sec, metrics)
    values
      (${params.runId}, ${params.scenarioKey}, ${params.useCase}, ${params.requestCount},
       ${params.succeeded}, ${params.failed}, ${params.latencyP50Ms ?? null},
       ${params.latencyP95Ms ?? null}, ${params.latencyMaxMs ?? null},
       ${params.throughputPerSec ?? null}, ${sql.json(toJson(params.metrics))})
    returning *`;
  return mapQaResult(rows[0]!);
}

export async function getQaRun(id: string): Promise<QaRun | null> {
  const sql = getSql();
  const rows = await sql`select * from qa_runs where id = ${id}`;
  return rows[0] ? mapQaRun(rows[0]) : null;
}

export async function listQaRuns(limit = 50): Promise<QaRun[]> {
  const sql = getSql();
  const rows = await sql`select * from qa_runs order by started_at desc limit ${limit}`;
  return rows.map(mapQaRun);
}

export async function listQaResults(runId: string): Promise<QaResult[]> {
  const sql = getSql();
  const rows = await sql`select * from qa_results where run_id = ${runId} order by created_at`;
  return rows.map(mapQaResult);
}
