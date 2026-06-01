import 'server-only';

/**
 * Server-only backend client. The OPERATOR_API_KEY is read here and NEVER sent
 * to the browser (spec §8, §1). Client components talk to our own Next route
 * handlers, which call these.
 */
const API_BASE = (process.env.API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const OPERATOR_KEY = process.env.OPERATOR_API_KEY ?? '';

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`backend ${res.status}: ${typeof body === 'object' ? JSON.stringify(body) : text}`);
  }
  return body;
}

export async function operatorGet(path: string): Promise<unknown> {
  return json(
    await fetch(`${API_BASE}${path}`, {
      headers: { 'x-operator-key': OPERATOR_KEY },
      cache: 'no-store',
    }),
  );
}

export async function operatorPost(path: string, body?: unknown): Promise<unknown> {
  return json(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'x-operator-key': OPERATOR_KEY, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }),
  );
}

/** Caller endpoints aren't operator-guarded, but we still proxy server-side. */
export async function callerGet(path: string): Promise<unknown> {
  return json(await fetch(`${API_BASE}${path}`, { cache: 'no-store' }));
}

export async function callerPost(path: string, body: unknown): Promise<unknown> {
  return json(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }),
  );
}
