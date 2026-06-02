/**
 * Run each real executor once and print result + timing. Verifies the runtimes
 * + model downloads work before wiring into the fleet.
 *
 *   tsx src/models/selftest.ts [embeddings|ocr|transcription|llm_generate ...]
 */
import { runModelWorkload } from './index.js';
import type { WorkloadType } from '@cumulus/shared-types';

const which = (process.argv.slice(2) as WorkloadType[]).filter(Boolean);
const all: WorkloadType[] = ['embeddings', 'ocr', 'transcription', 'llm_generate'];
const targets = which.length ? which : all;

async function main(): Promise<void> {
  for (const w of targets) {
    process.stdout.write(`\n=== ${w} ===\n`);
    const t0 = Date.now();
    try {
      const input =
        w === 'embeddings'
          ? { items: Array.from({ length: 16 }, (_, i) => `sample sentence number ${i} for embedding`) }
          : {};
      const { result, cpuSeconds } = await runModelWorkload(w, input);
      console.log(`wall ${Date.now() - t0}ms · cpuSeconds ${cpuSeconds.toFixed(2)}`);
      console.log(JSON.stringify(result, null, 2).slice(0, 700));
    } catch (err) {
      console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(0);
}

main();
