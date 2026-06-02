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
}
