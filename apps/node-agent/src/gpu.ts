/** GPU probing via nvidia-smi. Returns null when there's no NVIDIA GPU (the
 * normal case on the CPU fleet) — callers treat that as "no GPU". */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function smi(query: string): Promise<string[][] | null> {
  try {
    const { stdout } = await exec(
      'nvidia-smi',
      [`--query-gpu=${query}`, '--format=csv,noheader,nounits'],
      { timeout: 4000 },
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(',').map((s) => s.trim()));
  } catch {
    return null; // no nvidia-smi / no GPU
  }
}

export interface GpuInfo {
  count: number;
  models: string[];
  vramGb: number[];
}

// Cache the presence check so CPU nodes don't re-spawn nvidia-smi every heartbeat.
let hasGpu: boolean | undefined;

export async function queryGpuInfo(): Promise<GpuInfo | null> {
  const rows = await smi('name,memory.total');
  hasGpu = !!(rows && rows.length > 0);
  if (!hasGpu) return null;
  return {
    count: rows!.length,
    models: rows!.map((r) => r[0] ?? 'unknown'),
    vramGb: rows!.map((r) => Math.round(Number(r[1] ?? 0) / 1024)),
  };
}

export interface GpuMetrics {
  gpuUsagePct?: number;
  gpuMemUsedMb?: number;
  gpuTempC?: number;
  gpuPowerW?: number;
}

export async function queryGpuMetrics(): Promise<GpuMetrics | null> {
  if (hasGpu === false) return null; // known CPU-only node — skip the spawn
  const rows = await smi('utilization.gpu,memory.used,temperature.gpu,power.draw');
  if (!rows || rows.length === 0) return null;
  // Aggregate across GPUs: max util/temp, summed mem + power.
  const nums = rows.map((r) => r.map((v) => Number(v)));
  return {
    gpuUsagePct: Math.max(...nums.map((n) => n[0] ?? 0)),
    gpuMemUsedMb: Math.round(nums.reduce((a, n) => a + (n[1] ?? 0), 0)),
    gpuTempC: Math.max(...nums.map((n) => n[2] ?? 0)),
    gpuPowerW: Math.round(nums.reduce((a, n) => a + (n[3] ?? 0), 0)),
  };
}
