/** Lightweight runtime metrics for heartbeats. Cross-platform via os/fs only. */
import { cpus, freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import type { HeartbeatMetrics } from '@cumulus/shared-types';

interface CpuSnapshot {
  idle: number;
  total: number;
}

function snapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

let prev = snapshot();

/** CPU % since the previous call (so the first heartbeat may read ~0). */
function cpuUsagePct(): number {
  const cur = snapshot();
  const idleDelta = cur.idle - prev.idle;
  const totalDelta = cur.total - prev.total;
  prev = cur;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

async function diskUsagePct(): Promise<number | undefined> {
  try {
    const s = await statfs('/');
    const used = s.blocks - s.bfree;
    return Math.round((used / s.blocks) * 100);
  } catch {
    return undefined;
  }
}

export async function collectMetrics(controlPlaneLatencyMs?: number): Promise<HeartbeatMetrics> {
  return {
    cpuUsagePct: cpuUsagePct(),
    ramUsagePct: Math.round((1 - freemem() / totalmem()) * 100),
    diskUsagePct: await diskUsagePct(),
    controlPlaneLatencyMs,
  };
}
