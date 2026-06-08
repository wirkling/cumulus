'use client';
import { useState } from 'react';
import type { NodeSummary } from '@cumulus/shared-types';
import { usePoll, statusClass, timeAgo } from '@/lib/ui';

async function action(nodeId: string, act: string): Promise<void> {
  await fetch(`/api/nodes/${nodeId}/${act}`, { method: 'POST' });
}

export default function NodesPage() {
  const { data, error } = usePoll<NodeSummary[]>('/api/nodes', 2000);
  const [pending, setPending] = useState<string | null>(null);

  const run = async (nodeId: string, act: string) => {
    setPending(`${nodeId}:${act}`);
    await action(nodeId, act);
    setPending(null);
  };

  return (
    <main>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Nodes</h1>
        <span className="text-sm text-muted">{data ? `${data.length} registered` : 'loading…'}</span>
      </div>
      {error && <p className="card mb-4 text-red-300">Control plane unreachable: {error}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="tabular w-full text-sm">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Location</th>
              <th>CPU</th>
              <th>RAM</th>
              <th>Queue</th>
              <th>Done today</th>
              <th>Fail %</th>
              <th>Heartbeat</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((n) => (
              <tr key={n.id}>
                <td className="font-medium">{n.name}</td>
                <td>
                  <span className={`pill ${statusClass(n.status)}`}>{n.status}</span>
                </td>
                <td>{n.location?.city ?? '—'}</td>
                <td>{n.latestMetrics?.cpuUsagePct != null ? `${n.latestMetrics.cpuUsagePct}%` : '—'}</td>
                <td>{n.latestMetrics?.ramUsagePct != null ? `${n.latestMetrics.ramUsagePct}%` : '—'}</td>
                <td>{n.queueLength}</td>
                <td>{n.jobsCompletedToday}</td>
                <td>{n.failureRatePct}%</td>
                <td className="text-muted">{timeAgo(n.lastHeartbeatAt)}</td>
                <td className="space-x-1 whitespace-nowrap">
                  {(['pause', 'drain', 'benchmark'] as const).map((a) => (
                    <button
                      key={a}
                      className="btn"
                      disabled={pending === `${n.id}:${a}`}
                      onClick={() => run(n.id, a)}
                    >
                      {a}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  No nodes registered yet. Provision the fleet (infra/) or run the sim harness.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
