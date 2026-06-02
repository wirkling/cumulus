/**
 * Test user — the end-to-end customer self-test. Connects with an API key,
 * runs the QA suite we defined (through the public /v1 API, exactly as a real
 * customer would), waits for it to finish, and prints the results back. This is
 * the genuine "customer runs the tests and sees the results" loop.
 *
 * Usage:
 *   CUMULUS_API_URL=https://<host> CUMULUS_API_KEY=ck_live_... \
 *   tsx src/test-user.ts [scenarioKey ...]
 */
import { CumulusClient } from './index.js';

const baseUrl = process.env.CUMULUS_API_URL ?? 'http://localhost:8080';
const apiKey = process.env.CUMULUS_API_KEY;
const scenarioKeys = process.argv.slice(2);

async function main(): Promise<void> {
  if (!apiKey) throw new Error('CUMULUS_API_KEY is required (mint one in the Customers tab)');
  const cumulus = new CumulusClient({ baseUrl, apiKey });

  const suite = await cumulus.qaSuite();
  console.log(`Connected to ${baseUrl}. Suite ${suite.version} — ${suite.scenarios.length} scenarios.`);
  console.log(`Running ${scenarioKeys.length ? scenarioKeys.join(', ') : 'the full suite'} …\n`);

  const run = await cumulus.runQaAndWait({
    envLabel: 'test-user',
    scenarioKeys: scenarioKeys.length ? scenarioKeys : undefined,
    timeoutMs: 900_000,
  });

  console.log(`Run ${run.id} → ${run.status}  (${run.fleetSnapshot.length} nodes)\n`);
  console.log(
    'use case'.padEnd(18) +
      'ok'.padEnd(10) +
      'p50'.padEnd(9) +
      'p95'.padEnd(9) +
      'thrpt'.padEnd(9) +
      'overflow',
  );
  for (const r of run.results) {
    console.log(
      r.useCase.padEnd(18) +
        `${r.succeeded}/${r.requestCount}`.padEnd(10) +
        `${r.latencyP50Ms ?? '—'}ms`.padEnd(9) +
        `${r.latencyP95Ms ?? '—'}ms`.padEnd(9) +
        `${r.throughputPerSec ?? '—'}/s`.padEnd(9) +
        `${r.metrics.overflowRatio != null ? Math.round(r.metrics.overflowRatio * 100) + '%' : '—'}`,
    );
  }

  // Show one real merged output back to the user (work product, not just stats).
  const sample = run.results.flatMap((r) => r.metrics.sampleResults ?? [])[0];
  if (sample) {
    console.log('\nSample result returned to the customer:');
    console.log(JSON.stringify(sample, null, 2).slice(0, 600));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
