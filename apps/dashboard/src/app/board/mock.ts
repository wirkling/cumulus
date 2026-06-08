/**
 * Board-view economics. The NODES are real (live from the control plane); the
 * business figures here are SIMULATED — deterministically seeded from each
 * node's id so they're stable across refreshes and look like a real ledger.
 * This is the presentation/mock layer per the brief; swap for real metering when
 * the economics pipeline exists.
 */
import type { NodeSummary } from '@cumulus/shared-types';

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
  name: string; // node name
  buildingName: string;
  siteType: string;
  city: string;
  lat: number;
  lng: number;
  online: boolean;
  kind: 'gpu' | 'cpu';
  capacityKw: number;
  powerDrawKw: number;
  gridDrawKw: number; // grid draw after any on-site solar offset
  solarPct: number; // share of power self-supplied
  utilizationPct: number;
  monthlyRevenueEur: number;
  uptimePct: number;
}

const SITE_TYPES = [
  'Technical floor',
  'Ground-floor unit',
  'Basement plant room',
  'Rear commercial unit',
  'Rooftop machine room',
];

/** Derive a plausible micro-DC "site" economic profile from a real node. */
export function siteFromNode(n: NodeSummary): Site {
  const r = rng(n.id);
  const kind: 'gpu' | 'cpu' = (n.capability?.gpuCount ?? 0) > 0 ? 'gpu' : 'cpu';
  const online = n.status === 'online';
  const capacityKw = kind === 'gpu' ? 3 + Math.round(r() * 5) : 1 + Math.round(r() * 2);
  const utilizationPct = online ? Math.round(38 + r() * 56) : 0;
  const powerDrawKw = +(capacityKw * (0.32 + (utilizationPct / 100) * 0.62)).toFixed(2);
  const solarPct = r() > 0.45 ? Math.round(r() * 38) : 0;
  const gridDrawKw = +(powerDrawKw * (1 - solarPct / 100)).toFixed(2);
  const ratePerKwMonth = kind === 'gpu' ? 1150 + r() * 650 : 360 + r() * 240;
  const monthlyRevenueEur = Math.round(
    capacityKw * ratePerKwMonth * (0.55 + utilizationPct / 230),
  );
  const city = n.location?.city ?? n.location?.name ?? 'Unknown';
  return {
    id: n.id,
    name: n.name,
    buildingName: `${city} · ${pick(r, SITE_TYPES)}`,
    siteType: kind === 'gpu' ? 'GPU site' : 'CPU site',
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

// ── portfolio aggregates ─────────────────────────────────────────────────────

export interface BoardKpis {
  mrrEur: number;
  arrEur: number;
  liveSites: number;
  avgUtilizationPct: number;
  grossMarginPct: number;
  revenuePerKwEur: number;
  totalCapacityKw: number;
  totalPowerKw: number;
  totalGridKw: number;
  solarSharePct: number;
  customers: number;
  mrrTrend: number[]; // last 6 months
}

export function boardKpis(sites: Site[], customers: number): BoardKpis {
  const live = sites.filter((s) => s.online);
  const mrr = sites.reduce((a, s) => a + s.monthlyRevenueEur, 0);
  const cap = sites.reduce((a, s) => a + s.capacityKw, 0);
  const power = +live.reduce((a, s) => a + s.powerDrawKw, 0).toFixed(1);
  const grid = +live.reduce((a, s) => a + s.gridDrawKw, 0).toFixed(1);
  const avgUtil = live.length
    ? Math.round(live.reduce((a, s) => a + s.utilizationPct, 0) / live.length)
    : 0;
  // 6-month MRR ramp ending at current MRR (deterministic, gently compounding).
  const r = rng('mrr-trend');
  const trend: number[] = [];
  let v = mrr * 0.52;
  for (let i = 0; i < 6; i++) {
    v = i === 5 ? mrr : Math.round(v * (1.14 + r() * 0.08));
    trend.push(Math.round(v));
  }
  return {
    mrrEur: mrr,
    arrEur: mrr * 12,
    liveSites: live.length,
    avgUtilizationPct: avgUtil,
    grossMarginPct: 61 + (sites.length % 5),
    revenuePerKwEur: cap ? Math.round(mrr / cap) : 0,
    totalCapacityKw: cap,
    totalPowerKw: power,
    totalGridKw: grid,
    solarSharePct: power ? Math.round((1 - grid / power) * 100) : 0,
    customers,
    mrrTrend: trend,
  };
}

// ── expansion pipeline (candidate buildings, not yet live) ───────────────────

export type PipelineStage = 'signed' | 'survey' | 'candidate';

export interface PipelineSite {
  city: string;
  buildingName: string;
  stage: PipelineStage;
  projectedKw: number;
  projectedMrrEur: number;
  lat: number;
  lng: number;
}

/** Candidate buildings in TAMAX's Berlin-Brandenburg portfolio, framed as growth. */
export const PIPELINE: PipelineSite[] = [
  { city: 'Potsdam', buildingName: 'Mixed-use — ground-floor unit', stage: 'signed', projectedKw: 6, projectedMrrEur: 7200, lat: 52.4, lng: 13.06 },
  { city: 'Brandenburg a.d. Havel', buildingName: 'Quarter — utility floor', stage: 'survey', projectedKw: 9, projectedMrrEur: 10800, lat: 52.41, lng: 12.55 },
  { city: 'Oranienburg', buildingName: 'Commercial unit — plant room', stage: 'survey', projectedKw: 4, projectedMrrEur: 5400, lat: 52.75, lng: 13.24 },
  { city: 'Cottbus', buildingName: 'Logistics hub — basement', stage: 'candidate', projectedKw: 5, projectedMrrEur: 6100, lat: 51.76, lng: 14.33 },
  { city: 'Frankfurt (Oder)', buildingName: 'Office — technical floor', stage: 'candidate', projectedKw: 4, projectedMrrEur: 5000, lat: 52.34, lng: 14.55 },
];

export const fmtEur = (v: number): string =>
  v >= 1000 ? `€${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `€${Math.round(v)}`;
export const fmtEurFull = (v: number): string => '€' + Math.round(v).toLocaleString('en-US');
