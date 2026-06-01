/**
 * Simulation harness — submit a batch of requests to a running API, to exercise
 * scatter/gather, merge, timeout and partial-result logic (spec §11).
 *
 * Usage:  API_BASE_URL=http://localhost:8080 tsx src/sim/submit-batch.ts [count]
 */
import { PRESET_ORIGINS } from '@cumulus/shared-types';

const base = process.env.API_BASE_URL ?? 'http://localhost:8080';
const count = Number(process.argv[2] ?? 20);

const workloads = ['echo_sleep', 'cpu_benchmark', 'split_map_merge'] as const;

async function submitOne(i: number): Promise<string | null> {
  const workloadType = workloads[i % workloads.length]!;
  const origin = PRESET_ORIGINS[i % PRESET_ORIGINS.length]!;
  const body =
    workloadType === 'split_map_merge'
      ? {
          workloadType,
          fanOut: 3,
          originLocation: { lat: origin.lat, lng: origin.lng, label: origin.label },
          input: { items: Array.from({ length: 30 }, (_, k) => `item-${i}-${k}`) },
        }
      : workloadType === 'echo_sleep'
        ? {
            workloadType,
            fanOut: 2,
            originLocation: { lat: origin.lat, lng: origin.lng, label: origin.label },
            input: { ms: 500, echo: `req-${i}` },
          }
        : { workloadType, fanOut: 1, input: { iterations: 2_000_000 } };

  const res = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`request ${i} failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function main(): Promise<void> {
  console.log(`Submitting ${count} requests to ${base} …`);
  const ids = await Promise.all(Array.from({ length: count }, (_, i) => submitOne(i)));
  const ok = ids.filter(Boolean).length;
  console.log(`Submitted ${ok}/${count} requests.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
