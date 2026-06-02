/** Pure report computation over selected QA runs — kept out of the component
 * so it's easy to reason about (and unit-test later). */
import type { QaRunDetail, QaResult, FleetSnapshotNode } from '@cumulus/shared-types';

export interface EconomicsAssumptions {
  costPerNodeMonthEur: number;
  revenuePerThousandJobsEur: number;
  activeHoursPerDay: number;
}

export const DEFAULT_ASSUMPTIONS: EconomicsAssumptions = {
  costPerNodeMonthEur: 4, // cx23 ≈ €3.99/mo
  revenuePerThousandJobsEur: 50,
  activeHoursPerDay: 24,
};

/** Target numbers the report grades against (editable defaults, not hard truth).
 * Reflects the latency-relaxed positioning: generous SLO, high reliability,
 * pooling efficiency, and a viable margin. */
export interface ReportTargets {
  successPct: number;
  sloP95Ms: number;
  minThroughputPerSec: number;
  grossMarginPct: number;
}

export const DEFAULT_TARGETS: ReportTargets = {
  successPct: 99,
  sloP95Ms: 60000, // batch/async — interactive (<1s) is out of scope by design
  minThroughputPerSec: 1,
  grossMarginPct: 50,
};

export type ScoreStatus = 'pass' | 'warn' | 'fail';

export interface ScorecardItem {
  metric: string;
  target: string;
  actual: string;
  status: ScoreStatus;
}

function grade(pass: boolean, near: boolean): ScoreStatus {
  return pass ? 'pass' : near ? 'warn' : 'fail';
}

export interface RunSetup {
  runId: string;
  envLabel: string;
  nodeCount: number;
  cities: string[];
  machineTypes: string[];
  avgCpuBenchmark?: number;
  timeOfDay: string; // local HH:MM
  startedAt: string;
  suiteVersion: string;
  customerId?: string;
}

