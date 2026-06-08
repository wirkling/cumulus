/**
 * Background sweeps — the persistent loops that make distributed failure safe
 * (spec §4.2). Plain setInterval workers in the API process; no external queue
 * in v1 (spec §4.1). Each sweep is defensive: a thrown error is logged, never
 * fatal.
 */
import type { FastifyInstance } from 'fastify';
import { nodes, orchestration } from '@cumulus/db';
import { config } from '../config.js';
import { dispatchPlaceableJobs } from './placement.js';
import { finalizeRequest } from './completion.js';
import { expireDueLeases } from './leases.js';

/** Detect nodes that stopped heart-beating; fail their in-flight attempts. */
async function offlineSweep(app: FastifyInstance): Promise<void> {
  const flipped = await nodes.markStaleNodesOffline(config.offlineThresholdSeconds);
  if (flipped.length === 0) return;
  app.log.warn({ nodeIds: flipped }, 'nodes marked offline (stale heartbeat)');

  const attempts = await orchestration.listActiveAttemptsForNodes(flipped);
  const affected = new Set<string>();
  for (const a of attempts) {
    const res = await orchestration.failAttempt({
      attemptId: a.id,
      errorMessage: 'node went offline mid-job',
    });
    if (res) affected.add(res.requestId);
  }
  await dispatchPlaceableJobs(app.log); // re-place freed shards elsewhere
  for (const rid of affected) await finalizeRequest(rid, app.log);
}

/** Fail attempts past their deadline; finalise any requests past their timeout. */
async function timeoutSweep(app: FastifyInstance): Promise<void> {
  const expired = await orchestration.listExpiredAttempts();
  const affected = new Set<string>();
  for (const a of expired) {
    const res = await orchestration.failAttempt({
      attemptId: a.id,
      errorMessage: 'attempt deadline exceeded',
      timedOut: true,
    });
    if (res) affected.add(res.requestId);
  }
  if (expired.length > 0) {
    app.log.warn({ count: expired.length }, 'attempts timed out');
    await dispatchPlaceableJobs(app.log);
  }
  // Evaluate every active request so request-level timeouts fire even when jobs
  // are stuck unplaced (no expired attempt to trigger them).
  const active = await orchestration.listActiveRequests();
  for (const r of active) affected.add(r.id);
  for (const rid of affected) await finalizeRequest(rid, app.log);
}

async function dispatchSweep(app: FastifyInstance): Promise<void> {
  await dispatchPlaceableJobs(app.log);
}

/** Expire Model-A leases past their deadline and meter their device-time, so a
 * lease that runs to natural expiry records usage even if no one releases it
 * and frees the node for hosted work. Idempotent. */
async function leaseSweep(app: FastifyInstance): Promise<void> {
  await expireDueLeases(app.log);
}

const guard =
  (app: FastifyInstance, name: string, fn: (a: FastifyInstance) => Promise<void>) =>
  () =>
    fn(app).catch((err) => app.log.error({ err, sweep: name }, 'sweep failed'));

/** Start all sweeps; returns a stop function for graceful shutdown. */
export function startSweeps(app: FastifyInstance): () => void {
  const timers = [
    setInterval(guard(app, 'offline', offlineSweep), config.offlineSweepSeconds * 1000),
    setInterval(guard(app, 'timeout', timeoutSweep), config.timeoutSweepSeconds * 1000),
    setInterval(guard(app, 'dispatch', dispatchSweep), config.dispatchSweepSeconds * 1000),
    setInterval(guard(app, 'lease', leaseSweep), config.timeoutSweepSeconds * 1000),
  ];
  for (const t of timers) t.unref?.();
  app.log.info(
    {
      offlineSweepSeconds: config.offlineSweepSeconds,
      timeoutSweepSeconds: config.timeoutSweepSeconds,
      dispatchSweepSeconds: config.dispatchSweepSeconds,
    },
    'background sweeps started',
  );
  return () => timers.forEach(clearInterval);
}
