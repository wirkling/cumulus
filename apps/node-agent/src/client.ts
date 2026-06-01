/** Outbound-only HTTP client to the control plane (spec §3.1). The agent
 * initiates every connection; nothing ever connects to the agent. All comms go
 * over TLS in production (Caddy in front of the API). */
import { performance } from 'node:perf_hooks';
import type {
  RegisterRequest,
  RegisterResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  CapabilityReport,
  PollResponse,
  ResourceUsage,
  HeartbeatMetrics,
  NodeStatus,
  BenchmarkSubmitRequest,
} from '@cumulus/shared-types';

export class ControlPlaneClient {
  private nodeId?: string;
  private token?: string;

  constructor(
    private readonly baseUrl: string,
    private readonly bootstrapToken: string,
  ) {}

  setIdentity(nodeId: string, token: string): void {
    this.nodeId = nodeId;
    this.token = token;
  }

  private async post<T>(path: string, body: unknown, authToken: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} → ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  private requireAuth(): { nodeId: string; token: string } {
    if (!this.nodeId || !this.token) throw new Error('agent not registered yet');
    return { nodeId: this.nodeId, token: this.token };
  }

  async register(req: RegisterRequest): Promise<RegisterResponse> {
    return this.post<RegisterResponse>('/api/agent/register', req, this.bootstrapToken);
  }

  /** Heartbeat, returning measured round-trip latency for the metrics. */
  async heartbeat(
    status: NodeStatus,
    metrics: HeartbeatMetrics,
  ): Promise<{ res: HeartbeatResponse; latencyMs: number }> {
    const { nodeId, token } = this.requireAuth();
    const body: HeartbeatRequest = { nodeId, status, metrics };
    const start = performance.now();
    const res = await this.post<HeartbeatResponse>('/api/agent/heartbeat', body, token);
    return { res, latencyMs: Math.round((performance.now() - start) * 100) / 100 };
  }

  async reportCapabilities(capabilities: CapabilityReport): Promise<void> {
    const { nodeId, token } = this.requireAuth();
    await this.post('/api/agent/capabilities', { nodeId, capabilities }, token);
  }

  async poll(): Promise<PollResponse> {
    const { nodeId, token } = this.requireAuth();
    return this.post<PollResponse>('/api/agent/jobs/poll', { nodeId }, token);
  }

  async startJob(attemptId: string): Promise<void> {
    const { nodeId, token } = this.requireAuth();
    await this.post(`/api/agent/jobs/${attemptId}/start`, { nodeId }, token);
  }

  async completeJob(
    attemptId: string,
    result: unknown,
    resourceUsage?: ResourceUsage,
  ): Promise<void> {
    const { nodeId, token } = this.requireAuth();
    await this.post(`/api/agent/jobs/${attemptId}/complete`, { nodeId, result, resourceUsage }, token);
  }

  async failJob(attemptId: string, errorMessage: string): Promise<void> {
    const { nodeId, token } = this.requireAuth();
    await this.post(`/api/agent/jobs/${attemptId}/fail`, { nodeId, errorMessage }, token);
  }

  async submitBenchmark(b: Omit<BenchmarkSubmitRequest, 'nodeId'>): Promise<void> {
    const { nodeId, token } = this.requireAuth();
    await this.post('/api/agent/benchmarks', { nodeId, ...b }, token);
  }
}
