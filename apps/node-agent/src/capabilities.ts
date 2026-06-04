/** Capability scanner. Reports facts about the host — never assumes a platform
 * (spec §3.2). The same code must return sane values on a Hetzner x64 Linux VPS
 * and an arm64 Mac mini. */
import { cpus, totalmem, arch, platform, release } from 'node:os';
import { statfs, access } from 'node:fs/promises';
import type { CapabilityReport, Architecture, ExecutorKind } from '@cumulus/shared-types';
import { AVAILABLE_EXECUTORS } from './models/index.js';
import { queryGpuInfo } from './gpu.js';

function mapArch(): Architecture | undefined {
  const a = arch();
  if (a === 'x64') return 'x64';
  if (a === 'arm64') return 'arm64';
  return undefined;
}

async function diskGb(): Promise<number | undefined> {
  try {
    const s = await statfs('/');
    return Math.round((s.blocks * s.bsize) / 1e9);
  } catch {
    return undefined;
  }
}

async function dockerAvailable(): Promise<boolean> {
  // Cheap, non-spawning check: the daemon socket exists on Linux/macOS.
  try {
    await access('/var/run/docker.sock');
    return true;
  } catch {
    return false;
  }
}

export async function scanCapabilities(): Promise<CapabilityReport> {
  const cores = cpus();
  const isDarwin = platform() === 'darwin';
  const gpu = await queryGpuInfo();

  // A node with a CUDA GPU additionally advertises the `gpu` executor, so
  // GPU-gated workloads route to it (zero control-plane change).
  const executors: ExecutorKind[] = gpu ? [...AVAILABLE_EXECUTORS, 'gpu'] : AVAILABLE_EXECUTORS;

  return {
    cpuModel: cores[0]?.model?.trim(),
    cpuCores: cores.length,
    cpuThreads: cores.length, // best-effort; Node doesn't expose physical/logical split
    ramGb: Math.round(totalmem() / 1e9),
    diskGb: await diskGb(),
    os: `${platform()} ${release()}`,
    architecture: mapArch(),
    dockerAvailable: await dockerAvailable(),
    gpuCount: gpu?.count ?? 0,
    gpuModels: gpu?.models,
    gpuVramGb: gpu?.vramGb,
    cudaAvailable: gpu != null,
    rocmAvailable: false,
    // Metal is the realistic accelerator path on a Mac mini (0b).
    metalAvailable: isDarwin,
    executors,
  };
}
