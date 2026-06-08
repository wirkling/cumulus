/**
 * Board-view economics — ONE shared assumptions block; everything (site
 * revenue, the property calculator, the pipeline, gross margin) derives from it,
 * so the numbers are internally consistent. NODES are real (live from the
 * control plane); the money is SIMULATED and deterministically seeded per node
 * id. Anchored on GPU/target economics — all figures are "geschätzt" (preview).
 */
import type { NodeSummary } from '@cumulus/shared-types';
import type { PortfolioSite } from './tamax-portfolio';

// ── single source of truth ───────────────────────────────────────────────────
export const ASSUMPTIONS = {
  // Conservative base: Vast/RunPod 4090 ≈ $0.40–0.50/h → ~$207–260/mo at 72%
  // util; after platform fee / FX / idle, a conservative €/GPU/mo is ~220–300.
  // NOTE: this is Cumulus's GROSS compute revenue — the real-estate host receives
  // hostSharePct of it (see boardKpis), not the full amount.
  revPerGpuMonth: 260, // €/GPU/month (Model A/B blended, conservative) — the anchor
  kwPerGpu: 0.6, // consumer GPU (4090 ≈ 0.45 kW) + cooling/overhead (PUE ≈ 1.3)
  sqmPerGpu: 0.5, // effective m²/GPU in a building retrofit (rack + aisle + cooling/electrical)
  targetUtilizationPct: 72, // assumed steady-state utilization
  energyPriceEurKwh: 0.3, // €/kWh (German grid; adjustable)
  avgSolarPct: 18, // avg on-site generation share
  // RE host's share — basis depends on splitMode (% of gross / % of operating
  // profit / fixed rent). Default is profit-based (can never make Cumulus negative).
  hostSharePct: 0.4,
  fixedRentPerKwMonth: 80, // alt: fixed rent per kW of compute (Fixpreis mode)
  // Share of a building's MAX grid connection realistically usable as flexible /
  // curtailable compute load. KEY assumption to calibrate with grid knowledge.
  computeHeadroomPct: 0.2,
  // Cumulus capex: fully-installed €/GPU — GPU + host/"feeder" server + network +
  // rack/PDU + cooling + electrical/install. Cumulus funds it (adjustable).
  capexPerGpuEur: 4500,
  hardwareLifeMonths: 36, // amortization period
  // Heat reuse — waste heat warms the host's building, offsetting their heating
  // bill. This is value to the HOST (justifies a modest cash share).
  heatRecoveryPct: 0.6, // share of consumed power recoverable as useful heat
  heatValueEurKwh: 0.1, // €/kWh-thermal the host would otherwise pay
};

export type SplitMode = 'umsatz' | 'ergebnis' | 'fix';
const HOURS_PER_MONTH = 730;
/** Derived: every €/kW figure on the board uses this one rate (≈ €355). */
export const revPerKwMonth = ASSUMPTIONS.revPerGpuMonth / ASSUMPTIONS.kwPerGpu;

// ── deterministic PRNG (so server/client + refreshes agree) ──────────────────
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hashStr(seed) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length]!;

export interface Site {
  id: string;
  name: string;
  buildingName: string;
  siteType: string;
  city: string;
  lat: number;
  lng: number;
  online: boolean;
  kind: 'gpu' | 'cpu';
  capacityKw: number;
  powerDrawKw: number;
  gridDrawKw: number;
  solarPct: number;
  utilizationPct: number;
  monthlyRevenueEur: number;
  uptimePct: number;
}

const SITE_TYPES = [
  'Technikgeschoss',
  'Erdgeschoss-Einheit',
  'Kellerraum',
  'Gewerbeeinheit',
  'Dachzentrale',
];

/** Derive a site economic profile from a real node — all revenue at the shared
 * rate (revPerKwMonth), scaled by the site's actual utilization. */
