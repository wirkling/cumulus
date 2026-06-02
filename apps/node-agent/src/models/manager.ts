/**
 * Single-slot model manager for memory-constrained nodes (cx23 = 4 GB).
 *
 * Only ONE model is resident at a time: requesting a different executor unloads
 * the current one first. All model use is serialised (the agent runs one job at
 * a time anyway), so there's never concurrent residency. Model files are cached
 * on disk, so only the first use of each pays the download (a measured cold
 * start); switching executors pays a reload, which on a small node is the
 * honest cost of a heterogeneous workload mix.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { log } from '../log.js';

export const MODEL_CACHE_DIR =
  process.env.MODEL_CACHE_DIR ?? join(homedir(), '.cumulus-models');

try {
  mkdirSync(MODEL_CACHE_DIR, { recursive: true });
} catch {
  /* best effort */
}

interface Loaded {
  kind: string;
  instance: unknown;
  unload: () => Promise<void>;
}

let current: Loaded | null = null;
let chain: Promise<unknown> = Promise.resolve();

export interface LoadResult<T> {
  instance: T;
  unload: () => Promise<void>;
}

/**
 * Ensure `kind`'s model is the resident one (loading it, evicting any other),
 * then run `use` against the loaded instance. Serialised across all callers.
 */
export function withModel<T, R>(
  kind: string,
  loader: () => Promise<LoadResult<T>>,
  use: (instance: T) => Promise<R>,
): Promise<R> {
  const task = chain.then(async () => {
    if (!current || current.kind !== kind) {
      if (current) {
        log.info('unloading model', { kind: current.kind });
        await current.unload().catch((err) => log.warn('unload failed', { err: String(err) }));
        current = null;
      }
      const t0 = Date.now();
      const { instance, unload } = await loader();
      current = { kind, instance, unload };
      log.info('model loaded', { kind, loadMs: Date.now() - t0 });
    }
    return use(current.instance as T);
  });
  // Keep the chain alive even if this task throws.
  chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
