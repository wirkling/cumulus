'use client';
import { useMemo, useState } from 'react';
import type { QaRun, QaRunDetail } from '@cumulus/shared-types';
import { usePoll, statusClass } from '@/lib/ui';
import { GroupedBars, HBars, TrendLine, Kpi, PALETTE } from '@/lib/charts';
import {
  buildReport,
  economics,
  scorecard,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_TARGETS,
  type EconomicsAssumptions,
  type ReportTargets,
  type ScoreStatus,
} from '@/lib/report';

const SCORE_CLASS: Record<ScoreStatus, string> = {
  pass: 'text-emerald-300',
  warn: 'text-amber-300',
  fail: 'text-red-300',
};
const SCORE_ICON: Record<ScoreStatus, string> = { pass: '✓', warn: '~', fail: '✗' };

function fmtMs(ms?: number): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function sloClass(p95: number | undefined, slo: number): string {
  if (p95 == null) return 'text-muted';
  if (p95 <= slo) return 'text-emerald-300';
  if (p95 <= slo * 2) return 'text-amber-300';
  return 'text-red-300';
}

function devClass(v: number | undefined, min?: number): string {
  if (v == null || min == null) return 'text-muted';
  if (v <= min * 1.25) return 'text-emerald-300';
  if (v <= min * 2) return 'text-amber-300';
  return 'text-red-300';
}