export function siteFromNode(n: NodeSummary): Site {
  const r = rng(n.id);
  const kind: 'gpu' | 'cpu' = (n.capability?.gpuCount ?? 0) > 0 ? 'gpu' : 'cpu';
  const online = n.status === 'online';
  const capacityKw = kind === 'gpu' ? 3 + Math.round(r() * 5) : 1 + Math.round(r() * 2);
  const utilizationPct = online ? Math.round(38 + r() * 56) : 0;
  const powerDrawKw = +(capacityKw * (0.32 + (utilizationPct / 100) * 0.62)).toFixed(2);
  const solarPct = r() < 0.72 ? Math.round(ASSUMPTIONS.avgSolarPct * (0.5 + r() * 1.4)) : 0;
  const gridDrawKw = +(powerDrawKw * (1 - solarPct / 100)).toFixed(2);
  // Revenue derives from the SHARED rate: kW → GPU-equivalents × €/GPU, scaled
  // by realized vs target utilization. At target utilization this equals
  // capacityKw × revPerKwMonth.
  const gpusEq = capacityKw / ASSUMPTIONS.kwPerGpu;
  const monthlyRevenueEur = Math.round(
    gpusEq * ASSUMPTIONS.revPerGpuMonth * (utilizationPct / ASSUMPTIONS.targetUtilizationPct),
  );
  const city = n.location?.city ?? n.location?.name ?? 'Unknown';
  return {
    id: n.id,
    name: n.name,
    buildingName: `${city} · ${pick(r, SITE_TYPES)}`,
    siteType: kind === 'gpu' ? 'GPU-Standort' : 'CPU-Standort',
    city,
    lat: n.location?.latitude ?? 51,
    lng: n.location?.longitude ?? 10,
    online,
    kind,
    capacityKw,
    powerDrawKw,
    gridDrawKw,
    solarPct,
    utilizationPct,
    monthlyRevenueEur,
    uptimePct: online ? +(99.2 + r() * 0.79).toFixed(2) : 0,
  };
}

export type SeriesKind = 'utilization' | 'revenue' | 'power' | 'grid';

/** A 24-hour hourly series for a site metric — diurnal shape + seeded noise. */
export function series(site: Site, kind: SeriesKind, points = 24): number[] {
  const r = rng(site.id + ':' + kind);
  const base =
    kind === 'utilization'
      ? site.utilizationPct
      : kind === 'power'
        ? site.powerDrawKw
        : kind === 'grid'
          ? site.gridDrawKw
          : site.monthlyRevenueEur / 720; // €/hour
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const hour = (24 - points + i + 24) % 24;
    const diurnal = 0.82 + 0.18 * Math.sin(((hour - 7) / 24) * Math.PI * 2);
    const v = base * diurnal * (0.9 + r() * 0.2);
    out.push(kind === 'utilization' ? Math.min(100, Math.round(v)) : +v.toFixed(2));
  }
  return out;
}

// ── portfolio aggregates (all derived from the sites) ────────────────────────
export interface BoardKpis {
  grossEur: number; // total compute billings (Cumulus top line)
  grossArrEur: number;
  hostPayoutEur: number; // RE host's cash share
  hostSharePct: number;
  splitMode: SplitMode;
  heatCreditEur: number; // waste-heat value to the host
  hostTotalBenefitEur: number; // host cash + heat
  contributionEur: number; // gross − host − energy (operating contribution)
  gpus: number;
  capexEur: number; // Cumulus hardware investment for the active fleet
  amortEur: number; // monthly hardware amortization
  paybackMonths: number; // capex / operating contribution
  cumulusResultEur: number; // contribution − amort (monthly result after capex)
  cumulusMarginPct: number; // result / gross
  liveSites: number;
  avgUtilizationPct: number;
  revenuePerKwEur: number; // gross / kW
  totalCapacityKw: number;
  totalPowerKw: number;
  totalGridKw: number;
  solarSharePct: number;
  energyCostEur: number;
  customers: number;
  grossTrend: number[];
}

export interface KpiLevers {
  energyPriceEurKwh?: number;
  hostSharePct?: number;
  capexPerGpuEur?: number;
  splitMode?: SplitMode;
  fixedRentPerKwMonth?: number;
}

