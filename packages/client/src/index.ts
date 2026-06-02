/**
 * Cumulus client SDK — how a customer connects to the distributed pool.
 *
 *   const cumulus = new CumulusClient({ baseUrl, apiKey });
 *   const res = await cumulus.submitAndWait({ workloadType: 'split_map_merge', ... });
 *
 * Outbound HTTPS only, authenticated with a customer API key against /v1.
 */
import type {
  SubmitRequestBody,
  RequestDetail,
  RequestStatus,
  QaRun,
  QaRunDetail,
  QaSuite,
} from '@cumulus/shared-types';

export interface CumulusClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Override fetch (e.g. for tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface RequestResult {
  requestId: string;
  status: RequestStatus;
  mergedResult: unknown;
}

const TERMINAL: ReadonlySet<RequestStatus> = new Set<RequestStatus>([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

export class CumulusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CumulusError';
  }
}

export class CumulusClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CumulusClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new CumulusError(`Cumulus ${method} ${path} failed (${res.status})`, res.status, parsed);
    }
    return parsed as T;
  }

  /** Submit a job. Returns immediately with the request + its child shards. */
  submit(body: SubmitRequestBody): Promise<RequestDetail> {
    return this.call<RequestDetail>('POST', '/v1/requests', body);
  }

  get(requestId: string): Promise<RequestDetail> {
    return this.call<RequestDetail>('GET', `/v1/requests/${requestId}`);
  }

  result(requestId: string): Promise<RequestResult> {
    return this.call<RequestResult>('GET', `/v1/requests/${requestId}/result`);
  }

  /** Poll until the request reaches a terminal state (or timeout). */
  async waitFor(
    requestId: string,
    opts: { pollMs?: number; timeoutMs?: number } = {},
  ): Promise<RequestResult> {
    const pollMs = opts.pollMs ?? 1000;
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      const res = await this.result(requestId);
      if (TERMINAL.has(res.status)) return res;
      if (Date.now() > deadline) return res;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** Convenience: submit and block until the result is ready. */
  async submitAndWait(
    body: SubmitRequestBody,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<RequestResult> {
    const { id } = await this.submit(body);
    return this.waitFor(id, opts);
  }

  // ── Self-test: run the QA suite we defined, as this customer ────────────────

  /** Fetch the QA suite definition (what tests can be run). */
  qaSuite(): Promise<QaSuite> {
    return this.call<QaSuite>('GET', '/v1/qa/suite');
  }

  /** Kick off a QA run for this customer; returns the run id. */
  async runQa(opts: { envLabel?: string; scenarioKeys?: string[] } = {}): Promise<string> {
    const { runId } = await this.call<{ runId: string }>('POST', '/v1/qa/runs', opts);
    return runId;
  }

  listQaRuns(): Promise<QaRun[]> {
    return this.call<QaRun[]>('GET', '/v1/qa/runs');
  }

  getQaRun(runId: string): Promise<QaRunDetail> {
    return this.call<QaRunDetail>('GET', `/v1/qa/runs/${runId}`);
  }

  /** Run the QA suite and block until it finishes (or timeout), returning the
   * full results — the test user's end-to-end self-test. */
  async runQaAndWait(
    opts: { envLabel?: string; scenarioKeys?: string[]; pollMs?: number; timeoutMs?: number } = {},
  ): Promise<QaRunDetail> {
    const runId = await this.runQa(opts);
    const deadline = Date.now() + (opts.timeoutMs ?? 600_000);
    for (;;) {
      const run = await this.getQaRun(runId);
      if (run.status !== 'running') return run;
      if (Date.now() > deadline) return run;
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
    }
  }
}
