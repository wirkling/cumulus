/**
 * Real CPU model executors (Stage 2). Each runs behind the single-slot model
 * manager. Runtimes are imported lazily inside loaders so the agent stays light
 * until a model is actually used. Result shapes are compact + honest (real work
 * product + the metric that matters per use case).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { performance } from 'node:perf_hooks';
import { createWriteStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { ExecutorKind, WorkloadType } from '@cumulus/shared-types';
import { withModel, MODEL_CACHE_DIR } from './manager.js';
import { ocrFixturePng, OCR_PHRASE, synthAudio } from './fixtures.js';
import { log } from '../log.js';

const EMB_MODEL = process.env.EMB_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const ASR_MODEL = process.env.ASR_MODEL ?? 'Xenova/whisper-tiny.en';
const LLM_GGUF_URL =
  process.env.LLM_GGUF_URL ??
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const LLM_GGUF_FILE = join(MODEL_CACHE_DIR, 'qwen2.5-0.5b-instruct-q4_k_m.gguf');

/** Which executors this node advertises. Default all four; restrict via env. */
const ALL_EXECUTORS = ['embeddings', 'ocr', 'transcription', 'llm'];
export const AVAILABLE_EXECUTORS: ExecutorKind[] = (
  process.env.AGENT_EXECUTORS
    ? process.env.AGENT_EXECUTORS.split(',').map((s) => s.trim())
    : ALL_EXECUTORS
).filter((e): e is ExecutorKind => ALL_EXECUTORS.includes(e));

let transformersConfigured = false;
async function loadTransformers(): Promise<any> {
  const t = await import('@huggingface/transformers');
  if (!transformersConfigured) {
    t.env.cacheDir = MODEL_CACHE_DIR;
    t.env.allowLocalModels = false;
    transformersConfigured = true;
  }
  return t;
}

async function ensureFile(url: string, dest: string): Promise<string> {
  if (existsSync(dest)) return dest;
  log.info('downloading model file', { url, dest });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await streamPipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
  return dest;
}

export interface ModelRunResult {
  result: unknown;
  cpuSeconds: number;
}

// ─── Embeddings ──────────────────────────────────────────────────────────────
async function runEmbeddings(items: string[]): Promise<ModelRunResult> {
  const texts = items.length ? items : ['the quick brown fox', 'distributed compute pool'];
  return withModel(
    'embeddings',
    async () => {
      const { pipeline } = await loadTransformers();
      const extractor = await pipeline('feature-extraction', EMB_MODEL);
      return { instance: extractor, unload: async () => { await extractor.dispose?.(); } };
    },
    async (extractor: any) => {
      const t0 = performance.now();
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      const vectors = out.tolist() as number[][];
      const ms = performance.now() - t0;
      const dim = vectors[0]?.length ?? 0;
      const norms = vectors.map((v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)));
      return {
        result: {
          model: EMB_MODEL,
          dim,
          count: vectors.length,
          msPerItem: Math.round((ms / texts.length) * 100) / 100,
          sampleVector: (vectors[0] ?? []).slice(0, 8).map((x) => Math.round(x * 1e4) / 1e4),
          normMean: Math.round((norms.reduce((a, b) => a + b, 0) / norms.length) * 1e4) / 1e4,
        },
        cpuSeconds: ms / 1000,
      };
    },
  );
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
async function runOcr(): Promise<ModelRunResult> {
  return withModel(
    'ocr',
    async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, { cachePath: MODEL_CACHE_DIR });
      return { instance: worker, unload: async () => { await worker.terminate(); } };
    },
    async (worker: any) => {
      const t0 = performance.now();
      const { data } = await worker.recognize(ocrFixturePng());
      const ms = performance.now() - t0;
      const text = String(data.text ?? '').trim();
      return {
        result: {
          model: 'tesseract-eng',
          text,
          confidence: Math.round(data.confidence ?? 0),
          chars: text.length,
          // The fixture is a synthetic bitmap-font document. The QA metric is
          // OCR *throughput* (pages/s); accuracy benchmarking needs real scans.
          fixture: OCR_PHRASE,
          note: 'synthetic document — metric is throughput, not accuracy',
        },
        cpuSeconds: ms / 1000,
      };
    },
  );
}

// ─── Transcription ───────────────────────────────────────────────────────────
async function runTranscription(): Promise<ModelRunResult> {
  const seconds = 4;
  return withModel(
    'transcription',
    async () => {
      const { pipeline } = await loadTransformers();
      const transcriber = await pipeline('automatic-speech-recognition', ASR_MODEL);
      return { instance: transcriber, unload: async () => { await transcriber.dispose?.(); } };
    },
    async (transcriber: any) => {
      const audio = synthAudio(seconds);
      const t0 = performance.now();
      const out = await transcriber(audio, { chunk_length_s: 30 });
      const ms = performance.now() - t0;
      return {
        result: {
          model: ASR_MODEL,
          text: String(out.text ?? '').trim(),
          audioSeconds: seconds,
          // real-time factor: processing time / audio length (<1 = faster than real-time)
          rtf: Math.round((ms / 1000 / seconds) * 100) / 100,
        },
        cpuSeconds: ms / 1000,
      };
    },
  );
}

// ─── Small LLM ───────────────────────────────────────────────────────────────
async function runLlm(prompt: string, maxTokens: number): Promise<ModelRunResult> {
  return withModel(
    'llm',
    async () => {
      await ensureFile(LLM_GGUF_URL, LLM_GGUF_FILE);
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: LLM_GGUF_FILE });
      return {
        instance: { llama, model },
        unload: async () => {
          await model.dispose?.();
          await (llama as any).dispose?.();
        },
      };
    },
    async ({ model }: any) => {
      const { LlamaChatSession } = await import('node-llama-cpp');
      const context = await model.createContext({ contextSize: 2048 });
      try {
        const session = new LlamaChatSession({ contextSequence: context.getSequence() });
        const t0 = performance.now();
        const completion: string = await session.prompt(prompt, { maxTokens });
        const ms = performance.now() - t0;
        // Rough token estimate (≈4 chars/token) for a tokens/sec figure.
        const tokens = Math.max(1, Math.round(completion.length / 4));
        return {
          result: {
            model: 'qwen2.5-0.5b-instruct-q4',
            prompt,
            completion: completion.slice(0, 400),
            tokens,
            tokensPerSec: Math.round((tokens / (ms / 1000)) * 100) / 100,
          },
          cpuSeconds: ms / 1000,
        };
      } finally {
        await context.dispose?.();
      }
    },
  );
}

/** Dispatch a Stage-2 workload to its executor. */
export async function runModelWorkload(
  workloadType: WorkloadType,
  input: Record<string, unknown>,
): Promise<ModelRunResult> {
  switch (workloadType) {
    case 'embeddings':
      return runEmbeddings(Array.isArray(input.items) ? (input.items as string[]) : []);
    case 'ocr':
      return runOcr();
    case 'transcription':
      return runTranscription();
    case 'llm_generate':
      return runLlm(
        String(input.prompt ?? 'In one sentence, what is a distributed compute pool?'),
        Number(input.maxTokens ?? 64),
      );
    default:
      throw new Error(`not a model workload: ${workloadType}`);
  }
}

export const MODEL_WORKLOADS: ReadonlySet<WorkloadType> = new Set<WorkloadType>([
  'embeddings',
  'ocr',
  'transcription',
  'llm_generate',
]);
