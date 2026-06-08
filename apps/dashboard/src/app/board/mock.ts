/**
 * Board-view economics — ONE shared assumptions block; everything (site
 * revenue, the property calculator, the pipeline, gross margin) derives from it,
 * so the numbers are internally consistent. NODES are real (live from the
 * control plane); the money is SIMULATED and deterministically seeded per node
 * id. Anchored on GPU/target economics — all figures are "geschätzt" (preview).
 */
import type { NodeSummary } from '@cumulus/shared-types';

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
  energyPriceEurKwh: 0.22, // €/kWh (adjustable)
  avgSolarPct: 18, // avg on-site generation share
  hostSharePct: 0.3, // RE host's share of gross compute revenue (adjustable)
};
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
  hostPayoutEur: number; // RE host's share (their revenue)
  hostSharePct: number;
  cumulusNetEur: number; // gross − host payout − energy
  cumulusMarginPct: number;
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

export function boardKpis(
  sites: Site[],
  customers: number,
  energyPriceEurKwh: number = ASSUMPTIONS.energyPriceEurKwh,
  hostSharePct: number = ASSUMPTIONS.hostSharePct,
): BoardKpis {
  const live = sites.filter((s) => s.online);
  const gross = sites.reduce((a, s) => a + s.monthlyRevenueEur, 0);
  const cap = sites.reduce((a, s) => a + s.capacityKw, 0);
  const power = +live.reduce((a, s) => a + s.powerDrawKw, 0).toFixed(1);
  const grid = +live.reduce((a, s) => a + s.gridDrawKw, 0).toFixed(1);
  const avgUtil = live.length
    ? Math.round(live.reduce((a, s) => a + s.utilizationPct, 0) / live.length)
    : 0;
  // Revenue split: the RE host gets a share of gross; energy (only the grid part
  // is paid) is a Cumulus cost; what's left is Cumulus net.
  const hostPayout = Math.round(gross * hostSharePct);
  const energyCost = Math.round(grid * HOURS_PER_MONTH * energyPriceEurKwh);
  const cumulusNet = Math.max(0, gross - hostPayout - energyCost);
  const cumulusMargin = gross > 0 ? Math.round((cumulusNet / gross) * 100) : 0;
  // 6-month ramp ending at the (derived) current gross.
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
    cumulusNetEur: cumulusNet,
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