export function setupOf(run: QaRunDetail): RunSetup {
  const fleet: FleetSnapshotNode[] = run.fleetSnapshot ?? [];
  const cities = [...new Set(fleet.map((n) => n.city).filter((c): c is string => !!c))];
  const machineTypes = [...new Set(fleet.map((n) => n.nodeType))];
  const benches = fleet.map((n) => n.cpuBenchmark).filter((b): b is number => typeof b === 'number');
  const d = new Date(run.startedAt);
  const timeOfDay = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    runId: run.id,
    envLabel: run.envLabel,
    nodeCount: fleet.length,
    cities,
    machineTypes,
    avgCpuBenchmark: benches.length ? Math.round(benches.reduce((a, b) => a + b, 0) / benches.length) : undefined,
    timeOfDay,
    startedAt: run.startedAt,
    suiteVersion: run.suiteVersion,
    customerId: run.customerId,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export interface DeviationRow {
  useCase: string;
  /** p95 per run (by runId), undefined if the run didn't include this scenario. */
  p95: Record<string, number | undefined>;
  min?: number;
  max?: number;
  meanMs?: number;
  /** Coefficient of variation (%) — the operational-risk signal. */
  cvPct?: number;
}

export interface Report {
  runs: QaRunDetail[];
  setups: RunSetup[];
  useCases: string[];
  kpis: {
    runs: number;
    totalRequests: number;
    overallSuccessPct: number;
    bestP95Ms?: number;
    worstP95Ms?: number;
    locations: number;
    machineTypes: number;
  };
  deviations: DeviationRow[];
  resultByRunUseCase: Map<string, QaResult>; // key `${runId}::${useCase}`
}

const key = (runId: string, useCase: string): string => `${runId}::${useCase}`;

export function buildReport(runs: QaRunDetail[]): Report {
  const setups = runs.map(setupOf);
  const useCases = [...new Set(runs.flatMap((r) => r.results.map((s) => s.useCase)))];
  const resultByRunUseCase = new Map<string, QaResult>();
  for (const run of runs) {
    for (const r of run.results) resultByRunUseCase.set(key(run.id, r.useCase), r);
  }

  const deviations: DeviationRow[] = useCases.map((uc) => {
    const p95: Record<string, number | undefined> = {};
    const present: number[] = [];
    for (const run of runs) {
      const r = resultByRunUseCase.get(key(run.id, uc));
      p95[run.id] = r?.latencyP95Ms;
      if (typeof r?.latencyP95Ms === 'number') present.push(r.latencyP95Ms);
    }
    const m = mean(present);
    return {
      useCase: uc,
      p95,
      min: present.length ? Math.min(...present) : undefined,
      max: present.length ? Math.max(...present) : undefined,
      meanMs: present.length ? Math.round(m) : undefined,
      cvPct: present.length > 1 && m > 0 ? Math.round((stddev(present) / m) * 100) : undefined,
    };
  });

  const allResults = runs.flatMap((r) => r.results);
  const totalRequests = allResults.reduce((a, r) => a + r.requestCount, 0);
  const totalOk = allResults.reduce((a, r) => a + r.succeeded, 0);
  const allP95 = allResults.map((r) => r.latencyP95Ms).filter((v): v is number => typeof v === 'number');

  return {
    runs,
    setups,
    useCases,
    kpis: {
      runs: runs.length,
      totalRequests,
      overallSuccessPct: totalRequests ? Math.round((totalOk / totalRequests) * 100) : 0,
      bestP95Ms: allP95.length ? Math.min(...allP95) : undefined,
      worstP95Ms: allP95.length ? Math.max(...allP95) : undefined,
      locations: new Set(setups.flatMap((s) => s.cities)).size,
      machineTypes: new Set(setups.flatMap((s) => s.machineTypes)).size,
    },
    deviations,
    resultByRunUseCase,
  };
}

export interface EconomicsRow {
  runId: string;
  envLabel: string;
  nodes: number;
  sustainedJobsPerSec: number;
  jobsPerDay: number;
  monthlyCostEur: number;
  monthlyRevenueEur: number;
  grossMarginPct: number;
}

/** Per-run unit economics from a sustained-throughput proxy (the load scenario,
 * else the peak scenario throughput). Illustrative — driven by assumptions. */
export function economics(runs: QaRunDetail[], a: EconomicsAssumptions): EconomicsRow[] {
  return runs.map((run) => {
    const load = run.results.find((r) => r.scenarioKey === 'throughput_burst');
    const sustained =
      load?.throughputPerSec ?? Math.max(0, ...run.results.map((r) => r.throughputPerSec ?? 0));
    const nodes = run.fleetSnapshot.length || 1;
    const jobsPerDay = Math.round(sustained * 3600 * a.activeHoursPerDay);
    const monthlyCost = nodes * a.costPerNodeMonthEur;
    const monthlyRevenue = Math.round(((jobsPerDay * 30) / 1000) * a.revenuePerThousandJobsEur);
    const grossMargin = monthlyRevenue > 0 ? Math.round(((monthlyRevenue - monthlyCost) / monthlyRevenue) * 100) : 0;
    return {
      runId: run.id,
      envLabel: run.envLabel,
      nodes,
      sustainedJobsPerSec: Math.round(sustained * 100) / 100,
      jobsPerDay,
      monthlyCostEur: monthlyCost,
      monthlyRevenueEur: monthlyRevenue,
      grossMarginPct: grossMargin,
    };
  });
}

const fmtMs = (ms?: number): string =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

/** Grade the pooled results against the targets — the "are we there?" verdict. */
export function scorecard(report: Report, econ: EconomicsRow[], t: ReportTargets): ScorecardItem[] {
  const bestThroughput = Math.max(0, ...econ.map((e) => e.sustainedJobsPerSec));
  const bestMargin = econ.length ? Math.max(...econ.map((e) => e.grossMarginPct)) : 0;
  const worstP95 = report.kpis.worstP95Ms;

  return [
    {
      metric: 'Job success rate',
      target: `≥ ${t.successPct}%`,
      actual: `${report.kpis.overallSuccessPct}%`,
      status: grade(report.kpis.overallSuccessPct >= t.successPct, report.kpis.overallSuccessPct >= t.successPct * 0.97),
    },
    {
      metric: 'Batch p95 (worst use case)',
      target: `≤ ${fmtMs(t.sloP95Ms)}`,
      actual: fmtMs(worstP95),
      status: grade(worstP95 != null && worstP95 <= t.sloP95Ms, worstP95 != null && worstP95 <= t.sloP95Ms * 1.5),
    },
    {
      metric: 'Sustained throughput (best setup)',
      target: `≥ ${t.minThroughputPerSec}/s`,
      actual: `${bestThroughput}/s`,
      status: grade(bestThroughput >= t.minThroughputPerSec, bestThroughput >= t.minThroughputPerSec * 0.8),
    },
    {
      metric: 'Gross margin (best setup)',
      target: `≥ ${t.grossMarginPct}%`,
      actual: `${bestMargin}%`,
      status: grade(bestMargin >= t.grossMarginPct, bestMargin >= t.grossMarginPct * 0.8),
    },
  ];
}
