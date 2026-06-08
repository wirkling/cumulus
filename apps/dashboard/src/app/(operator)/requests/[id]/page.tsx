'use client';
import { use } from 'react';
import type { RequestDetail } from '@cumulus/shared-types';
import { usePoll, statusClass } from '@/lib/ui';

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = usePoll<RequestDetail>(`/api/requests/${id}`, 1500);

  if (error) return <main className="card text-red-300">{error}</main>;
  if (!data) return <main className="text-muted">loading…</main>;

  const retry = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
  };

  return (
    <main className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{data.workloadType}</h1>
        <span className={`pill ${statusClass(data.status)}`}>{data.status}</span>
      </div>

      <div className="card grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        <Meta k="Fan-out" v={String(data.fanOut)} />
        <Meta k="Origin" v={data.originLocation?.label ?? '—'} />
        <Meta k="Merge" v={data.mergeStrategy} />
        <Meta k="Policy" v={data.completionPolicy + (data.quorum ? ` (k=${data.quorum})` : '')} />
      </div>

      {/* The scatter view — each shard, where it landed, how far, its score. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">
          Scatter — {data.jobs.length} shard{data.jobs.length === 1 ? '' : 's'} across the pool
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.jobs.map((j) => (
            <div key={j.id} className="card">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">shard {j.shardIndex}</span>
                <span className={`pill ${statusClass(j.status)}`}>{j.status}</span>
              </div>
              <dl className="space-y-1 text-xs text-muted">
                <Row k="node" v={j.nodeName ?? j.latestAttempt?.nodeId?.slice(0, 8) ?? 'unplaced'} />
                <Row
                  k="distance"
                  v={
                    j.latestAttempt?.placementDistanceKm != null
                      ? `${Math.round(j.latestAttempt.placementDistanceKm)} km`
                      : '—'
                  }
                />
                <Row k="score" v={j.latestAttempt?.placementScore != null ? j.latestAttempt.placementScore.toFixed(3) : '—'} />
                <Row k="attempts" v={String(j.attemptCount)} />
              </dl>
              {(j.status === 'failed' || j.status === 'retrying') && (
                <button className="btn mt-2 w-full" onClick={() => retry(j.id)}>
                  retry
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* The gather — merged result on completion. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Gather — merged result</h2>
        <div className="card">
          {data.mergedResult != null ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-emerald-200">
              {JSON.stringify(data.mergedResult, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted">
              {['completed', 'partial'].includes(data.status)
                ? 'no result'
                : 'waiting for shards to complete…'}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-muted">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt>{k}</dt>
      <dd className="text-gray-300">{v}</dd>
    </div>
  );
}
