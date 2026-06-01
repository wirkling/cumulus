/** Agent lifecycle + loops (spec §10.2). Modular pieces (config, state, client,
 * capability scanner, benchmark runner, executors, metrics, sim, update) are
 * wired together here. Local watchdog keeps loops alive across errors. */
import { setTimeout as sleep } from 'node:timers/promises';
import type { AgentConfig, AgentDirective, NodeStatus, DispatchedJob } from '@cumulus/shared-types';
import { agentConfig } from './config.js';
import { log } from './log.js';
import { loadState, saveState } from './state.js';
import { ControlPlaneClient } from './client.js';
import { scanCapabilities } from './capabilities.js';
import { collectMetrics } from './metrics.js';
import { runCpuBenchmark, runNetworkBenchmark } from './benchmarks.js';
import { executeJob } from './executors.js';

type LocalState = 'online' | 'draining' | 'paused';

export class Agent {
  private readonly client: ControlPlaneClient;
  private cfg: AgentConfig = {
    heartbeatIntervalSeconds: 15,
    jobPollIntervalSeconds: 5,
    benchmarksEnabled: true,
  };
  private local: LocalState = 'online';
  private running = false;
  private busy = false;
  private lastLatencyMs?: number;

  constructor() {
    this.client = new ControlPlaneClient(agentConfig.controlPlaneUrl, agentConfig.bootstrapToken);
  }

  async start(): Promise<void> {
    await this.ensureRegistered();
    await this.reportCapabilities();
    this.running = true;
    if (this.cfg.benchmarksEnabled) void this.runStartupBenchmarks();
    // Loops run concurrently; each is self-healing.
    void this.heartbeatLoop();
    void this.pollLoop();
    log.info('agent started', { intervals: this.cfg });
  }

  stop(): void {
    this.running = false;
  }

  // ── Registration (idempotent across restarts via local state) ───────────────
  private async ensureRegistered(): Promise<void> {
    const existing = await loadState(agentConfig.stateFile);
    if (existing) {
      this.client.setIdentity(existing.nodeId, existing.agentToken);
      log.info('loaded existing identity', { nodeId: existing.nodeId });
      return;
    }
    const caps = await scanCapabilities();
    const res = await this.client.register({
      nodeName: agentConfig.nodeName,
      nodeType: agentConfig.nodeType,
      agentVersion: agentConfig.agentVersion,
      capabilities: caps,
      location: agentConfig.location
        ? {
            name: agentConfig.location.name,
            latitude: agentConfig.location.latitude,
            longitude: agentConfig.location.longitude,
            city: agentConfig.location.city,
          }
        : undefined,
    });
    this.client.setIdentity(res.nodeId, res.agentToken);
    this.cfg = res.config;
    await saveState(agentConfig.stateFile, { nodeId: res.nodeId, agentToken: res.agentToken });
    log.info('registered with control plane', { nodeId: res.nodeId });
  }

  private async reportCapabilities(): Promise<void> {
    try {
      await this.client.reportCapabilities(await scanCapabilities());
    } catch (err) {
      log.warn('capability report failed', { err: String(err) });
    }
  }

  // ── Heartbeat loop ──────────────────────────────────────────────────────────
  private reportedStatus(): NodeStatus {
    if (this.local === 'draining') return 'draining';
    if (this.local === 'paused') return 'maintenance';
    return 'online';
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        const metrics = await collectMetrics(this.lastLatencyMs);
        const { res, latencyMs } = await this.client.heartbeat(this.reportedStatus(), metrics);
        this.lastLatencyMs = latencyMs;
        for (const d of res.directives ?? []) this.handleDirective(d);
      } catch (err) {
        log.warn('heartbeat failed', { err: String(err) });
      }
      await sleep(this.cfg.heartbeatIntervalSeconds * 1000);
    }
  }

  private handleDirective(d: AgentDirective): void {
    switch (d.type) {
      case 'drain':
        this.local = 'draining';
        log.info('directive: drain (no new jobs)');
        break;
      case 'pause':
        this.local = 'paused';
        log.info('directive: pause');
        break;
      case 'resume':
        this.local = 'online';
        log.info('directive: resume');
        break;
      case 'run_benchmark':
        void this.runStartupBenchmarks();
        break;
    }
  }

  // ── Poll + execute loop ─────────────────────────────────────────────────────
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        if (this.local === 'online' && !this.busy) {
          const poll = await this.client.poll();
          if (poll.jobAvailable && poll.job) await this.runJob(poll.job);
        }
      } catch (err) {
        log.warn('poll failed', { err: String(err) });
      }
      await sleep(this.cfg.jobPollIntervalSeconds * 1000);
    }
  }

  private async runJob(job: DispatchedJob): Promise<void> {
    this.busy = true;
    log.info('job received', { jobId: job.jobId, attemptId: job.attemptId, workload: job.workloadType });
    try {
      await this.client.startJob(job.attemptId);
      const { result, resourceUsage } = await executeJob(job.workloadType, job.input);
      await this.client.completeJob(job.attemptId, result, resourceUsage);
      log.info('job completed', { jobId: job.jobId });
    } catch (err) {
      log.warn('job failed', { jobId: job.jobId, err: String(err) });
      try {
        await this.client.failJob(job.attemptId, String(err instanceof Error ? err.message : err));
      } catch (reportErr) {
        log.error('failed to report job failure', { err: String(reportErr) });
      }
    } finally {
      this.busy = false;
    }
  }

  // ── Benchmarks ───────────────────────────────────────────────────────────────
  private async runStartupBenchmarks(): Promise<void> {
    try {
      const cpu = runCpuBenchmark();
      await this.client.submitBenchmark({
        benchmarkType: 'cpu',
        score: cpu.score,
        unit: cpu.unit,
        rawResult: cpu.rawResult,
        status: 'completed',
      });
      const net = await runNetworkBenchmark(agentConfig.controlPlaneUrl);
      await this.client.submitBenchmark({
        benchmarkType: 'network',
        score: net.score,
        unit: net.unit,
        rawResult: net.rawResult,
        status: 'completed',
      });
      log.info('benchmarks submitted', { cpu: cpu.score, networkMs: net.score });
    } catch (err) {
      log.warn('benchmark run failed', { err: String(err) });
    }
  }
}
