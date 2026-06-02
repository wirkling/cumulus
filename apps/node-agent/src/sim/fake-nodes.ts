/**
 * Simulation harness — register N in-memory fake nodes that heartbeat, poll, and
 * execute jobs, so the full scatter/gather loop can be demoed before any
 * hardware exists (spec §11.b). Identities are NOT persisted (no state file);
 * each run creates fresh nodes.
 *
 * Usage:
 *   CONTROL_PLANE_URL=http://localhost:8080 AGENT_BOOTSTRAP_TOKEN=xxx \
 *   tsx src/sim/fake-nodes.ts [count]
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { ControlPlaneClient } from '../client.js';
import { executeJob } from '../executors.js';
import { log } from '../log.js';

const baseUrl = (process.env.CONTROL_PLANE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const bootstrap = process.env.AGENT_BOOTSTRAP_TOKEN ?? '';
const count = Number(process.argv[2] ?? 3);

// Spread fake nodes across real-ish EU locations so locality scoring is visible.
const LOCATIONS = [
  { name: 'sim-falkenstein', latitude: 50.4779, longitude: 12.3713, city: 'Falkenstein' },
  { name: 'sim-helsinki', latitude: 60.1699, longitude: 24.9384, city: 'Helsinki' },
  { name: 'sim-nuremberg', latitude: 49.4521, longitude: 11.0767, city: 'Nuremberg' },
  { name: 'sim-berlin', latitude: 52.52, longitude: 13.405, city: 'Berlin' },
];

async function runFakeNode(i: number): Promise<void> {
  const loc = LOCATIONS[i % LOCATIONS.length]!;
  const client = new ControlPlaneClient(baseUrl, bootstrap);
  const res = await client.register({
    nodeName: `sim-node-${i}-${loc.city}`,
    nodeType: 'vpc',
    agentVersion: 'sim-0.1.0',
    capabilities: {
      cpuCores: 2 + (i % 4),
      ramGb: 4,
      architecture: 'x64',
      os: 'sim',
      executors: ['embeddings', 'ocr', 'transcription', 'llm'],
    },
    location: loc,
  });
  client.setIdentity(res.nodeId, res.agentToken);
  log.info('fake node registered', { name: `sim-node-${i}`, nodeId: res.nodeId });

  // Heartbeat loop
  void (async () => {
    for (;;) {
      try {
        await client.heartbeat('online', { cpuUsagePct: Math.round(Math.random() * 60), ramUsagePct: 50 });
      } catch (err) {
        log.warn('sim heartbeat failed', { i, err: String(err) });
      }
      await sleep(res.config.heartbeatIntervalSeconds * 1000);
    }
  })();

  // Poll + execute loop
  void (async () => {
    for (;;) {
      try {
        const poll = await client.poll();
        if (poll.jobAvailable && poll.job) {
          await client.startJob(poll.job.attemptId);
          try {
            const { result, resourceUsage } = await executeJob(poll.job.workloadType, poll.job.input);
            await client.completeJob(poll.job.attemptId, result, resourceUsage);
          } catch (err) {
            await client.failJob(poll.job.attemptId, String(err));
          }
        }
      } catch (err) {
        log.warn('sim poll failed', { i, err: String(err) });
      }
      await sleep(res.config.jobPollIntervalSeconds * 1000);
    }
  })();
}

async function main(): Promise<void> {
  if (!bootstrap) throw new Error('AGENT_BOOTSTRAP_TOKEN is required');
  log.info('starting fake nodes', { count, baseUrl });
  await Promise.all(Array.from({ length: count }, (_, i) => runFakeNode(i)));
  log.info('fake nodes running — Ctrl-C to stop');
  // Keep the process alive.
  await new Promise(() => {});
}

main().catch((err) => {
  log.error('fake-nodes failed', { err: String(err) });
  process.exit(1);
});