export function boardKpis(sites: Site[], customers: number, levers: KpiLevers = {}): BoardKpis {
  const energyPriceEurKwh = levers.energyPriceEurKwh ?? ASSUMPTIONS.energyPriceEurKwh;
  const hostSharePct = levers.hostSharePct ?? ASSUMPTIONS.hostSharePct;
  const capexPerGpuEur = levers.capexPerGpuEur ?? ASSUMPTIONS.capexPerGpuEur;
  const splitMode = levers.splitMode ?? 'ergebnis';
  const fixedRentPerKwMonth = levers.fixedRentPerKwMonth ?? ASSUMPTIONS.fixedRentPerKwMonth;

  const live = sites.filter((s) => s.online);
  const gross = sites.reduce((a, s) => a + s.monthlyRevenueEur, 0);
  const cap = sites.reduce((a, s) => a + s.capacityKw, 0);
  const power = +live.reduce((a, s) => a + s.powerDrawKw, 0).toFixed(1);
  const grid = +live.reduce((a, s) => a + s.gridDrawKw, 0).toFixed(1);
  const avgUtil = live.length
    ? Math.round(live.reduce((a, s) => a + s.utilizationPct, 0) / live.length)
    : 0;

  const energyCost = Math.round(grid * HOURS_PER_MONTH * energyPriceEurKwh);
  const gpus = Math.round(cap / ASSUMPTIONS.kwPerGpu);
  const capex = Math.round(gpus * capexPerGpuEur);
  const amort = Math.round(capex / ASSUMPTIONS.hardwareLifeMonths);

  // Host payout depends on the participation model:
  //  - umsatz:   % of gross (fragile — can make Cumulus negative)
  //  - ergebnis: % of operating profit after energy + capex (never negative)
  //  - fix:      fixed rent per kW of compute capacity
  const profitBeforeHost = Math.max(0, gross - energyCost - amort);
  const hostPayout =
    splitMode === 'fix'
      ? Math.round(fixedRentPerKwMonth * cap)
      : splitMode === 'ergebnis'
        ? Math.round(hostSharePct * profitBeforeHost)
        : Math.round(hostSharePct * gross);

  const contribution = Math.max(0, gross - hostPayout - energyCost);
  const cumulusResult = gross - hostPayout - energyCost - amort; // can be negative (umsatz/fix)
  const payback = contribution > 0 ? Math.round(capex / contribution) : 0;
  const cumulusMargin = gross > 0 ? Math.round((cumulusResult / gross) * 100) : 0;

  // Heat reuse — waste heat warms the host's building (value to the host).
  const heatCredit = Math.round(
    power * HOURS_PER_MONTH * ASSUMPTIONS.heatRecoveryPct * ASSUMPTIONS.heatValueEurKwh,
  );

  const r = rng('gross-trend');
  const trend: number[] = [];
  let v = gross * 0.52;
  for (let i = 0; i < 6; i++) {
    v = i === 5 ? gross : Math.round(v * (1.14 + r() * 0.08));
    trend.push(Math.round(v));
  }
  return {
    grossEur: gross,
    grossArrEur: gross * 12,
    hostPayoutEur: hostPayout,
    hostSharePct,
    splitMode,
    heatCreditEur: heatCredit,
    hostTotalBenefitEur: hostPayout + heatCredit,
    contributionEur: contribution,
    gpus,
    capexEur: capex,
    amortEur: amort,
    paybackMonths: payback,
    cumulusResultEur: cumulusResult,
    cumulusMarginPct: cumulusMargin,
    liveSites: live.length,
    avgUtilizationPct: avgUtil,
    revenuePerKwEur: cap ? Math.round(gross / cap) : 0,
    totalCapacityKw: cap,
    totalPowerKw: power,
    totalGridKw: grid,
    solarSharePct: power ? Math.round((1 - grid / power) * 100) : 0,
    energyCostEur: energyCost,
    customers,
    grossTrend: trend,
  };
}

/** The RE host's share of a gross revenue figure (for per-site / pipeline). */
export const hostShareOf = (gross: number, pct: number): number => Math.round(gross * pct);

// ── TAMAX portfolio → compute potential ──────────────────────────────────────
/** Compute capacity (kW) realistically hostable in a building = headroom × its
 * max grid connection. */
export const portfolioComputeKw = (p: PortfolioSite): number =>
  Math.round(p.connectionKw * ASSUMPTIONS.computeHeadroomPct);

/** Gross monthly compute revenue if this building were activated. */
export const portfolioMrr = (p: PortfolioSite): number =>
  Math.round(portfolioComputeKw(p) * revPerKwMonth);

/** Turn an "added" portfolio building into a synthetic live Site for the KPIs.
 * Utilization/solar are seeded per building so each site's graphs differ. */
export function portfolioToSite(p: PortfolioSite): Site {
  const r = rng('tamax-' + p.id);
  const capacityKw = portfolioComputeKw(p);
  const util = Math.min(95, Math.round(ASSUMPTIONS.targetUtilizationPct * (0.8 + r() * 0.32)));
  const powerDrawKw = +(capacityKw * (0.32 + (util / 100) * 0.62)).toFixed(1);
  const solarPct = r() < 0.7 ? Math.round(ASSUMPTIONS.avgSolarPct * (0.5 + r() * 1.4)) : 0;
  const gridDrawKw = +(powerDrawKw * (1 - solarPct / 100)).toFixed(1);
  return {
    id: 'tamax-' + p.id,
    name: p.name,
    buildingName: `${p.ort} · ${p.name}`,
    siteType: 'Portfolio',
    city: p.ort,
    lat: p.lat,
    lng: p.lng,
    online: true,
    kind: 'gpu',
    capacityKw,
    powerDrawKw,
    gridDrawKw,
    solarPct,
    utilizationPct: util,
    monthlyRevenueEur: Math.round(
      (capacityKw / ASSUMPTIONS.kwPerGpu) * ASSUMPTIONS.revPerGpuMonth * (util / ASSUMPTIONS.targetUtilizationPct),
    ),
    uptimePct: +(99.2 + r() * 0.79).toFixed(2),
  };
}

