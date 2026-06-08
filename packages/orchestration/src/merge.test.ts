import { describe, it, expect } from 'vitest';
import { mergeResults } from './merge.js';
import { chunk, decomposeRequest } from './decompose.js';
import type { Request } from '@cumulus/shared-types';

describe('mergeResults', () => {
  it('ordered_array flattens array shards in shard order', () => {
    const merged = mergeResults('ordered_array', [
      { shardIndex: 1, result: [3, 4] },
      { shardIndex: 0, result: [1, 2] },
    ]);
    expect(merged).toEqual([1, 2, 3, 4]);
  });

  it('concat joins strings in order', () => {
    const merged = mergeResults('concat', [
      { shardIndex: 2, result: 'c' },
      { shardIndex: 0, result: 'a' },
      { shardIndex: 1, result: 'b' },
    ]);
    expect(merged).toBe('abc');
  });

  it('sum adds numeric results', () => {
    expect(
      mergeResults('sum', [
        { shardIndex: 0, result: 10 },
        { shardIndex: 1, result: 5 },
      ]),
    ).toBe(15);
  });

  it('collect keeps results keyed by shard', () => {
    const merged = mergeResults('collect', [
      { shardIndex: 1, result: { a: 1 } },
      { shardIndex: 0, result: { b: 2 } },
    ]);
    expect(merged).toEqual([
      { shardIndex: 0, result: { b: 2 } },
      { shardIndex: 1, result: { a: 1 } },
    ]);
  });

  it('single returns the first shard result', () => {
    expect(mergeResults('single', [{ shardIndex: 0, result: 42 }])).toBe(42);
  });
});

describe('chunk', () => {
  it('splits an array into roughly equal parts', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('balances unevenly-divisible arrays (front chunks get the remainder)', () => {
    expect(chunk([1, 2, 3, 4, 5], 4)).toEqual([[1, 2], [3], [4], [5]]);
  });

  it('yields a single empty shard for empty input', () => {
    expect(chunk([], 3)).toEqual([[]]);
  });
});

function req(over: Partial<Request>): Request {
  return {
    id: 'r1',
    workloadType: 'split_map_merge',
    serviceModel: 'hosted',
    status: 'queued',
    fanOut: 3,
    mergeStrategy: 'ordered_array',
    completionPolicy: 'wait_for_all',
    onPartial: 'fail',
    timeoutSeconds: 60,
    input: {},
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('decomposeRequest', () => {
  it('splits split_map_merge items across shards', () => {
    const shards = decomposeRequest(req({ fanOut: 2, input: { items: [1, 2, 3, 4] } }));
    expect(shards).toHaveLength(2);
    expect(shards[0]!.input.items).toEqual([1, 2]);
    expect(shards[1]!.input.items).toEqual([3, 4]);
  });

  it('produces N identical shards for echo_sleep', () => {
    const shards = decomposeRequest(req({ workloadType: 'echo_sleep', fanOut: 4, input: { ms: 100 } }));
    expect(shards).toHaveLength(4);
    expect(shards.every((s) => s.input.ms === 100)).toBe(true);
  });

  it('produces exactly one shard for non-fan-outable cpu_benchmark', () => {
    const shards = decomposeRequest(req({ workloadType: 'cpu_benchmark', fanOut: 8 }));
    expect(shards).toHaveLength(1);
  });
});
