'use client';
import { useState } from 'react';
import type { QaRun, QaRunDetail, QaResult } from '@cumulus/shared-types';
import { usePoll, statusClass, timeAgo } from '@/lib/ui';

function fmtMs(ms?: number): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function ScenarioRow({ r }: { r: QaResult }) {
  const dist = r.metrics.perNodeJobs ?? {};
  const distStr = Object.entries(dist)
    .map(([id, n]) => `${id.slice(0, 6)}:${n}`)
    .join('  ');
  return (
    <tr>
      <td className="font-medium">{r.useCase}</td>
      <td className="text-muted">{r.scenarioKey}</td>
      <td>
        {r.succeeded}/{r.requestCount}
        {r.failed > 0 && <span className="text-red-300"> ({r.failed} failed)</span>}
      </td>
      <td>{fmtMs(r.latencyP50Ms)}</td>
      <td>{fmtMs(r.latencyP95Ms)}</td>
      <td>{r.throughputPerSec != null ? `${r.throughputPerSec}/s` : '—'}</td>
      <td>{r.metrics.overflowRatio != null ? `${Math.round(r.metrics.overflowRatio * 100)}%` : '—'}</td>
      <td className="text-xs text-muted">{distStr || '—'}</td>
    </tr>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { data } = usePoll<QaRunDetail>(`/api/qa/runs/${runId}`, 2000);
  if (!data) return <p className="text-muted">loading run…</p>;
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-3">
        <span className="font-semibold">{data.envLabel}</span>
        <span className={`pill ${statusClass(data.status)}`}>{data.status}</span>
        <span className="text-xs text-muted">
          suite {data.suiteVersion} · {data.fleetSnapshot.length} nodes · {timeAgo(data.startedAt)}
        </span>
      </div>
      <table className="tabular w-full text-sm">
        <thead>
          <tr>
            <th>Use case</th>
            <th>Scenario</th>
            <th>OK</th>
            <th>p50</th>
            <th>p95</th>
            <th>Throughput</th>
            <th>Overflow</th>
            <th>Per-node jobs</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r) => (
            <ScenarioRow key={r.id} r={r} />
          ))}
          {data.results.length === 0 && (
            <tr>
              <td colSpan={8} className="py-4 text-center text-muted">
                {data.status === 'running' ? 'running scenarios…' : 'no results'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TestCenterPage() {
  const { data: runs } = usePoll<QaRun[]>('/api/qa/runs', 3000);
  const [envLabel, setEnvLabel] = useState('cpu-cx23-3node');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const launch = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/qa/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envLabel }),
      });
      const json = await res.json();
      if (json.runId) setSelected(json.runId);
    } finally {
      setBusy(false);
    }
  };

  const activeRun = selected ?? runs?.[0]?.id ?? null;

  return (
    <main className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Test Center</h1>
        <span className="text-sm text-muted">standardized QA suite · rerun as hardware evolves</span>
      </div>

      <div className="card flex items-end gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-sm text-muted">
            Environment label (tag this hardware generation)
          </span>
          <input
            value={envLabel}
            onChange={(e) => setEnvLabel(e.target.value)}
            className="w-full rounded border border-edge bg-ink px-3 py-2 text-sm"
            placeholder="e.g. cpu-cx23-3node, gpu-a10-1node"
          />
        </label>
        <button className="btn" disabled={busy} onClick={launch}>
          {busy ? 'launching…' : 'Run QA suite'}
        </button>
      </div>

      {activeRun && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted">Current / selected run</h2>
          <RunDetail runId={activeRun} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Past runs — compare across generations</h2>
        <div className="card overflow-x-auto p-0">
          <table className="tabular w-full text-sm">
            <thead>
              <tr>
                <th>Environment</th>
                <th>Status</th>
                <th>Nodes</th>
                <th>Requests</th>
                <th>Worst p95</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.envLabel}</td>
                  <td>
                    <span className={`pill ${statusClass(r.status)}`}>{r.status}</span>
                  </td>
                  <td>{r.fleetSnapshot.length}</td>
                  <td>{r.summary?.totalRequests ?? '—'}</td>
                  <td>{fmtMs(r.summary?.overallLatencyP95Ms)}</td>
                  <td className="text-muted">{timeAgo(r.startedAt)}</td>
                  <td>
                    <button className="btn" onClick={() => setSelected(r.id)}>
                      view
                    </button>
                  </td>
                </tr>
              ))}
              {runs && runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    No runs yet — launch one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
