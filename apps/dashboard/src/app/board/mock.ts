/**
 * Board-view economics — ONE shared assumptions block; everything (site
 * revenue, the portfolio potential, the over-time ramp, gross margin) derives
 * from it, so the numbers are internally consistent. NODES are real (live from
 * the control plane); the money is SIMULATED and deterministically seeded per
 * id. Anchored on GPU/target economics — all figures are "geschätzt" (preview).
 */
import type { NodeSummary } from '@cumulus/shared-types';
import type { PortfolioSite } from './tamax-portfolio';

// ── single source of truth ───────────────────────────────────────────────────
export const ASSUMPTIONS = {
  // Conservative base: Vast/RunPod 4090 ≈ $0.40–0.50/h → ~$207–260/mo at 72%
  // util; after platform fee / FX / idle, a conservative €/GPU/mo is ~220–300.
  // NOTE: this is Cumulus's GROSS compute revenue — the real-estate host receives
  // hostSharePct of the operating PROFIT (see boardKpis), not the full amount.
  revPerGpuMonth: 260, // €/GPU/month (Model A/B blended, conservative) — the anchor
  kwPerGpu: 0.6, // consumer GPU (4090 ≈ 0.45 kW) + cooling/overhead (PUE ≈ 1.3)
  sqmPerGpu: 0.5, // effective m²/GPU in a building retrofit (rack + aisle + cooling/electrical)
  targetUtilizationPct: 72, // assumed steady-state utilization
  energyPriceEurKwh: 0.3, // €/kWh (German grid; adjustable)
  avgSolarPct: 18, // avg on-site generation share
  // RE host's share of the operating PROFIT (after energy + hardware amortization)
  // — the only participation model, so it can never make Cumulus negative.
  hostSharePct: 0.4,
  // Share of a building's MAX grid connection realistically usable as flexible /
  // curtailable compute load. KEY assumption to calibrate with grid knowledge.
  computeHeadroomPct: 0.2,
  // Cumulus capex: fully-installed €/GPU — GPU + host/"feeder" server + network +
  // rack/PDU + cooling + electrical/install. Cumulus funds it (fixed assumption).
  capexPerGpuEur: 4500,
  hardwareLifeMonths: 36, // amortization period
  // Heat reuse — waste heat warms the host's building, offsetting their heating
  // bill. This is value to the HOST (a one-time integration invest may be needed,
  // esp. in older buildings — surfaced in copy).
  heatRecoveryPct: 0.6, // share of consumed power recoverable as useful heat
  heatValueEurKwh: 0.05, // €/kWh-thermal the host would otherwise pay
};

const HOURS_PER_MONTH = 730;
/** Derived: every €/kW figure on the board uses this one rate (≈ €355). */
export const revPerKwMonth = ASSUMPTIONS.revPerGpuMonth / ASSUMPTIONS.kwPerGpu;

// ── time horizon for the over-time growth charts ─────────────────────────────
export const TL_START_YEAR = 2024;
export const TL_MONTHS = 72; // 2024-01 … 2029-12
export const TL_NOW_INDEX = (2026 - TL_START_YEAR) * 12 + 5; // "heute" = 2026-06
const RAMP_MONTHS = 9; // soft ramp-up after a site goes live

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
const smoothstep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

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
  goLiveYear: number; // year this site went / goes online (drives the ramp)
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
    goLiveYear: TL_START_YEAR, // the real nodes are already running
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
  hostPayoutEur: number; // RE host's cash share (of operating profit)
  hostSharePct: number;
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
}