export default function ReportPage() {
  const { data: runs } = usePoll<QaRun[]>('/api/qa/runs', 5000);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<QaRunDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [a, setA] = useState<EconomicsAssumptions>(DEFAULT_ASSUMPTIONS);
  const [targets, setTargets] = useState<ReportTargets>(DEFAULT_TARGETS);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const generate = async () => {
    setLoading(true);
    try {
      const ids = [...selected];
      const loaded = await Promise.all(
        ids.map((id) => fetch(`/api/qa/runs/${id}`).then((r) => r.json() as Promise<QaRunDetail>)),
      );
      // Keep chronological order for the trend line.
      loaded.sort((x, y) => new Date(x.startedAt).getTime() - new Date(y.startedAt).getTime());
      setDetails(loaded);
    } finally {
      setLoading(false);
    }
  };

  const report = useMemo(() => (details ? buildReport(details) : null), [details]);
  const econ = useMemo(() => (details ? economics(details, a) : []), [details, a]);
  const scores = useMemo(
    () => (report ? scorecard(report, econ, targets) : []),
    [report, econ, targets],
  );

  const runSeries = (report?.runs ?? []).map((r, i) => ({
    key: r.id,
    label: r.envLabel,
    color: PALETTE[i % PALETTE.length],
  }));

  const exportJson = () => {
    if (!report) return;
    const payload = {
      setups: report.setups,
      kpis: report.kpis,
      scorecard: scores,
      deviations: report.deviations,
      economics: econ,
      assumptions: a,
      targets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cumulus-qa-report.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Investment-thesis Report</h1>
        {report && (
          <div className="no-print flex gap-2">
            <button className="btn" onClick={() => window.print()}>
              Print / PDF
            </button>
            <button className="btn" onClick={exportJson}>
              Export JSON
            </button>
          </div>
        )}
      </div>

      {/* Run selection — pool multiple runs across setups */}
      <div className="no-print card space-y-3">
        <div className="text-sm text-muted">Select runs to pool (compare across location / machine / time):</div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {(runs ?? [])
            .filter((r) => r.status !== 'failed')
            .map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1 text-sm hover:bg-edge/40">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="font-medium">{r.envLabel}</span>
                <span className={`pill ${statusClass(r.status)}`}>{r.status}</span>
                <span className="text-xs text-muted">
                  {r.fleetSnapshot.length} nodes · {r.fleetSnapshot.map((n) => n.city).filter(Boolean).join(', ') || '—'} ·{' '}
                  {new Date(r.startedAt).toLocaleString()}
                </span>
              </label>
            ))}
          {runs && runs.length === 0 && <p className="text-muted">No runs yet. Run some in the Test Center.</p>}
        </div>
        <button className="btn" disabled={selected.size === 0 || loading} onClick={generate}>
          {loading ? 'building…' : `Generate report from ${selected.size} run(s)`}
        </button>
      </div>

      {/* Tunable targets + economic assumptions */}
      {report && (
        <div className="no-print grid gap-3 md:grid-cols-2">
          <div className="card">
            <div className="mb-2 text-sm font-medium">Targets (graded below)</div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['successPct', 'success % (≥)'],
                  ['sloP95Ms', 'batch p95 SLO ms (≤)'],
                  ['minThroughputPerSec', 'min throughput /s (≥)'],
                  ['grossMarginPct', 'gross margin % (≥)'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-sm">
                  <span className="mb-1 block text-xs text-muted">{label}</span>
                  <input
                    type="number"
                    value={targets[k]}
                    onChange={(e) => setTargets({ ...targets, [k]: Number(e.target.value) })}
                    className="w-full rounded border border-edge bg-ink px-2 py-1.5"
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="mb-2 text-sm font-medium">Economic assumptions</div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['costPerNodeMonthEur', '€ / node / month'],
                  ['revenuePerThousandJobsEur', '€ / 1k jobs (revenue)'],
                  ['activeHoursPerDay', 'active hours / day'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-sm">
                  <span className="mb-1 block text-xs text-muted">{label}</span>
                  <input
                    type="number"
                    value={a[k]}
                    onChange={(e) => setA({ ...a, [k]: Number(e.target.value) })}
                    className="w-full rounded border border-edge bg-ink px-2 py-1.5"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="space-y-6">
          {/* Headline KPIs */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Runs pooled" value={String(report.kpis.runs)} sub={`${report.kpis.totalRequests} requests`} />
            <Kpi label="Overall success" value={`${report.kpis.overallSuccessPct}%`} />
            <Kpi label="Best p95" value={fmtMs(report.kpis.bestP95Ms)} sub={`worst ${fmtMs(report.kpis.worstP95Ms)}`} />
            <Kpi label="Footprint" value={`${report.kpis.locations} loc · ${report.kpis.machineTypes} type`} />
          </section>

          {/* Targets vs actual scorecard — the "are we there?" verdict */}
          <section>
            <h2 className="mb-2 font-semibold">Targets vs actual</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {scores.map((s) => (
                <div key={s.metric} className="card">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">{s.metric}</span>
                    <span className={`text-lg ${SCORE_CLASS[s.status]}`}>{SCORE_ICON[s.status]}</span>
                  </div>
                  <div className={`mt-1 text-xl font-semibold tabular-nums ${SCORE_CLASS[s.status]}`}>{s.actual}</div>
                  <div className="text-xs text-muted">target {s.target}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Setup matrix — what differs between the pooled runs */}
          <section>
            <h2 className="mb-2 font-semibold">Test setups</h2>
            <div className="card overflow-x-auto p-0">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr>
                    <th>Environment</th>
                    <th>Nodes</th>
                    <th>Locations</th>
                    <th>Machines</th>
                    <th>Avg CPU bench</th>
                    <th>Time of day</th>
                  </tr>
                </thead>
                <tbody>
                  {report.setups.map((s, i) => (
                    <tr key={s.runId}>
                      <td className="font-medium">
                        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                        {s.envLabel}
                      </td>
                      <td>{s.nodeCount}</td>
                      <td>{s.cities.join(', ') || '—'}</td>
                      <td>{s.machineTypes.join(', ')}</td>
                      <td>{s.avgCpuBenchmark?.toLocaleString() ?? '—'}</td>
                      <td className="text-muted">{s.timeOfDay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Latency + throughput comparison charts */}
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-2 font-semibold">p95 latency by use case</h2>
              <GroupedBars
                groups={report.useCases.map((uc) => ({
                  label: uc,
                  values: Object.fromEntries(report.runs.map((r) => [r.id, report.resultByRunUseCase.get(`${r.id}::${uc}`)?.latencyP95Ms ?? 0])),
                }))}
                series={runSeries}
                unit="ms"
                target={targets.sloP95Ms}
                targetLabel="SLO"
              />
            </div>
            <div className="card">
              <h2 className="mb-2 font-semibold">Throughput by use case</h2>
              <GroupedBars
                groups={report.useCases.map((uc) => ({
                  label: uc,
                  values: Object.fromEntries(report.runs.map((r) => [r.id, report.resultByRunUseCase.get(`${r.id}::${uc}`)?.throughputPerSec ?? 0])),
                }))}
                series={runSeries}
                unit="/s"
              />
            </div>
          </section>

          {/* Deviation matrix — operational-risk signal */}
          <section>
            <h2 className="mb-2 font-semibold">Latency deviation across setups (p95)</h2>
            <p className="mb-2 text-sm text-muted">
              Low variation (CV) = dependable infrastructure regardless of where/when it runs.
            </p>
            <div className="card overflow-x-auto p-0">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr>
                    <th>Use case</th>
                    {report.setups.map((s) => (
                      <th key={s.runId}>{s.envLabel}</th>
                    ))}
                    <th>Spread (CV)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.deviations.map((d) => (
                    <tr key={d.useCase}>
                      <td className="font-medium">{d.useCase}</td>
                      {report.runs.map((r) => (
                        <td key={r.id} className={devClass(d.p95[r.id], d.min)}>
                          {fmtMs(d.p95[r.id])}
                        </td>
                      ))}
                      <td className={d.cvPct != null && d.cvPct > 30 ? 'text-amber-300' : 'text-gray-300'}>
                        {d.cvPct != null ? `${d.cvPct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Viability map vs SLO — addressable workloads */}
          <section>
            <h2 className="mb-2 font-semibold">Workload viability vs p95 SLO ({targets.sloP95Ms}ms)</h2>
            <div className="card overflow-x-auto p-0">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr>
                    <th>Use case</th>
                    {report.setups.map((s) => (
                      <th key={s.runId}>{s.envLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.useCases.map((uc) => (
                    <tr key={uc}>
                      <td className="font-medium">{uc}</td>
                      {report.runs.map((r) => {
                        const p95 = report.resultByRunUseCase.get(`${r.id}::${uc}`)?.latencyP95Ms;
                        const ok = p95 != null && p95 <= targets.sloP95Ms;
                        const amber = p95 != null && p95 <= targets.sloP95Ms * 2;
                        return (
                          <td key={r.id} className={sloClass(p95, targets.sloP95Ms)}>
                            {p95 == null ? '—' : ok ? '● meets' : amber ? '● near' : '● misses'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Unit economics (illustrative) */}
          <section>
            <h2 className="mb-1 font-semibold">Unit economics (illustrative)</h2>
            <p className="mb-2 text-sm text-muted">
              Driven by the assumptions above — sustained throughput × active hours → daily capacity → revenue proxy
              vs node cost. Estimates, not booked revenue.
            </p>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="card overflow-x-auto p-0">
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr>
                      <th>Setup</th>
                      <th>Nodes</th>
                      <th>Jobs/s</th>
                      <th>Jobs/day</th>
                      <th>Cost/mo</th>
                      <th>Rev/mo</th>
                      <th>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {econ.map((e) => (
                      <tr key={e.runId}>
                        <td className="font-medium">{e.envLabel}</td>
                        <td>{e.nodes}</td>
                        <td>{e.sustainedJobsPerSec}</td>
                        <td>{e.jobsPerDay.toLocaleString()}</td>
                        <td>€{e.monthlyCostEur}</td>
                        <td>€{e.monthlyRevenueEur.toLocaleString()}</td>
                        <td className={e.grossMarginPct >= 0 ? 'text-emerald-300' : 'text-red-300'}>{e.grossMarginPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h3 className="mb-2 text-sm font-medium">Gross margin by setup</h3>
                <HBars
                  rows={econ.map((e) => ({ label: e.envLabel, value: e.grossMarginPct }))}
                  unit="%"
                  max={100}
                  target={targets.grossMarginPct}
                  higherIsBetter
                />
              </div>
            </div>
          </section>

          {/* Trend over time / generations */}
          {report.runs.length > 1 && (
            <section className="card">
              <h2 className="mb-2 font-semibold">Trajectory — worst p95 across pooled runs</h2>
              <TrendLine
                points={report.setups.map((s) => ({
                  label: s.envLabel,
                  value: Math.max(0, ...report.runs.find((r) => r.id === s.runId)!.results.map((x) => x.latencyP95Ms ?? 0)),
                }))}
                unit="ms"
                target={targets.sloP95Ms}
              />
            </section>
          )}

          <p className="text-xs text-muted">
            Generated by Cumulus Test Center · suite {report.runs[0]?.suiteVersion} · {report.kpis.runs} pooled runs.
          </p>
        </div>
      )}
    </main>
  );
}
