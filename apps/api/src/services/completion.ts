/**
 * Completion service — evaluates a request's completion policy, merges the
 * surviving shard results, and finalises the request. Called on every job
 * complete/fail and by the timeout sweep. Idempotent: terminal requests are
 * skipped.
 */
import type { FastifyBaseLogger } from 'fastify';
import { orchestration } from '@cumulus/db';
import {
  evaluateCompletion,
  mergeResults,
  type JobState,
} from '@cumulus/orchestration';
import type { JobStatus } from '@cumulus/shared-types';

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);

function toJobState(status: JobStatus): JobState['status'] {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending'; // queued | assigned | running | retrying
}

export async function finalizeRequest(
  requestId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const req = await orchestration.getRequest(requestId);
  if (!req || TERMINAL.has(req.status)) return;

  const jobs = await orchestration.listJobsForRequest(requestId);
  if (jobs.length === 0) return;

  const jobStates: JobState[] = jobs.map((j) => ({
    jobId: j.id,
    shardIndex: j.shardIndex,
    status: toJobState(j.status),
  }));

  const timedOut =
    Date.now() > new Date(req.createdAt).getTime() + req.timeoutSeconds * 1000;

  let decision;
  try {
    decision = evaluateCompletion({
      policy: req.completionPolicy,
      onPartial: req.onPartial,
      quorum: req.quorum,
      jobs: jobStates,
      timedOut,
    });
  } catch (err) {
    // The hedging seam throws by design; never crash the sweep on it.
    log.error({ err, requestId, policy: req.completionPolicy }, 'completion evaluation failed');
    return;
  }

  if (!decision.done) return;
  const status = decision.status ?? 'failed';

  const shards = jobs
    .filter(
      (j) =>
        decision.includeShards.includes(j.shardIndex) &&
        j.result !== undefined &&
        j.result !== null,
    )
    .map((j) => ({ shardIndex: j.shardIndex, result: j.result }));

  const merged = status === 'failed' ? null : mergeResults(req.mergeStrategy, shards);

  await orchestration.setRequestResult(req.id, status, merged);

  // Abandon still-pending siblings (e.g. quorum met) — the hedging seam path.
  for (const jobId of decision.cancelJobIds) {
    await orchestration.setJobStatus(jobId, 'cancelled');
  }

  log.info(
    { requestId, status: decision.status, reason: decision.reason, shards: shards.length },
    'request finalised',
  );
}
