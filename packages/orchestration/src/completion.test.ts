import { describe, it, expect } from 'vitest';
import { evaluateCompletion, type JobState } from './completion.js';

function jobs(states: ('pending' | 'succeeded' | 'failed')[]): JobState[] {
  return states.map((status, i) => ({ jobId: `j${i}`, shardIndex: i, status }));
}

describe('wait_for_all', () => {
  const base = { policy: 'wait_for_all' as const, onPartial: 'fail' as const, timedOut: false };

  it('keeps waiting while jobs are pending', () => {
    const d = evaluateCompletion({ ...base, jobs: jobs(['succeeded', 'pending']) });
    expect(d.done).toBe(false);
  });

  it('completes when all succeed', () => {
    const d = evaluateCompletion({ ...base, jobs: jobs(['succeeded', 'succeeded']) });
    expect(d.done).toBe(true);
    expect(d.status).toBe('completed');
    expect(d.includeShards).toEqual([0, 1]);
  });

  it('fails when any fails and onPartial=fail', () => {
    const d = evaluateCompletion({ ...base, jobs: jobs(['succeeded', 'failed']) });
    expect(d.status).toBe('failed');
  });

  it('returns partial when onPartial=return_partial', () => {
    const d = evaluateCompletion({
      ...base,
      onPartial: 'return_partial',
      jobs: jobs(['succeeded', 'failed']),
    });
    expect(d.status).toBe('partial');
    expect(d.includeShards).toEqual([0]);
  });

  it('fails on timeout with no successes', () => {
    const d = evaluateCompletion({ ...base, timedOut: true, jobs: jobs(['pending', 'pending']) });
    expect(d.status).toBe('failed');
  });

  it('returns partial on timeout with some successes', () => {
    const d = evaluateCompletion({
      ...base,
      onPartial: 'return_partial',
      timedOut: true,
      jobs: jobs(['succeeded', 'pending']),
    });
    expect(d.status).toBe('partial');
    expect(d.includeShards).toEqual([0]);
  });
});

describe('wait_for_quorum', () => {
  const base = { policy: 'wait_for_quorum' as const, onPartial: 'fail' as const, timedOut: false };

  it('completes and cancels siblings when quorum is met', () => {
    const d = evaluateCompletion({
      ...base,
      quorum: 2,
      jobs: jobs(['succeeded', 'succeeded', 'pending']),
    });
    expect(d.done).toBe(true);
    expect(d.status).toBe('completed');
    expect(d.includeShards).toEqual([0, 1]);
    expect(d.cancelJobIds).toEqual(['j2']); // abandon the straggler
  });

  it('keeps waiting while quorum is still reachable', () => {
    const d = evaluateCompletion({
      ...base,
      quorum: 2,
      jobs: jobs(['succeeded', 'pending', 'pending']),
    });
    expect(d.done).toBe(false);
  });

  it('fails when quorum becomes unreachable', () => {
    const d = evaluateCompletion({
      ...base,
      quorum: 3,
      jobs: jobs(['succeeded', 'failed', 'failed']),
    });
    expect(d.status).toBe('failed');
  });
});

describe('hedging seam', () => {
  it('throws — first_valid_wins_cancel_siblings is a deferred seam', () => {
    expect(() =>
      evaluateCompletion({
        policy: 'first_valid_wins_cancel_siblings',
        onPartial: 'fail',
        timedOut: false,
        jobs: jobs(['succeeded']),
      }),
    ).toThrow(/deferred seam/);
  });
});
