'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { QaRun, QaRunDetail, QaResult, QaSuite, Customer, FleetSnapshotNode } from '@cumulus/shared-types';
import { usePoll, statusClass, timeAgo } from '@/lib/ui';
import { GroupedBars, HBars, StackedBar } from '@/lib/charts';
import { DEFAULT_TARGETS } from '@/lib/report';

function RunCharts({ results, fleet }: { results: QaResult[]; fleet: FleetSnapshotNode[] }) {
  if (results.length === 0) return null;
  const nameOf = new Map(fleet.map((n) => [n.nodeId, n.name.replace('cumulus-node-', 'node-')]));

  // Aggregate per-node job distribution across all scenarios in the run.
  const dist = new Map<string, number>();
  for (const r of results) {
    for (const [nodeId, n] of Object.entries(r.metrics.perNodeJobs ?? {})) {
      dist.set(nodeId, (dist.get(nodeId) ?? 0) + n);
    }
  }
  const segments = [...dist.entries()]
    .map(([id, value]) => ({ label: nameOf.get(id) ?? id.slice(0, 6), value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <div className="mb-1 text-sm font-medium">Latency by use case (lower is better)</div>
        <GroupedBars
          groups={results.map((r) => ({
            label: r.useCase,
            values: { p50: r.latencyP50Ms ?? 0, p95: r.latencyP95Ms ?? 0 },
          }))}
          series={[
            { key: 'p50', label: 'p50 ms' },
            { key: 'p95', label: 'p95 ms', color: '#f59e0b' },
          ]}
          unit="ms"
          target={DEFAULT_TARGETS.sloP95Ms}
          targetLabel="SLO"
        />
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Throughput by use case (higher is better)</div>
        <HBars
          rows={results.map((r) => ({ label: r.useCase, value: r.throughputPerSec ?? 0 }))}
          unit="/s"
          target={DEFAULT_TARGETS.minThroughputPerSec}
          higherIsBetter
        />
        {segments.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-sm font-medium">Work distribution across the pool</div>
            <StackedBar segments={segments} />
          </div>
        )}
      </div>
    </div>
  );
}

function fmtMs(ms?: number): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function ScenarioTable({ results }: { results: QaResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (results.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted">running scenarios…</p>;
  }
  return (
    <table className="tabular w-full text-sm">
      <thead>
        <tr>
          <th>Use case</th>
          <th>OK</th>
          <th>p50</th>
          <th>p95</th>
          <th>Throughput</th>
          <th>Quality</th>
          <th>Overflow</th>
          <th>Per-node</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => {
          const dist = r.metrics.perNodeJobs ?? {};
          const isOpen = open === r.id;
          return (
            <Fragment key={r.id}>
              <tr>
                <td className="font-medium">{r.useCase}</td>
                <td>
                  {r.metrics.skipped ? (
                    <span className="text-muted" title={String(r.metrics.reason ?? '')}>skipped</span>
                  ) : (
                    <>
                      {r.succeeded}/{r.requestCount}
                      {r.failed > 0 && <span className="text-red-300"> ({r.failed}✗)</span>}
                    </>
                  )}
                </td>
                <td>{fmtMs(r.latencyP50Ms)}</td>
                <td>{fmtMs(r.latencyP95Ms)}</td>
                <td>{r.throughputPerSec != null ? `${r.throughputPerSec}/s` : '—'}</td>
                <td>
                  {r.metrics.qualityMetric && r.metrics.qualityValue != null
                    ? `${r.metrics.qualityMetric} ${Math.round(r.metrics.qualityValue * 100)}%`
                    : '—'}
                </td>
                <td>{r.metrics.overflowRatio != null ? `${Math.round(r.metrics.overflowRatio * 100)}%` : '—'}</td>
                <td className="font-mono text-xs text-muted">
                  {Object.values(dist).join(' / ') || '—'}
                </td>
                <td>
                  <button className="btn" onClick={() => setOpen(isOpen ? null : r.id)}>
                    {isOpen ? 'hide' : 'results ▾'}
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={9} className="bg-ink/60">
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all p-3 text-xs text-emerald-200">
                      {JSON.stringify(
                        {
                          scenarioKey: r.scenarioKey,
                          counts: { requests: r.requestCount, ok: r.succeeded, failed: r.failed },
                          latencyMs: { p50: r.latencyP50Ms, p95: r.latencyP95Ms, max: r.latencyMaxMs },
                          throughputPerSec: r.throughputPerSec,
                          ...r.metrics,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { data } = usePoll<QaRunDetail>(`/api/qa/runs/${runId}`, 2000);
  if (!data) return <p className="text-muted">loading run…</p>;
  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge p-3">
        <span className="font-semibold">{data.envLabel}</span>
        <span className={`pill ${statusClass(data.status)}`}>{data.status}</span>
        <span className="text-xs text-muted">
          suite {data.suiteVersion} · {data.fleetSnapshot.length} nodes · {timeAgo(data.startedAt)}
        </span>
      </div>
      <RunCharts results={data.results} fleet={data.fleetSnapshot} />
      <div className="border-t border-edge">
        <ScenarioTable results={data.results} />
      </div>
    </div>
  );
}

export default function TestCenterPage() {
  const { data: customers } = usePoll<Customer[]>('/api/customers', 5000);
  const { data: runs } = usePoll<QaRun[]>('/api/qa/runs', 3000);
  const [suite, setSuite] = useState<QaSuite | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [envLabel, setEnvLabel] = useState('cpu-cx23-3node');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/qa/suite')
      .then((r) => r.json())
      .then((s: QaSuite) => {
        setSuite(s);
        setPicked(new Set(s.scenarios.map((sc) => sc.key)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!customerId && customers && customers.length > 0) setCustomerId(customers[0]!.id);
  }, [customers, customerId]);

  const toggle = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const launch = async () => {
    if (!customerId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/qa/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envLabel, customerId, scenarioKeys: [...picked] }),
      });
      const json = await res.json();
      if (json.runId) setSelectedRun(json.runId);
    } finally {
      setBusy(false);
    }
  };

  // Runs owned by the selected test user.
  const userRuns = (runs ?? []).filter((r) => r.customerId === customerId);
  const activeRun = selectedRun ?? userRuns[0]?.id ?? null;
  const noCustomers = customers && customers.length === 0;

  return (
    <main className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Test Center</h1>
        <span className="text-sm text-muted">
          a test user runs the defined QA suite via the API; results come back here
        </span>
      </div>

      {noCustomers ? (
        <div className="card text-sm">
          No test users yet. <Link className="underline" href="/ops/customers">Create one in Customers →</Link>
        </div>
      ) : (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block text-sm text-muted">Act as test user</span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded border border-edge bg-ink px-3 py-2 text-sm"
              >
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.keyPrefix}…)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-sm text-muted">Environment label</span>
              <input
                value={envLabel}
                onChange={(e) => setEnvLabel(e.target.value)}
                className="rounded border border-edge bg-ink px-3 py-2 text-sm"
              />
            </label>
            <button className="btn ml-auto" disabled={busy || picked.size === 0} onClick={launch}>
              {busy ? 'launching…' : `Run QA as test user (${picked.size})`}
            </button>
          </div>

          {/* The tests we defined — the user picks which to run. */}
          <div>
            <span className="mb-2 block text-sm text-muted">Tests to run (defined by us)</span>
            <div className="flex flex-wrap gap-2">
              {(suite?.scenarios ?? []).map((sc) => (
                <label
                  key={sc.key}
                  className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                    picked.has(sc.key) ? 'border-emerald-600/60 bg-emerald-500/10' : 'border-edge'
                  }`}
                  title={sc.description}
                >
                  <input
                    type="checkbox"
                    className="mr-1 align-middle"
                    checked={picked.has(sc.key)}
                    onChange={() => toggle(sc.key)}
                  />
                  {sc.useCase}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeRun && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted">Results returned to the test user</h2>
          <RunDetail runId={activeRun} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">This user&apos;s past runs</h2>
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
              {userRuns.map((r) => (
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
                    <button className="btn" onClick={() => setSelectedRun(r.id)}>
                      view
                    </button>
                  </td>
                </tr>
              ))}
              {userRuns.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    No runs for this test user yet — launch one above.
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
