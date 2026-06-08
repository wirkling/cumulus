'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { NodeSummary, Customer } from '@cumulus/shared-types';
import { usePoll } from '@/lib/ui';
import { Atlas } from './Atlas';
import { Area, Gauge, Ramp, Spark } from './charts';
import {
  siteFromNode,
  series,
  boardKpis,
  PIPELINE,
  fmtEur,
  fmtEurFull,
  type Site,
  type SeriesKind,
} from './mock';

type Role = 'owner' | 'board';

function aggSeries(sites: Site[], kind: SeriesKind): number[] {
  const live = sites.filter((s) => s.online);
  const out = new Array(24).fill(0);
  for (const s of live) {
    const ser = series(s, kind);
    for (let i = 0; i < 24; i++) out[i] += ser[i] ?? 0;
  }
  return out.map((v) => +v.toFixed(1));
}

export default function BoardPage() {
  const { data: nodes } = usePoll<NodeSummary[]>('/api/nodes', 4000);
  const { data: customers } = usePoll<Customer[]>('/api/customers', 15000);
  const [role, setRole] = useState<Role>('owner');
  const [selId, setSelId] = useState<string | null>(null);

  const sites = useMemo(() => (nodes ?? []).map(siteFromNode), [nodes]);
  const kpis = useMemo(() => boardKpis(sites, customers?.length ?? 0), [sites, customers]);
  const selected = sites.find((s) => s.id === selId) ?? null;

  if (!nodes) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="board-display text-2xl" style={{ color: 'var(--navy)' }}>
          Loading portfolio…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-7">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="reveal mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="b-wordmark text-2xl font-medium" style={{ color: 'var(--navy)' }}>
            TAMAX <span style={{ color: 'var(--sand)' }}>×</span>{' '}
            <span style={{ color: 'var(--gold)' }}>Cumulus</span>
          </div>
          <div className="mt-0.5 text-sm" style={{ color: 'var(--slate)' }}>
            Infrastructure portfolio — compute that earns from your buildings
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--slate)' }}>
            <span className="live-dot" /> Live · Berlin-Brandenburg
          </span>
          <div className="seg" role="tablist" aria-label="View">
            <button className={role === 'owner' ? 'active' : ''} onClick={() => setRole('owner')}>
              Real-estate owner
            </button>
            <button className={role === 'board' ? 'active' : ''} onClick={() => setRole('board')}>
              Board
            </button>
          </div>
        </div>
      </header>
      <div className="b-rule reveal mb-6" style={{ '--d': '40ms' } as React.CSSProperties} />

      {/* ── KPI band ─────────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(role === 'owner'
          ? [
              { l: 'Active sites', v: String(kpis.liveSites), s: `in ${sites.length} buildings` },
              { l: 'Monthly revenue', v: fmtEurFull(kpis.mrrEur), s: 'from your real estate' },
              { l: 'Avg utilization', v: `${kpis.avgUtilizationPct}%`, s: 'compute "occupancy"' },
              { l: 'Power drawn', v: `${kpis.totalPowerKw} kW`, s: `${kpis.totalGridKw} kW from grid` },
            ]
          : [
              { l: 'MRR', v: fmtEurFull(kpis.mrrEur), s: `${fmtEur(kpis.arrEur)} ARR run-rate` },
              { l: 'Gross margin', v: `${kpis.grossMarginPct}%`, s: 'blended, after energy' },
              { l: 'Revenue / kW', v: fmtEurFull(kpis.revenuePerKwEur), s: 'per installed kW / mo' },
              { l: 'Customers', v: String(kpis.customers), s: 'paying tenants of compute' },
            ]
        ).map((k, i) => (
          <div
            key={k.l}
            className="b-card b-card-pad reveal"
            style={{ '--d': `${80 + i * 60}ms` } as React.CSSProperties}
          >
            <div className="b-kpi-label">{k.l}</div>
            <div className="b-kpi-val mt-2 text-[2rem]">{k.v}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {k.s}
            </div>
          </div>
        ))}
      </section>

      {/* ── Atlas + side ─────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="b-card reveal lg:col-span-7" style={{ '--d': '320ms' } as React.CSSProperties}>
          <div className="flex items-baseline justify-between px-4 pt-3">
            <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
              Compute footprint
            </h2>
            <span className="text-xs" style={{ color: 'var(--slate)' }}>
              click a site for detail
            </span>
          </div>
          <Atlas sites={sites} pipeline={PIPELINE} selectedId={selId} onSelect={setSelId} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          {/* Power & grid */}
          <div className="b-card b-card-pad reveal" style={{ '--d': '380ms' } as React.CSSProperties}>
            <div className="flex items-baseline justify-between">
              <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                Power & grid
              </h3>
              <span className="text-xs" style={{ color: 'var(--gold)' }}>
                {kpis.solarSharePct}% self-supplied
              </span>
            </div>
            <div className="mt-1 flex items-end gap-6">
              <div>
                <div className="b-kpi-val text-[1.7rem]">{kpis.totalGridKw}</div>
                <div className="b-kpi-label">kW from grid</div>
              </div>
              <div className="opacity-80">
                <div className="b-kpi-val text-[1.7rem]">{kpis.totalPowerKw}</div>
                <div className="b-kpi-label">kW total draw</div>
              </div>
            </div>
            <div className="mt-2">
              <Area
                data={aggSeries(sites, 'power')}
                data2={aggSeries(sites, 'grid')}
                height={92}
                unit=" kW"
                fmt={(v) => `${v.toFixed(1)} kW`}
              />
            </div>
            <div className="mt-1 flex gap-4 text-[11px]" style={{ color: 'var(--slate)' }}>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 2, background: 'var(--navy)', display: 'inline-block' }} /> total draw
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--gold)', display: 'inline-block' }} /> from grid
              </span>
            </div>
          </div>

          {/* Role headline card */}
          {role === 'owner' ? (
            <div className="b-card b-card-pad reveal" style={{ '--d': '440ms' } as React.CSSProperties}>
              <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                Your real estate, working
              </h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--slate)' }}>
                Otherwise-dead technical space — basements, plant rooms, ground-floor units —
                hosts compute and earns{' '}
                <strong style={{ color: 'var(--ink)' }}>{fmtEurFull(kpis.mrrEur)}/mo</strong>{' '}
                across {kpis.liveSites} live {kpis.liveSites === 1 ? 'site' : 'sites'}, at{' '}
                <strong style={{ color: 'var(--ink)' }}>{fmtEurFull(kpis.revenuePerKwEur)}</strong> per
                installed kW.
              </p>
            </div>
          ) : (
            <div className="b-card b-card-pad reveal" style={{ '--d': '440ms' } as React.CSSProperties}>
              <div className="flex items-baseline justify-between">
                <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                  MRR trajectory
                </h3>
                <span className="text-xs b-delta-up">last 6 months ↗</span>
              </div>
              <div className="mt-3">
                <Ramp data={kpis.mrrTrend} />
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--slate)' }}>
                {fmtEur(kpis.mrrTrend[0] ?? 0)} → {fmtEur(kpis.mrrEur)} ·{' '}
                {fmtEur(kpis.arrEur)} ARR run-rate
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Role-specific lower section ──────────────────────────────────── */}
      {role === 'owner' ? (
        <OwnerSites sites={sites} onSelect={setSelId} />
      ) : (
        <BoardEconomics kpis={kpis} />
      )}

      <Pipeline role={role} />

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
        Sites and status are <strong style={{ color: 'var(--ink)' }}>live</strong> from the Cumulus
        control plane. Utilization, revenue and energy figures are simulated for this preview —
        wired to real metering in production.{' '}
        <Link href="/nodes" className="b-link">
          Operator view →
        </Link>
      </footer>

      {selected && <SiteDrawer site={selected} onClose={() => setSelId(null)} />}
    </div>
  );
}

