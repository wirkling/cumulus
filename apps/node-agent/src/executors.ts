/** The three v1 workload executors (spec §2). All deterministic; no real ML in
 * 0a. The split_map_merge executor does the *real* per-shard map that the
 * control plane then gathers. */
import { setTimeout as sleep } from 'node:timers/promises';
import type { WorkloadType } from '@cumulus/shared-types';
import { runCpuBenchmark } from './benchmarks.js';
import { applySimLatency, shouldSimFail } from './sim.js';
import { runModelWorkload, MODEL_WORKLOADS } from './models/index.js';

export interface ExecutionResult {
  result: unknown;
  resourceUsage: { cpuSeconds?: number; maxRamMb?: number };
}

/** Deterministic 32-bit hash — the fake "transform" for split_map_merge. */
function hashItem(item: unknown): string {
  const s = typeof item === 'string' ? item : JSON.stringify(item);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function executeJob(
  workloadType: WorkloadType,
  input: Record<string, unknown>,
): Promise<ExecutionResult> {
  await applySimLatency();
  if (shouldSimFail()) {
    throw new Error('simulated job failure (SIM_FAILURE_RATE)');
  }

  // Stage-2 real model workloads run through the model manager.
  if (MODEL_WORKLOADS.has(workloadType)) {
    const { result, cpuSeconds } = await runModelWorkload(workloadType, input);
    return { result, resourceUsage: { cpuSeconds } };
  }

  const start = process.hrtime.bigint();

  switch (workloadType) {
    case 'echo_sleep': {
      const ms = Number(input.ms ?? 0);
      if (ms > 0) await sleep(ms);
      return {
        result: { echo: input.echo ?? null, sleptMs: ms, shardIndex: input._shardIndex ?? 0 },
        resourceUsage: { cpuSeconds: 0 },
      };
    }

    case 'cpu_benchmark': {
      const iterations = Number(input.iterations ?? 20_000_000);
      const bench = runCpuBenchmark(iterations);
      const cpuSeconds = Number(bench.rawResult.ms) / 1000;
      return { result: { score: bench.score, unit: bench.unit }, resourceUsage: { cpuSeconds } };
    }

    case 'split_map_merge': {
      // Map each item in this shard to its hash; preserve order for the merge.
      const items = Array.isArray(input.items) ? (input.items as unknown[]) : [];
      const mapped = items.map(hashItem);
      const cpuSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      return { result: mapped, resourceUsage: { cpuSeconds } };
    }

    default:
      throw new Error(`unknown workload type: ${workloadType as string}`);
  }
}
