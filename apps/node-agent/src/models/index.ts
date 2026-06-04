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
import { loadSpeechClip, loadMmlu, type MmluItem } from './datasets.js';
import { wordErrorRate } from './eval.js';
import { log } from '../log.js';

// Rotating cursors so a scenario's requests cover different clips/questions.
let clipCursor = 0;
let mmluCursor = 0;
let mmluCache: MmluItem[] | null = null;

const EMB_MODEL = process.env.EMB_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const ASR_MODEL = process.env.ASR_MODEL ?? 'Xenova/whisper-tiny.en';
// Two LLM tiers: a tiny model on CPU, a bigger one on GPU. The GPU node sets
// LLM_GGUF_URL_GPU (default a 7B Q4 that fits a 24GB card) and node-llama-cpp
// auto-offloads to the GPU.
interface LlmTierConfig {
  url: string;
  file: string;
  label: string;
}
const LLM_TIERS: Record<'cpu' | 'gpu', LlmTierConfig> = {
  cpu: {
    url:
      process.env.LLM_GGUF_URL ??
      'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    file: join(MODEL_CACHE_DIR, 'qwen2.5-0.5b-instruct-q4_k_m.gguf'),
    label: 'qwen2.5-0.5b-instruct-q4',
  },
  gpu: {
    url:
      process.env.LLM_GGUF_URL_GPU ??
      'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
    file: join(MODEL_CACHE_DIR, process.env.LLM_GGUF_FILE_GPU ?? 'qwen2.5-7b-instruct-q4_k_m.gguf'),
    label: process.env.LLM_LABEL_GPU ?? 'qwen2.5-7b-instruct-q4',
  },
};

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

// ─── Transcription (real speech clip → WER) ──────────────────────────────────
async function runTranscription(): Promise<ModelRunResult> {
  // Load a real public-domain clip with a reference transcript (rotating).
  let audio: Float32Array;
  let reference: string | null = null;
  let clipName = 'synthetic';
  try {
    const clip = await loadSpeechClip(clipCursor++);
    audio = clip.samples;
    reference = clip.reference;
    clipName = clip.name;
  } catch (err) {
    log.warn('speech clip unavailable, using synthetic audio (no WER)', { err: String(err) });
    audio = synthAudio(4);
  }
  const seconds = Math.round((audio.length / 16000) * 100) / 100;

  return withModel(
    'transcription',
    async () => {
      const { pipeline } = await loadTransformers();
      const transcriber = await pipeline('automatic-speech-recognition', ASR_MODEL);
      return { instance: transcriber, unload: async () => { await transcriber.dispose?.(); } };
    },
    async (transcriber: any) => {
      const t0 = performance.now();
      const out = await transcriber(audio, { chunk_length_s: 30 });
      const ms = performance.now() - t0;
      const text = String(out.text ?? '').trim();
      return {
        result: {
          model: ASR_MODEL,
          clip: clipName,
          text,
          reference: reference ?? undefined,
          // WER = standard ASR accuracy metric (lower is better).
          wer: reference != null ? wordErrorRate(reference, text) : undefined,
          audioSeconds: seconds,
          // real-time factor: processing time / audio length (<1 = faster than real-time)
          rtf: Math.round((ms / 1000 / Math.max(0.01, seconds)) * 100) / 100,
        },
        cpuSeconds: ms / 1000,
      };
    },
  );
}

// ─── LLM (CPU tiny / GPU bigger) ─────────────────────────────────────────────
/** Run `use` against a loaded Qwen model + a fresh context (single-slot). The
 * model manager key is per-tier so CPU/GPU models don't evict each other. */
async function withLlm<R>(
  tier: 'cpu' | 'gpu',
  use: (gen: (prompt: string, maxTokens: number) => Promise<{ text: string; ms: number }>) => Promise<R>,
): Promise<R> {
  const cfg = LLM_TIERS[tier];
  return withModel(
    `llm-${tier}`,
    async () => {
      await ensureFile(cfg.url, cfg.file);
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama();
      // gpuLayers auto-offloads to the GPU when one is present (no-op on CPU).
      const model = await llama.loadModel({ modelPath: cfg.file });
      log.info('llm model ready', { tier, gpu: (llama as any).gpu ?? 'cpu' });
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
        const gen = async (prompt: string, maxTokens: number) => {
          const session = new LlamaChatSession({ contextSequence: context.getSequence() });
          const t0 = performance.now();
          const text: string = await session.prompt(prompt, { maxTokens });
          return { text, ms: performance.now() - t0 };
        };
        return await use(gen);
      } finally {
        await context.dispose?.();
      }
    },
  );
}

async function runLlm(tier: 'cpu' | 'gpu', prompt: string, maxTokens: number): Promise<ModelRunResult> {
  return withLlm(tier, async (gen) => {
    const { text, ms } = await gen(prompt, maxTokens);
    const tokens = Math.max(1, Math.round(text.length / 4));
    return {
      result: {
        model: LLM_TIERS[tier].label,
        tier,
        prompt,
        completion: text.slice(0, 400),
        tokens,
        tokensPerSec: Math.round((tokens / (ms / 1000)) * 100) / 100,
      },
      cpuSeconds: ms / 1000,
    };
  });
}

/** MMLU multiple-choice — reports correctness (the standard accuracy metric). */
async function runLlmMmlu(tier: 'cpu' | 'gpu'): Promise<ModelRunResult> {
  if (!mmluCache) mmluCache = await loadMmlu(20);
  const item = mmluCache[mmluCursor++ % mmluCache.length]!;
  const letters = ['A', 'B', 'C', 'D'];
  const prompt =
    `Answer with only the single letter (A, B, C, or D) of the correct option.\n\n` +
    `${item.question}\n` +
    item.choices.map((c, i) => `${letters[i]}. ${c}`).join('\n') +
    `\nAnswer:`;

  return withLlm(tier, async (gen) => {
    const { text, ms } = await gen(prompt, 5);
    const m = text.toUpperCase().match(/[ABCD]/);
    const predictedIdx = m ? letters.indexOf(m[0]) : -1;
    const tokens = Math.max(1, Math.round(text.length / 4));
    return {
      result: {
        model: LLM_TIERS[tier].label,
        tier,
        eval: 'MMLU',
        subject: item.subject,
        question: item.question,
        predicted: predictedIdx >= 0 ? letters[predictedIdx] : text.trim().slice(0, 12),
        answer: letters[item.answerIdx],
        correct: predictedIdx === item.answerIdx,
        tokensPerSec: Math.round((tokens / (ms / 1000)) * 100) / 100,
      },
      cpuSeconds: ms / 1000,
    };
  });
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
    case 'gpu_llm': {
      const tier = workloadType === 'gpu_llm' ? 'gpu' : 'cpu';
      // MMLU accuracy eval when requested (QA suite); free-form otherwise (real customers).
      return input.mmlu
        ? runLlmMmlu(tier)
        : runLlm(
            tier,
            String(input.prompt ?? 'In one sentence, what is a distributed compute pool?'),
            Number(input.maxTokens ?? 64),
          );
    }
    default:
      throw new Error(`not a model workload: ${workloadType}`);
  }
}

export const MODEL_WORKLOADS: ReadonlySet<WorkloadType> = new Set<WorkloadType>([
  'embeddings',
  'ocr',
  'transcription',
  'llm_generate',
  'gpu_llm',
]);