// ── Owner: portfolio site cards ──────────────────────────────────────────────
function OwnerSites({ sites, onSelect }: { sites: Site[]; onSelect: (id: string) => void }) {
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <h2 className="board-display mb-3 text-lg" style={{ color: 'var(--navy)' }}>
        Your sites
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="b-card b-card-pad text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="board-display text-base" style={{ color: 'var(--navy)' }}>
                  {s.city}
                </div>
                <div className="text-xs" style={{ color: 'var(--slate)' }}>
                  {s.buildingName}
                </div>
              </div>
              <span
                className="stage"
                style={{
                  background: s.online ? 'rgba(0,26,69,.1)' : 'rgba(124,117,104,.14)',
                  color: s.online ? 'var(--navy)' : 'var(--slate)',
                }}
              >
                {s.online ? 'live' : 'offline'}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="b-kpi-val text-[1.5rem]">{fmtEur(s.monthlyRevenueEur)}</div>
                <div className="b-kpi-label">per month</div>
              </div>
              <div className="text-right">
                <Spark data={series(s, 'revenue')} />
                <div className="b-kpi-label mt-0.5">{s.utilizationPct}% util · {s.capacityKw} kW</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Board: unit economics ────────────────────────────────────────────────────
function BoardEconomics({ kpis }: { kpis: ReturnType<typeof boardKpis> }) {
  const rows = [
    { l: 'Recurring revenue (MRR)', v: fmtEurFull(kpis.mrrEur) },
    { l: 'Annual run-rate (ARR)', v: fmtEurFull(kpis.arrEur) },
    { l: 'Gross margin (after energy)', v: `${kpis.grossMarginPct}%` },
    { l: 'Revenue per installed kW', v: `${fmtEurFull(kpis.revenuePerKwEur)} / mo` },
    { l: 'Installed capacity', v: `${kpis.totalCapacityKw} kW` },
    { l: 'Energy self-supplied (solar)', v: `${kpis.solarSharePct}%` },
    { l: 'Paying customers', v: String(kpis.customers) },
  ];
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <h2 className="board-display mb-3 text-lg" style={{ color: 'var(--navy)' }}>
        Unit economics
      </h2>
      <div className="b-card b-card-pad">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => (
            <div
              key={r.l}
              className="flex items-baseline justify-between py-2"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <span className="text-sm" style={{ color: 'var(--slate)' }}>
                {r.l}
              </span>
              <span className="board-display text-base" style={{ color: 'var(--navy)' }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Expansion pipeline ───────────────────────────────────────────────────────
function Pipeline({ role }: { role: Role }) {
  const total = PIPELINE.reduce((a, p) => a + p.projectedMrrEur, 0);
  return (
    <section className="reveal mb-2" style={{ '--d': '600ms' } as React.CSSProperties}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          {role === 'board' ? 'Expansion pipeline' : 'Bring more buildings online'}
        </h2>
        <span className="text-sm" style={{ color: 'var(--gold)' }}>
          +{fmtEurFull(total)}/mo potential
        </span>
      </div>
      <div className="b-card overflow-hidden">
        <table className="b-table w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th className="text-left">Location</th>
              <th className="text-left">Building</th>
              <th className="text-left">Stage</th>
              <th className="text-right">Capacity</th>
              <th className="text-right">{role === 'board' ? 'ARR uplift' : 'Projected / mo'}</th>
            </tr>
          </thead>
          <tbody>
            {PIPELINE.map((p) => (
              <tr key={p.city}>
                <td className="board-display" style={{ color: 'var(--navy)' }}>
                  {p.city}
                </td>
                <td style={{ color: 'var(--slate)' }}>{p.buildingName}</td>
                <td>
                  <span className={`stage stage-${p.stage}`}>{p.stage}</span>
                </td>
                <td className="text-right tabular-nums">{p.projectedKw} kW</td>
                <td className="text-right tabular-nums" style={{ color: 'var(--ink)' }}>
                  {role === 'board'
                    ? fmtEurFull(p.projectedMrrEur * 12)
                    : `${fmtEurFull(p.projectedMrrEur)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Per-site drawer ──────────────────────────────────────────────────────────
function SiteDrawer({ site, onClose }: { site: Site; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="board-display text-xl" style={{ color: 'var(--navy)' }}>
                {site.city}
              </div>
              <div className="text-sm" style={{ color: 'var(--slate)' }}>
                {site.buildingName}
              </div>
            </div>
            <button className="seg" onClick={onClose} style={{ padding: 0 }}>
              <span style={{ padding: '0.3rem 0.7rem' }}>close ✕</span>
            </button>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <Gauge value={site.utilizationPct} label="utilization" />
            <div className="grid flex-1 grid-cols-2 gap-3">
              <Stat label="Monthly revenue" value={fmtEurFull(site.monthlyRevenueEur)} />
              <Stat label="Capacity" value={`${site.capacityKw} kW`} />
              <Stat label="Power draw" value={`${site.powerDrawKw} kW`} />
              <Stat label="Uptime" value={`${site.uptimePct}%`} />
            </div>
          </div>

          <DrawerChart title="Utilization · 24h" unit="%" data={series(site, 'utilization')} />
          <DrawerChart
            title="Revenue · 24h"
            data={series(site, 'revenue')}
            color="var(--gold)"
            fmt={(v) => `€${v.toFixed(0)}/h`}
          />
          <div className="mt-4">
            <div className="b-kpi-label mb-1">Power vs grid · 24h</div>
            <Area
              data={series(site, 'power')}
              data2={series(site, 'grid')}
              height={120}
              fmt={(v) => `${v.toFixed(1)} kW`}
            />
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {site.solarPct > 0 ? `${site.solarPct}% self-supplied on site` : 'grid-supplied'} · gap = on-site generation
            </div>
          </div>

          <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
            Site & status are live; utilization, revenue and energy are simulated for this preview.
          </p>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="board-display text-base" style={{ color: 'var(--navy)' }}>
        {value}
      </div>
      <div className="b-kpi-label">{label}</div>
    </div>
  );
}

function DrawerChart({
  title,
  data,
  unit = '',
  color,
  fmt,
}: {
  title: string;
  data: number[];
  unit?: string;
  color?: string;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="mt-4">
      <div className="b-kpi-label mb-1">{title}</div>
      <Area data={data} height={110} unit={unit} color={color} fmt={fmt} />
    </div>
  );
}
