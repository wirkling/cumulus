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
  /** NVLink-connected card-index sets usable as one tensor-parallel worker, e.g.
   * [[0,1,2,3]]. Only groups of >= 2 cards are reported. Empty/absent = all
   * cards are independent single-card workers. */
  tpGroups?: number[][];
}

/**
 * Detect tensor-parallel-capable GPU groups from `nvidia-smi topo -m`: cards
 * that are mutually NVLink-connected (cells like `NV12`) form one logical
 * worker. We parse the link matrix into an undirected NVLink graph and return
 * its connected components of size >= 2. PCIe-only paths (PIX/PHB/SYS/NODE) do
 * NOT qualify — the doc treats NVLink as the signal for an in-box TP group.
 */
async function queryGpuTopology(count: number): Promise<number[][]> {
  if (count < 2) return []; // a single card is never a TP group
  try {
    const { stdout } = await exec('nvidia-smi', ['topo', '-m'], { timeout: 4000 });
    const adj = new Map<number, Set<number>>();
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/);
      const m = parts[0]?.match(/^GPU(\d+)$/);
      if (!m) continue;
      const i = Number(m[1]);
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const cell = parts[1 + j];
        if (cell && /^NV\d+$/.test(cell)) {
          if (!adj.has(i)) adj.set(i, new Set());
          adj.get(i)!.add(j);
        }
      }
    }
    // Connected components of the NVLink graph; keep groups of >= 2 cards.
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const stack = [start];
      const comp: number[] = [];
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        comp.push(n);
        for (const nb of adj.get(n) ?? []) if (!seen.has(nb)) stack.push(nb);
      }
      if (comp.length >= 2) groups.push(comp.sort((a, b) => a - b));
    }
    return groups.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  } catch {
    return []; // topo unavailable / parse failure → treat as no TP group
  }
}

// Cache the presence check so CPU nodes don't re-spawn nvidia-smi every heartbeat.
let hasGpu: boolean | undefined;

export async function queryGpuInfo(): Promise<GpuInfo | null> {
  const rows = await smi('name,memory.total');
  hasGpu = !!(rows && rows.length > 0);
  if (!hasGpu) return null;
  const count = rows!.length;
  const tpGroups = await queryGpuTopology(count);
  return {
    count,
    models: rows!.map((r) => r[0] ?? 'unknown'),
    vramGb: rows!.map((r) => Math.round(Number(r[1] ?? 0) / 1024)),
    tpGroups: tpGroups.length > 0 ? tpGroups : undefined,
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
