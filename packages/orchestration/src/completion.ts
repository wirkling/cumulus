/**
 * Completion policy — the seam that matters (spec §4.4).
 *
 * A first-class, pluggable concept. v1 ships `wait_for_all` and
 * `wait_for_quorum`. The interface is deliberately able to express
 * `first_valid_wins_cancel_siblings` (what hedging will use) so that policy
 * drops in later WITHOUT touching orchestration internals. We do NOT build
 * hedging/racing here (spec §9) — only leave the door open.
 */
import type {
  CompletionPolicy,
  OnPartial,
  RequestStatus,
} from '@cumulus/shared-types';

/** The state of one child job as seen by the completion evaluator. */
export interface JobState {
  jobId: string;
  shardIndex: number;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface CompletionInput {
  policy: CompletionPolicy;
  onPartial: OnPartial;
  /** Required for wait_for_quorum. */
  quorum?: number;
  jobs: JobState[];
  /** Whether the request-level timeout has elapsed. */
  timedOut: boolean;
}

export interface CompletionDecision {
  /** Whether the request is finished (no more waiting). */
  done: boolean;
  /** Terminal request status, when done. */
  status?: Extract<RequestStatus, 'completed' | 'partial' | 'failed'>;
  /** Shards whose results should be included in the merge. */
  includeShards: number[];
  /** Jobs whose siblings should be cancelled (used by the hedging seam). */
  cancelJobIds: string[];
  reason: string;
}

function succeeded(jobs: JobState[]): JobState[] {
  return jobs.filter((j) => j.status === 'succeeded');
}
function failed(jobs: JobState[]): JobState[] {
  return jobs.filter((j) => j.status === 'failed');
}
function pending(jobs: JobState[]): JobState[] {
  return jobs.filter((j) => j.status === 'pending');
}

/**
 * Evaluate whether a request is complete. Called whenever a child job changes
 * state or the timeout sweep fires.
 */
export function evaluateCompletion(input: CompletionInput): CompletionDecision {
  const { jobs, policy, onPartial, timedOut } = input;
  const ok = succeeded(jobs);
  const bad = failed(jobs);
  const wait = pending(jobs);
  const okShards = ok.map((j) => j.shardIndex);

  switch (policy) {
    case 'wait_for_all': {
      if (ok.length === jobs.length && jobs.length > 0) {
        return done('completed', okShards, [], 'all jobs succeeded');
      }
      // A definitive failure (no pending left, not all succeeded) OR a timeout.
      if (wait.length === 0 || timedOut) {
        if (ok.length === 0) {
          return done('failed', [], [], timedOut ? 'timed out with no successes' : 'all jobs failed');
        }
        return onPartial === 'return_partial'
          ? done('partial', okShards, [], `partial: ${ok.length}/${jobs.length} succeeded`)
          : done('failed', [], [], `incomplete (${bad.length} failed) and onPartial=fail`);
      }
      return keepWaiting(`${ok.length}/${jobs.length} done, ${wait.length} pending`);
    }

    case 'wait_for_quorum': {
      const k = input.quorum ?? jobs.length;
      if (ok.length >= k) {
        // Quorum met — succeed and abandon the still-pending siblings.
        return done('completed', okShards, wait.map((j) => j.jobId), `quorum ${k} met`);
      }
      // Can quorum still be reached?
      const reachable = ok.length + wait.length;
      if (reachable < k || timedOut) {
        if (ok.length === 0) {
          return done('failed', [], [], timedOut ? 'timed out before quorum' : 'quorum unreachable');
        }
        return onPartial === 'return_partial'
          ? done('partial', okShards, wait.map((j) => j.jobId), `partial below quorum: ${ok.length}/${k}`)
          : done('failed', [], [], `quorum ${k} unreachable and onPartial=fail`);
      }
      return keepWaiting(`${ok.length}/${k} toward quorum, ${wait.length} pending`);
    }

    case 'first_valid_wins_cancel_siblings':
      // SEAM ONLY — intentionally not implemented in v1 (spec §9). The shape of
      // the decision (cancelJobIds) already supports it; wiring is deferred.
      throw new Error(
        'completion policy first_valid_wins_cancel_siblings is a deferred seam (spec §9)',
      );

    default:
      return done('failed', [], [], `unknown completion policy: ${policy as string}`);
  }
}

function done(
  status: NonNullable<CompletionDecision['status']>,
  includeShards: number[],
  cancelJobIds: string[],
  reason: string,
): CompletionDecision {
  return { done: true, status, includeShards, cancelJobIds, reason };
}

function keepWaiting(reason: string): CompletionDecision {
  return { done: false, includeShards: [], cancelJobIds: [], reason };
}
