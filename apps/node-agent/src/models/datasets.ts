/**
 * Standardized eval datasets, fetched + cached on disk:
 *  - real public-domain speech clips (16 kHz mono WAV) with reference
 *    transcripts → real WER. The list is config-driven, so LibriSpeech /
 *    Common Voice URLs slot straight in.
 *  - MMLU multiple-choice questions via the HF datasets-server (cached), with
 *    an embedded fallback so it never hard-fails offline.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_CACHE_DIR } from './manager.js';
import { log } from '../log.js';

// ─── Speech clips (real audio + reference transcript) ────────────────────────
export interface SpeechClip {
  name: string;
  url: string;
  reference: string;
}

const DEFAULT_CLIPS: SpeechClip[] = [
  {
    name: 'jfk',
    url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav',
    reference:
      'and so my fellow americans ask not what your country can do for you ask what you can do for your country',
  },
];

export function speechClips(): SpeechClip[] {
  if (process.env.SPEECH_CLIPS_JSON) {
    try {
      return JSON.parse(process.env.SPEECH_CLIPS_JSON) as SpeechClip[];
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_CLIPS;
}

/** Parse a RIFF/WAVE buffer to mono Float32 at 16 kHz (linear resample if needed). */
export function parseWavToMono16k(buf: Buffer): Float32Array {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  let dataStart = -1;
  let dataLen = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(p + 10);
      sampleRate = buf.readUInt32LE(p + 12);
      bits = buf.readUInt16LE(p + 22);
    } else if (id === 'data') {
      dataStart = p + 8;
      dataLen = size;
      break;
    }
    p += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('no data chunk');

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLen / (bytesPerSample * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const off = dataStart + (i * channels + c) * bytesPerSample;
      if (bits === 16) acc += buf.readInt16LE(off) / 32768;
      else if (bits === 8) acc += (buf.readUInt8(off) - 128) / 128;
      else if (bits === 32) acc += buf.readInt32LE(off) / 2147483648;
    }
    mono[i] = acc / channels;
  }
  if (sampleRate === 16000) return mono;

  // Linear resample to 16 kHz.
  const ratio = 16000 / sampleRate;
  const outLen = Math.floor(mono.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const frac = src - i0;
    out[i] = (mono[i0] ?? 0) * (1 - frac) + (mono[i0 + 1] ?? 0) * frac;
  }
  return out;
}

export interface LoadedClip {
  name: string;
  samples: Float32Array;
  reference: string;
}

export async function loadSpeechClip(index: number): Promise<LoadedClip> {
  const clips = speechClips();
  const clip = clips[index % clips.length]!;
  const dest = join(MODEL_CACHE_DIR, `speech-${clip.name}.wav`);
  let buf: Buffer;
  if (existsSync(dest)) {
    buf = await readFile(dest);
  } else {
    log.info('downloading speech clip', { url: clip.url });
    const res = await fetch(clip.url);
    if (!res.ok) throw new Error(`clip download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
  }
  return { name: clip.name, samples: parseWavToMono16k(buf), reference: clip.reference };
}

// ─── MMLU (multiple-choice knowledge eval) ───────────────────────────────────
export interface MmluItem {
  subject: string;
  question: string;
  choices: string[];
  answerIdx: number;
}

const MMLU_FALLBACK: MmluItem[] = [
  { subject: 'geography', question: 'What is the capital of France?', choices: ['Berlin', 'Paris', 'Madrid', 'Rome'], answerIdx: 1 },
  { subject: 'math', question: 'What is 12 multiplied by 8?', choices: ['80', '96', '108', '88'], answerIdx: 1 },
  { subject: 'science', question: 'Which gas do plants primarily absorb for photosynthesis?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], answerIdx: 2 },
  { subject: 'science', question: 'What is the chemical symbol for water?', choices: ['CO2', 'H2O', 'O2', 'NaCl'], answerIdx: 1 },
  { subject: 'history', question: 'In which year did World War II end?', choices: ['1939', '1942', '1945', '1950'], answerIdx: 2 },
];

export async function loadMmlu(n: number): Promise<MmluItem[]> {
  if (process.env.DISABLE_DATASET_FETCH) return MMLU_FALLBACK.slice(0, n);
  const dest = join(MODEL_CACHE_DIR, `mmlu-${n}.json`);
  if (existsSync(dest)) {
    try {
      return JSON.parse(await readFile(dest, 'utf8')) as MmluItem[];
    } catch {
      /* re-fetch */
    }
  }
  try {
    const url = `https://datasets-server.huggingface.co/rows?dataset=cais%2Fmmlu&config=all&split=test&offset=0&length=${n}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mmlu fetch failed: ${res.status}`);
    const json = (await res.json()) as { rows: { row: any }[] };
    const items: MmluItem[] = json.rows.map((r) => ({
      subject: String(r.row.subject ?? 'general'),
      question: String(r.row.question),
      choices: (r.row.choices as string[]).map(String),
      answerIdx: Number(r.row.answer),
    }));
    if (items.length > 0) {
      await writeFile(dest, JSON.stringify(items));
      log.info('fetched MMLU slice', { count: items.length });
      return items;
    }
    throw new Error('empty MMLU response');
  } catch (err) {
    log.warn('MMLU fetch failed, using fallback', { err: String(err) });
    return MMLU_FALLBACK.slice(0, n);
  }
}
