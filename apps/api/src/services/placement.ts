/**
 * Placement service — turns queued/retrying jobs into attempts on nodes using
 * the orchestration scorer. Pure scoring lives in @cumulus/orchestration; this
 * glues it to the DB. No Hetzner, no provider assumptions (spec §3.3).
 */
import type { FastifyBaseLogger } from 'fastify';
import { nodes, orchestration } from '@cumulus/db';
import { selectNode, type PlacementCandidate } from '@cumulus/orchestration';
import type { Request as JobRequest } from '@cumulus/shared-types';

/**
 * Try to place every currently-placeable job. Candidate queue lengths are
 * incremented in-loop so shards of one request spread across nodes within a
 * single pass — that's what makes the scatter visible. Jobs with no eligible
 * node are left queued for the next sweep (locality fallback, spec §4.5).
 *
 * Returns the number of jobs placed this pass.
 */
export async function dispatchPlaceableJobs(log: FastifyBaseLogger): Promise<number> {
  const jobs = await orchestration.listPlaceableJobs();
  if (jobs.length === 0) return 0;

  const candidates = await nodes.getPlacementCandidates();
  const byId = new Map<string, PlacementCandidate>(candidates.map((c) => [c.nodeId, c]));
  const requestCache = new Map<string, JobRequest | null>();
  let placed = 0;

  for (const job of jobs) {
    let req = requestCache.get(job.requestId);
    if (req === undefined) {
      req = await orchestration.getRequest(job.requestId);
      requestCache.set(job.requestId, req);
    }
    if (!req) continue;

    const best = selectNode(candidates, {
      workloadType: job.workloadType,
      origin: req.originLocation,
      requiredCapabilities: job.requiredCapabilities,
    });
    if (!best) continue; // nothing eligible right now — retry next sweep

    const attempt = await orchestration.placeJobOnNode({
      jobId: job.id,
      nodeId: best.nodeId,
      timeoutSeconds: job.timeoutSeconds,
      placementDistanceKm: best.distanceKm,
      placementScore: best.score,
    });
    if (attempt) {
      placed++;
      // Reflect the new load so the next shard in this pass prefers a freer node.
      const c = byId.get(best.nodeId);
      if (c) c.queueLength += 1;
    }
  }

  if (placed > 0) log.info({ placed, considered: jobs.length }, 'dispatched jobs');
  return placed;
}