export function boardKpis(sites: Site[], customers: number, levers: KpiLevers = {}): BoardKpis {
  const energyPriceEurKwh = levers.energyPriceEurKwh ?? ASSUMPTIONS.energyPriceEurKwh;
  const hostSharePct = levers.hostSharePct ?? ASSUMPTIONS.hostSharePct;
  const capexPerGpuEur = levers.capexPerGpuEur ?? ASSUMPTIONS.capexPerGpuEur;

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

  // Host payout = a share of the operating profit (after energy + amortization).
  // This is the only model — it can never push Cumulus into the red.
  const profitBeforeHost = Math.max(0, gross - energyCost - amort);
  const hostPayout = Math.round(hostSharePct * profitBeforeHost);

  const contribution = Math.max(0, gross - hostPayout - energyCost);
  const cumulusResult = gross - hostPayout - energyCost - amort;
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

/** Apply a fraction to a gross figure (used for per-site host benefit). Pass the
 * realized profit-share RATIO (see profitShareRatio / fleet payout÷gross), NOT
 * the headline hostSharePct — the host is paid a share of PROFIT, not of gross. */
export const hostShareOf = (gross: number, ratio: number): number => Math.round(gross * ratio);

/** Fraction of GROSS that reaches the host as payout for a representative
 * building at steady state — i.e. hostSharePct × (profit ÷ gross), where profit
 * is per-kW gross minus energy and hardware amortization at the current levers.
 * All candidate buildings share the same per-kW unit economics, so this single
 * ratio reconciles every per-site "Ihr Anteil" with the fleet-level payout, and
 * stays meaningful even before anything is activated. */
export function profitShareRatio(levers: KpiLevers = {}): number {
  const energyPriceEurKwh = levers.energyPriceEurKwh ?? ASSUMPTIONS.energyPriceEurKwh;
  const hostSharePct = levers.hostSharePct ?? ASSUMPTIONS.hostSharePct;
  const capexPerGpuEur = levers.capexPerGpuEur ?? ASSUMPTIONS.capexPerGpuEur;
  const u = ASSUMPTIONS.targetUtilizationPct / 100;
  const grossPerKw = revPerKwMonth; // at target utilization
  const powerPerKw = 0.32 + u * 0.62; // same intensity model as the sites
  const gridPerKw = powerPerKw * (1 - ASSUMPTIONS.avgSolarPct / 100);
  const energyPerKw = gridPerKw * HOURS_PER_MONTH * energyPriceEurKwh;
  const amortPerKw = (capexPerGpuEur / ASSUMPTIONS.kwPerGpu) / ASSUMPTIONS.hardwareLifeMonths;
  const profitPerKw = Math.max(0, grossPerKw - energyPerKw - amortPerKw);
  return grossPerKw > 0 ? (hostSharePct * profitPerKw) / grossPerKw : 0;
}

// ── portfolio building → compute potential ───────────────────────────────────
/** Compute capacity (kW) realistically hostable in a building = headroom × its
 * max grid connection. */
export const portfolioComputeKw = (connectionKw: number): number =>
  Math.round(connectionKw * ASSUMPTIONS.computeHeadroomPct);

/** Gross monthly compute revenue if this capacity were activated. */
export const portfolioMrr = (connectionKw: number): number =>
  Math.round(portfolioComputeKw(connectionKw) * revPerKwMonth);

/** When a building goes online (year). Built ones are already live (2023–25);
 * planned ones land 2026–2029 by current stage. Deterministic per building. */
export function siteGoLive(p: PortfolioSite): number {
  const seed = hashStr('golive:' + p.id + ':' + p.ort);
  if (p.built) return 2023 + (seed % 3); // 2023–2025 → live by today
  const s = p.status.toLowerCase();
  const earliest = s.includes('bau') || s.includes('vertrieb') ? 2026 : 2027;
  return earliest + (seed % 3); // future ramp
}

// ── candidates: a developer's buildings as addable fleet units ────────────────
/** A portfolio building made addable — connection can be overridden by the user;
 * everything downstream derives from the effective connectionKw. */
export interface Candidate {
  key: string; // globally-unique `${devId}:${id}`
  devId: string;
  id: number;
  name: string;
  ort: string;
  typ: string;
  status: string;
  built: boolean;
  connectionKw: number; // effective (user override applied)
  computeKw: number;
  grossEur: number;
  goLive: number;
  lat: number;
  lng: number;
}

export const candKey = (devId: string, id: number): string => `${devId}:${id}`;

export function toCandidates(
  devId: string,
  sites: PortfolioSite[],
  overrides: Record<string, number> = {},
): Candidate[] {
  return sites.map((p) => {
    const key = candKey(devId, p.id);
    const connectionKw = overrides[key] ?? p.connectionKw;
    return {
      key,
      devId,
      id: p.id,
      name: p.name,
      ort: p.ort,
      typ: p.typ,
      status: p.status,
      built: p.built,
      connectionKw,
      computeKw: portfolioComputeKw(connectionKw),
      grossEur: portfolioMrr(connectionKw),
      goLive: siteGoLive(p),
      lat: p.lat,
      lng: p.lng,
    };
  });
}

/** Turn an activated candidate into a synthetic live Site for the KPIs.
 * Utilization/solar seeded per building so each site's graphs differ. */
export function candidateToSite(c: Candidate): Site {
  const r = rng(c.devId + '-' + c.id);
  const capacityKw = c.computeKw;
  const util = Math.min(95, Math.round(ASSUMPTIONS.targetUtilizationPct * (0.8 + r() * 0.32)));
  const powerDrawKw = +(capacityKw * (0.32 + (util / 100) * 0.62)).toFixed(1);
  const solarPct = r() < 0.7 ? Math.round(ASSUMPTIONS.avgSolarPct * (0.5 + r() * 1.4)) : 0;
  const gridDrawKw = +(powerDrawKw * (1 - solarPct / 100)).toFixed(1);
  return {
    id: c.devId + '-' + c.id,
    name: c.name,
    buildingName: `${c.ort} · ${c.name}`,
    siteType: 'Portfolio',
    city: c.ort,
    lat: c.lat,
    lng: c.lng,
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
    goLiveYear: c.goLive,
  };
}

/** Monthly gross-revenue curve for a fleet: each site contributes 0 until its
 * go-live month, then ramps up over RAMP_MONTHS (smoothstep) to steady state.
 * Go-live month is jittered per site so the aggregate steps look organic. */
export function revenueTimeline(sites: Site[], months = TL_MONTHS, startYear = TL_START_YEAR): number[] {
  const out = new Array(months).fill(0);
  for (const s of sites) {
    const gm = hashStr('glm:' + s.id) % 12;
    const liveIdx = (s.goLiveYear - startYear) * 12 + gm;
    const steady = s.monthlyRevenueEur;
    for (let i = 0; i < months; i++) out[i] += steady * smoothstep((i - liveIdx) / RAMP_MONTHS);
  }
  return out.map((v) => Math.round(v));
}

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
