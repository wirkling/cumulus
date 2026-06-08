/**
 * GPU sizing helpers — pure math for the (model × precision × KV-cache) sizing
 * the doc makes first-class. No I/O (mirrors haversine in geo.ts). Sprint 1
 * ships the math + the data shape; the hard VRAM-fit placement filter that
 * consumes it is Sprint 2 (which also needs the live free-VRAM heartbeat feed).
 */
import type { Precision } from '@cumulus/shared-types';
import { BYTES_PER_PARAM } from '@cumulus/shared-types';

export function bytesPerParam(precision: Precision): number {
  return BYTES_PER_PARAM[precision];
}

/** Model weights footprint in GB. weights GB ≈ params(B) × bytes/param. */
export function weightsGb(paramsB: number, precision: Precision): number {
  return paramsB * bytesPerParam(precision);
}

export interface KvCacheSpec {
  /** Sequence length (prompt + generated) the cache must hold. */
  contextLen: number;
  /** Concurrent sequences batched together (the throughput lever). */
  batch: number;
  /** Transformer layers (model-specific). */
  numLayers: number;
  /** Model hidden size (model-specific). */
  hiddenSize: number;
  /** Bytes per cached element (fp16 KV = 2). */
  kvBytesPerElem?: number;
}

/**
 * KV-cache footprint in GB. The cache stores a key AND a value vector per layer
 * per token: bytes = 2 × layers × hidden × context × batch × bytesPerElem. It
 * grows with context length × batch, which is why a model that "fits" by
 * weights can still OOM under load — the doc's KV-as-first-class point.
 */
export function kvCacheGb(spec: KvCacheSpec): number {
  const bytesPerElem = spec.kvBytesPerElem ?? 2;
  const bytes =
    2 * spec.numLayers * spec.hiddenSize * spec.contextLen * spec.batch * bytesPerElem;
  return bytes / 1e9;
}

export interface VramEstimateSpec {
  paramsB: number;
  precision: Precision;
  /** Optional KV-cache budget; omit to size weights only. */
  kv?: KvCacheSpec;
  /** Multiplicative headroom for activations/fragmentation (default 1.1 = +10%). */
  overheadFactor?: number;
}

/** Total VRAM (GB) a model needs to be served: (weights + KV) × overhead. */
export function estimateVramGb(spec: VramEstimateSpec): number {
  const w = weightsGb(spec.paramsB, spec.precision);
  const kv = spec.kv ? kvCacheGb(spec.kv) : 0;
  const overhead = spec.overheadFactor ?? 1.1;
  return (w + kv) * overhead;
}

/**
 * Largest tensor-parallel group a node offers (max NVLink-connected card count),
 * or 1 if it has no multi-card group. Placement uses this to satisfy a
 * `tpGroupMinCards` requirement: a model too big for one card needs the grouped
 * node, never scattered single cards — the doc's "a sharded model stays in one
 * box" rule.
 */
export function maxTpGroupCards(tpGroups: number[][] | undefined): number {
  if (!tpGroups || tpGroups.length === 0) return 1;
  return tpGroups.reduce((m, g) => Math.max(m, g.length), 1);
}
