/**
 * Fake user — drives the platform the way a real customer would, through the
 * public SDK + API key. Useful for smoke-testing the front door and generating
 * realistic load.
 *
 * Usage:
 *   CUMULUS_API_URL=https://<host> CUMULUS_API_KEY=ck_live_... \
 *   tsx src/fake-user.ts [jobs]
 */
import { CumulusClient } from './index.js';
import { PRESET_ORIGINS } from '@cumulus/shared-types';

const baseUrl = process.env.CUMULUS_API_URL ?? 'http://localhost:8080';
const apiKey = process.env.CUMULUS_API_KEY;
const jobs = Number(process.argv[2] ?? 6);

async function main(): Promise<void> {
  if (!apiKey) throw new Error('CUMULUS_API_KEY is required (create one via the operator API / Test Center)');
  const cumulus = new CumulusClient({ baseUrl, apiKey });
  console.log(`Fake user connecting to ${baseUrl} with key ${apiKey.slice(0, 12)}…`);

  const workloads = ['split_map_merge', 'echo_sleep', 'cpu_benchmark'] as const;
  const tasks = Array.from({ length: jobs }, async (_, i) => {
    const workloadType = workloads[i % workloads.length]!;
    const origin = PRESET_ORIGINS[i % PRESET_ORIGINS.length]!;
    const body =
      workloadType === 'split_map_merge'
        ? {
            workloadType,
            fanOut: 3,
            originLocation: { lat: origin.lat, lng: origin.lng, label: origin.label },
            input: { items: Array.from({ length: 30 }, (_, k) => `doc-${i}-${k}`) },
          }
        : workloadType === 'echo_sleep'
          ? { workloadType, fanOut: 2, input: { ms: 500, echo: `job-${i}` } }
          : { workloadType, fanOut: 1, input: { iterations: 3_000_000 } };

    const t0 = Date.now();
    const res = await cumulus.submitAndWait(body, { timeoutMs: 60_000 });
    const ms = Date.now() - t0;
    console.log(`  [${i}] ${workloadType.padEnd(16)} ${res.status.padEnd(10)} ${ms}ms`);
    return res.status;
  });

  const results = await Promise.all(tasks);
  const ok = results.filter((s) => s === 'completed' || s === 'partial').length;
  console.log(`Done: ${ok}/${jobs} succeeded.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
