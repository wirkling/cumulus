/** Benchmark runners (spec §11). Not academic precision — the goal is
 * commercial comparability across heterogeneous nodes. */
import { performance } from 'node:perf_hooks';

export interface BenchmarkResult {
  benchmarkType: 'cpu' | 'network';
  score: number;
  unit: string;
  rawResult: Record<string, unknown>;
}

/**
 * CPU benchmark: a fixed integer-mix workload, scored as iterations/second so
 * results are comparable across machines regardless of absolute duration.
 */
export function runCpuBenchmark(iterations = 20_000_000): BenchmarkResult {
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += (i * 2654435761) % 1000003;
    acc ^= acc >>> 3;
  }
  const ms = performance.now() - start;
  const opsPerSec = Math.round((iterations / ms) * 1000);
  return {
    benchmarkType: 'cpu',
    score: opsPerSec,
    unit: 'ops_per_sec',
    rawResult: { iterations, ms: Math.round(ms), checksum: acc },
  };
}

/**
 * Network benchmark: round-trip latency to the control plane /health endpoint,
 * a few samples. Lower is better, so we store the median latency as the score
 * (the dashboard inverts for "best" comparisons).
 */
export async function runNetworkBenchmark(
  controlPlaneUrl: string,
  samples = 5,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    try {
      await fetch(`${controlPlaneUrl}/health`);
      latencies.push(performance.now() - start);
    } catch {
      latencies.push(Number.NaN);
    }
  }
  const ok = latencies.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const median = ok.length ? ok[Math.floor(ok.length / 2)]! : Number.NaN;
  return {
    benchmarkType: 'network',
    score: Number.isFinite(median) ? Math.round(median * 100) / 100 : 9999,
    unit: 'ms_latency',
    rawResult: {
      samples,
      successes: ok.length,
      minMs: ok[0] ?? null,
      maxMs: ok[ok.length - 1] ?? null,
      packetLossPct: Math.round(((samples - ok.length) / samples) * 100),
    },
  };
}