/** A manually-added "own area" (from the Immobilie-hinzufügen calculator). */
export function customSiteFromKw(n: number, computeKw: number, label: string): Site {
  const util = ASSUMPTIONS.targetUtilizationPct;
  const powerDrawKw = +(computeKw * (0.32 + (util / 100) * 0.62)).toFixed(1);
  const solarPct = ASSUMPTIONS.avgSolarPct;
  return {
    id: 'custom-' + n,
    name: label,
    buildingName: label,
    siteType: 'Eigene Fläche',
    city: label,
    lat: 52.3 + (n % 5) * 0.05,
    lng: 13.2 + (n % 5) * 0.05,
    online: true,
    kind: 'gpu',
    capacityKw: computeKw,
    powerDrawKw,
    gridDrawKw: +(powerDrawKw * (1 - solarPct / 100)).toFixed(1),
    solarPct,
    utilizationPct: util,
    monthlyRevenueEur: Math.round((computeKw / ASSUMPTIONS.kwPerGpu) * ASSUMPTIONS.revPerGpuMonth),
    uptimePct: 99.5,
  };
}

// ── expansion pipeline (revenue derived, not hardcoded) ──────────────────────
export type PipelineStage = 'signed' | 'survey' | 'candidate';

export interface PipelineSite {
  city: string;
  buildingName: string;
  stage: PipelineStage;
  projectedKw: number;
  lat: number;
  lng: number;
}

/** Candidate buildings in TAMAX's Berlin-Brandenburg portfolio. */
export const PIPELINE: PipelineSite[] = [
  { city: 'Potsdam', buildingName: 'Wohn-/Gewerbe — Erdgeschoss', stage: 'signed', projectedKw: 12, lat: 52.4, lng: 13.06 },
  { city: 'Brandenburg a.d. Havel', buildingName: 'Quartier — Technikgeschoss', stage: 'survey', projectedKw: 18, lat: 52.41, lng: 12.55 },
  { city: 'Oranienburg', buildingName: 'Gewerbeeinheit — Technikraum', stage: 'survey', projectedKw: 9, lat: 52.75, lng: 13.24 },
  { city: 'Cottbus', buildingName: 'Leerstehendes Ladenlokal', stage: 'candidate', projectedKw: 14, lat: 51.76, lng: 14.33 },
  { city: 'Frankfurt (Oder)', buildingName: 'Büro — Technikgeschoss', stage: 'candidate', projectedKw: 8, lat: 52.34, lng: 14.55 },
];

/** Projected monthly revenue for a pipeline site — same rate as everything else. */
export const projectedMrr = (kw: number): number => Math.round(kw * revPerKwMonth);

// German number formatting (de-DE): 12.345 thousands, comma decimals.
export const fmtEur = (v: number): string => {
  if (v >= 1000) {
    const k = v / 1000;
    return '€' + (k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace('.', ',')) + 'k';
  }
  return '€' + Math.round(v);
};
export const fmtEurFull = (v: number): string => '€' + Math.round(v).toLocaleString('de-DE');
export const fmtNum = (v: number): string => Math.round(v).toLocaleString('de-DE');

// ── property potential estimator (the "Immobilie hinzufügen" calculator) ─────
// GPUs are limited by BOTH power and space — and in a real building the
// Anschlussleistung (power) is usually the binding constraint.
export interface PropertyEstimate {
  gpus: number;
  byPower: number;
  bySpace: number;
  limitedBy: 'power' | 'space';
  monthlyRevenueEur: number;
  capacityKw: number;
}

export function estimateProperty(sqm: number, kw: number): PropertyEstimate {
  const byPower = Math.floor((kw || 0) / ASSUMPTIONS.kwPerGpu);
  const bySpace = Math.floor((sqm || 0) / ASSUMPTIONS.sqmPerGpu);
  const gpus = Math.max(0, Math.min(byPower, bySpace));
  return {
    gpus,
    byPower,
    bySpace,
    limitedBy: byPower <= bySpace ? 'power' : 'space',
    monthlyRevenueEur: gpus * ASSUMPTIONS.revPerGpuMonth, // potential at target utilization
    capacityKw: +(gpus * ASSUMPTIONS.kwPerGpu).toFixed(1),
  };
}
