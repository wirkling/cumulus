import { describe, it, expect } from 'vitest';
import {
  bytesPerParam,
  weightsGb,
  kvCacheGb,
  estimateVramGb,
  maxTpGroupCards,
} from './sizing.js';

describe('weightsGb', () => {
  it('matches the doc VRAM bands (params × bytes/param)', () => {
    // 7B fp16 ≈ 14GB; 13B int8 ≈ 13GB; 70B int4 ≈ 35GB (doesn't fit one 24GB card).
    expect(weightsGb(7, 'fp16')).toBeCloseTo(14, 5);
    expect(weightsGb(13, 'int8')).toBeCloseTo(13, 5);
    expect(weightsGb(70, 'int4')).toBeCloseTo(35, 5);
  });

  it('bytesPerParam reflects the precision matrix', () => {
    expect(bytesPerParam('fp16')).toBe(2);
    expect(bytesPerParam('int8')).toBe(1);
    expect(bytesPerParam('int4')).toBe(0.5);
  });
});

describe('kvCacheGb', () => {
  it('grows with context × batch (the OOM-under-load lever)', () => {
    const base = { numLayers: 32, hiddenSize: 4096, contextLen: 2048, batch: 1 };
    const single = kvCacheGb(base);
    const batched = kvCacheGb({ ...base, batch: 8 });
    expect(batched).toBeCloseTo(single * 8, 5);
    // 32 layers × 4096 hidden × 2048 ctx × 1 batch × 2 (K+V) × 2 bytes ≈ 1.07 GB.
    expect(single).toBeGreaterThan(1);
    expect(single).toBeLessThan(1.2);
  });
});

describe('estimateVramGb', () => {
  it('adds weights + KV with headroom', () => {
    const v = estimateVramGb({
      paramsB: 7,
      precision: 'fp16',
      kv: { numLayers: 32, hiddenSize: 4096, contextLen: 2048, batch: 4 },
      overheadFactor: 1.1,
    });
    // ~ (14 + ~4.3) × 1.1 — weights dominate but KV is non-trivial.
    expect(v).toBeGreaterThan(14);
    expect(v).toBeLessThan(25);
  });

  it('sizes weights only when no KV spec is given', () => {
    expect(estimateVramGb({ paramsB: 7, precision: 'fp16', overheadFactor: 1 })).toBeCloseTo(14, 5);
  });
});

describe('maxTpGroupCards', () => {
  it('returns the largest NVLink group, or 1 when there is none', () => {
    expect(maxTpGroupCards([[0, 1, 2, 3]])).toBe(4);
    expect(maxTpGroupCards([[0, 1], [2, 3]])).toBe(2);
    expect(maxTpGroupCards([])).toBe(1);
    expect(maxTpGroupCards(undefined)).toBe(1);
  });
});
