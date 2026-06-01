/** Simulation knobs (spec §11). Inject artificial latency/jitter/failure so the
 * control plane's merge/timeout/partial-result paths are exercised before any
 * hardware exists. All off by default; controlled by SIM_* env vars. */
import { setTimeout as sleep } from 'node:timers/promises';
import { agentConfig } from './config.js';

export async function applySimLatency(): Promise<void> {
  const { latencyMs, jitterMs } = agentConfig.sim;
  if (latencyMs <= 0 && jitterMs <= 0) return;
  const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
  await sleep(latencyMs + jitter);
}

/** Returns true if this job should be made to fail, per SIM_FAILURE_RATE. */
export function shouldSimFail(): boolean {
  const rate = agentConfig.sim.failureRate;
  return rate > 0 && Math.random() < rate;
}
