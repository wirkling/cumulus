'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { NodeSummary, Customer } from '@cumulus/shared-types';
import { usePoll } from '@/lib/ui';
import { Atlas } from './Atlas';
import { Area, Gauge, Ramp, Spark } from './charts';
import {
  siteFromNode,
  series,
  boardKpis,
  estimateProperty,
  PIPELINE,
  fmtEur,
  fmtEurFull,
  fmtNum,
  type Site,
  type SeriesKind,
} from './mock';

const MapboxMap = dynamic(() => import('./MapboxMap').then((m) => m.MapboxMap), { ssr: false });
const HAS_MAPBOX = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type Role = 'owner' | 'board';
const ca = (s: string) => `ca. ${s}`;
const STAGE_LABEL: Record<string, string> = { signed: 'zugesagt', survey: 'in Prüfung', candidate: 'Kandidat' };

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
  const [showAdd, setShowAdd] = useState(false);

  const sites = useMemo(() => (nodes ?? []).map(siteFromNode), [nodes]);
  const kpis = useMemo(() => boardKpis(sites, customers?.length ?? 0), [sites, customers]);
  const selected = sites.find((s) => s.id === selId) ?? null;

  if (!nodes) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="board-display text-2xl" style={{ color: 'var(--navy)' }}>
          Portfolio wird geladen…
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
            Infrastruktur-Portfolio — Rechenleistung in Ihren Flächen
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--slate)' }}>
            <span className="live-dot" /> Live · Berlin-Brandenburg
          </span>
          <div className="seg" role="tablist" aria-label="Ansicht">
            <button className={role === 'owner' ? 'active' : ''} onClick={() => setRole('owner')}>
              Immobilieneigentümer
            </button>
            <button className={role === 'board' ? 'active' : ''} onClick={() => setRole('board')}>
              Exec Summary
            </button>
          </div>
        </div>
      </header>
      <div className="b-rule reveal mb-6" style={{ '--d': '40ms' } as React.CSSProperties} />

      {/* ── KPI band ─────────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(role === 'owner'
          ? [
              { l: 'Aktive Standorte', v: String(kpis.liveSites), s: `von ${sites.length} Gebäuden` },
              { l: 'Monatl. Einnahmen', v: ca(fmtEurFull(kpis.mrrEur)), s: 'aus Ihren Flächen' },
              { l: 'Ø Auslastung', v: `${kpis.avgUtilizationPct}%`, s: 'der Rechenleistung' },
              { l: 'Leistungsaufnahme', v: `${kpis.totalPowerKw} kW`, s: `${kpis.totalGridKw} kW aus dem Netz` },
            ]
          : [
              { l: 'Monatl. Einnahmen', v: ca(fmtEurFull(kpis.mrrEur)), s: `≈ ${fmtEur(kpis.arrEur)} / Jahr` },
              { l: 'Bruttomarge', v: `${kpis.grossMarginPct}%`, s: 'nach Energie' },
              { l: 'Ertrag je kW', v: ca(fmtEurFull(kpis.revenuePerKwEur)), s: 'pro Monat / installiert' },
              { l: 'Kunden', v: String(kpis.customers), s: 'zahlende Nutzer' },
            ]
        ).map((k, i) => (
          <div
            key={k.l}
            className="b-card b-card-pad reveal"
            style={{ '--d': `${80 + i * 60}ms` } as React.CSSProperties}
          >
            <div className="b-kpi-label">{k.l}</div>
            <div className="b-kpi-val mt-2 text-[1.85rem]">{k.v}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {k.s}
            </div>
          </div>
        ))}
      </section>

      {/* ── Map + side ───────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="b-card reveal lg:col-span-7" style={{ '--d': '320ms' } as React.CSSProperties}>
          <div className="flex items-baseline justify-between px-4 pb-3 pt-3">
            <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
              Rechen-Standorte
            </h2>
            <span className="text-xs" style={{ color: 'var(--slate)' }}>
              Standort anklicken für Details
            </span>
          </div>
          {HAS_MAPBOX ? (
            <div className="px-3 pb-3">
              <MapboxMap sites={sites} pipeline={PIPELINE} selectedId={selId} onSelect={setSelId} />
            </div>
          ) : (
            <Atlas sites={sites} pipeline={PIPELINE} selectedId={selId} onSelect={setSelId} />
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          {/* Strom & Netz */}
          <div className="b-card b-card-pad reveal" style={{ '--d': '380ms' } as React.CSSProperties}>
            <div className="flex items-baseline justify-between">
              <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                Strom & Netz
              </h3>
              <span className="text-xs" style={{ color: 'var(--gold)' }}>
                {kpis.solarSharePct}% selbst erzeugt
              </span>
            </div>
            <div className="mt-1 flex items-end gap-6">
              <div>
                <div className="b-kpi-val text-[1.7rem]">{kpis.totalGridKw}</div>
                <div className="b-kpi-label">kW aus dem Netz</div>
              </div>
              <div className="opacity-80">
                <div className="b-kpi-val text-[1.7rem]">{kpis.totalPowerKw}</div>
                <div className="b-kpi-label">kW Gesamtaufnahme</div>
              </div>
            </div>
            <div className="mt-2">
              <Area data={aggSeries(sites, 'power')} data2={aggSeries(sites, 'grid')} height={92} fmt={(v) => `${v.toFixed(1)} kW`} />
            </div>
            <div className="mt-1 flex gap-4 text-[11px]" style={{ color: 'var(--slate)' }}>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 2, background: 'var(--navy)', display: 'inline-block' }} /> Gesamt
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--gold)', display: 'inline-block' }} /> aus Netz
              </span>
            </div>
          </div>

          {/* Role headline */}
          {role === 'owner' ? (
            <div className="b-card b-card-pad reveal" style={{ '--d': '440ms' } as React.CSSProperties}>
              <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                Ihre Flächen verdienen mit
              </h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--slate)' }}>
                Ungenutzte Flächen — Technikräume, Keller, aber auch leerstehende Ladenlokale und
                Gewerbeeinheiten — beherbergen Rechenleistung und erwirtschaften{' '}
                <strong style={{ color: 'var(--ink)' }}>{ca(fmtEurFull(kpis.mrrEur))}/Monat</strong>{' '}
                an {kpis.liveSites} {kpis.liveSites === 1 ? 'Standort' : 'Standorten'} — rund{' '}
                <strong style={{ color: 'var(--ink)' }}>{fmtEurFull(kpis.revenuePerKwEur)}</strong> je
                installiertem kW.
              </p>
              <button className="b-btn-primary mt-3" onClick={() => setShowAdd(true)}>
                + Immobilie hinzufügen
              </button>
            </div>
          ) : (
            <div className="b-card b-card-pad reveal" style={{ '--d': '440ms' } as React.CSSProperties}>
              <div className="flex items-baseline justify-between">
                <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                  Umsatzentwicklung
                </h3>
                <span className="text-xs b-delta-up">letzte 6 Monate ↗</span>
              </div>
              <div className="mt-3">
                <Ramp data={kpis.mrrTrend} />
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--slate)' }}>
                {fmtEur(kpis.mrrTrend[0] ?? 0)} → {ca(fmtEur(kpis.mrrEur))} · ≈ {fmtEur(kpis.arrEur)} / Jahr (Hochrechnung)
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Role section ─────────────────────────────────────────────────── */}
      {role === 'owner' ? (
        <OwnerSites sites={sites} onSelect={setSelId} onAdd={() => setShowAdd(true)} />
      ) : (
        <ExecSummary kpis={kpis} />
      )}

      <Pipeline role={role} />

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
        Standorte und Status sind <strong style={{ color: 'var(--ink)' }}>live</strong> aus der
        Cumulus-Steuerung. Auslastung, Einnahmen und Energiewerte sind für diese Vorschau{' '}
        <strong style={{ color: 'var(--ink)' }}>geschätzt</strong> — in Produktion an echte Messung
        angebunden.
      </footer>

      {selected && <SiteDrawer site={selected} onClose={() => setSelId(null)} />}
      {showAdd && <PropertyModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ── Owner: portfolio site cards ──────────────────────────────────────────────
function OwnerSites({ sites, onSelect, onAdd }: { sites: Site[]; onSelect: (id: string) => void; onAdd: () => void }) {
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          Ihre Standorte
        </h2>
        <button className="b-btn-ghost" onClick={onAdd}>
          + Immobilie hinzufügen
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map((s) => (
          <button key={s.id} onClick={() => onSelect(s.id)} className="b-card b-card-pad text-left transition-transform hover:-translate-y-0.5">
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
                {s.online ? 'aktiv' : 'offline'}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="b-kpi-val text-[1.5rem]">{ca(fmtEur(s.monthlyRevenueEur))}</div>
                <div className="b-kpi-label">pro Monat</div>
              </div>
              <div className="text-right">
                <Spark data={series(s, 'revenue')} />
                <div className="b-kpi-label mt-0.5">{s.utilizationPct}% Auslastung · {s.capacityKw} kW</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Exec Summary: economics ──────────────────────────────────────────────────
function ExecSummary({ kpis }: { kpis: ReturnType<typeof boardKpis> }) {
  const rows = [
    { l: 'Monatliche Einnahmen (ca.)', v: fmtEurFull(kpis.mrrEur) },
    { l: 'Jahresumsatz (Hochrechnung)', v: fmtEurFull(kpis.arrEur) },
    { l: 'Bruttomarge (nach Energie)', v: `${kpis.grossMarginPct}%` },
    { l: 'Ertrag je installiertem kW', v: `${fmtEurFull(kpis.revenuePerKwEur)} / Monat` },
    { l: 'Installierte Leistung', v: `${kpis.totalCapacityKw} kW` },
    { l: 'Eigenstrom (Solar)', v: `${kpis.solarSharePct}%` },
    { l: 'Zahlende Kunden', v: String(kpis.customers) },
  ];
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <h2 className="board-display mb-3 text-lg" style={{ color: 'var(--navy)' }}>
        Wirtschaftlichkeit
      </h2>
      <div className="b-card b-card-pad">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.l} className="flex items-baseline justify-between py-2" style={{ borderTop: '1px solid var(--line)' }}>
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
          {role === 'board' ? 'Ausbau-Pipeline' : 'Weitere Flächen anbinden'}
        </h2>
        <span className="text-sm" style={{ color: 'var(--gold)' }}>
          + {ca(fmtEurFull(total))}/Monat möglich
        </span>
      </div>
      <div className="b-card overflow-hidden">
        <table className="b-table w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th className="text-left">Ort</th>
              <th className="text-left">Gebäude</th>
              <th className="text-left">Status</th>
              <th className="text-right">Leistung</th>
              <th className="text-right">{role === 'board' ? 'Jahresumsatz (Hochr.)' : 'ca. / Monat'}</th>
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
                  <span className={`stage stage-${p.stage}`}>{STAGE_LABEL[p.stage]}</span>
                </td>
                <td className="text-right tabular-nums">{p.projectedKw} kW</td>
                <td className="text-right tabular-nums" style={{ color: 'var(--ink)' }}>
                  {role === 'board' ? fmtEurFull(p.projectedMrrEur * 12) : ca(fmtEurFull(p.projectedMrrEur))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Property potential calculator ────────────────────────────────────────────
function PropertyModal({ onClose }: { onClose: () => void }) {
  const [sqm, setSqm] = useState('');
  const [mw, setMw] = useState('');
  const sqmN = parseFloat(sqm) || 0;
  const mwN = parseFloat(mw) || 0;
  const est = useMemo(() => estimateProperty(sqmN, mwN), [sqmN, mwN]);
  const ready = sqmN > 0 && mwN > 0;

  return (
    <div className="b-modal">
      <div className="scrim" onClick={onClose} />
      <div
        className="b-card b-card-pad reveal"
        style={{ position: 'relative', zIndex: 51, width: 'min(520px, 96vw)' }}
      >
        <h3 className="board-display text-xl" style={{ color: 'var(--navy)' }}>
          Immobilie hinzufügen
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--slate)' }}>
          Schätzen Sie das Potenzial einer Fläche — z. B. ein Technikraum oder ein leerstehendes
          Ladenlokal. Angaben: verfügbare Fläche und Anschlussleistung.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="b-kpi-label mb-1 block">Verfügbare Fläche (m²)</span>
            <input className="b-input" type="number" min={0} placeholder="z. B. 80" value={sqm} onChange={(e) => setSqm(e.target.value)} />
          </label>
          <label>
            <span className="b-kpi-label mb-1 block">Anschlussleistung (MW)</span>
            <input className="b-input" type="number" min={0} step={0.05} placeholder="z. B. 0,2" value={mw} onChange={(e) => setMw(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="b-card b-card-pad" style={{ background: '#faf8f3' }}>
            <div className="b-kpi-val text-[1.7rem]">{ready ? `ca. ${fmtNum(est.gpus)}` : '—'}</div>
            <div className="b-kpi-label">GPUs (geschätzt)</div>
          </div>
          <div className="b-card b-card-pad" style={{ background: '#faf8f3' }}>
            <div className="b-kpi-val text-[1.7rem]">{ready ? ca(fmtEurFull(est.monthlyRevenueEur)) : '—'}</div>
            <div className="b-kpi-label">pro Monat (geschätzt)</div>
          </div>
        </div>

        {ready && (
          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
            Begrenzt durch {est.limitedBy === 'power' ? 'die Anschlussleistung' : 'die Fläche'} ·
            rund {est.capacityKw} kW Rechenlast · ≈ {ca(fmtEurFull(est.monthlyRevenueEur * 12))}/Jahr.
            Grobe Planungsschätzung — keine Zusage.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="b-btn-ghost" onClick={onClose}>
            Schließen
          </button>
          <button className="b-btn-primary" disabled={!ready} onClick={onClose}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
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
            <button className="b-btn-ghost" onClick={onClose}>
              schließen ✕
            </button>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <Gauge value={site.utilizationPct} label="Auslastung" />
            <div className="grid flex-1 grid-cols-2 gap-3">
              <Stat label="Einnahmen / Monat" value={ca(fmtEurFull(site.monthlyRevenueEur))} />
              <Stat label="Leistung" value={`${site.capacityKw} kW`} />
              <Stat label="Leistungsaufnahme" value={`${site.powerDrawKw} kW`} />
              <Stat label="Verfügbarkeit" value={`${site.uptimePct}%`} />
            </div>
          </div>

          <DrawerChart title="Auslastung · 24h" unit="%" data={series(site, 'utilization')} />
          <DrawerChart title="Einnahmen · 24h (ca.)" data={series(site, 'revenue')} color="var(--gold)" fmt={(v) => `€${v.toFixed(0)}/h`} />
          <div className="mt-4">
            <div className="b-kpi-label mb-1">Strom vs. Netz · 24h</div>
            <Area data={series(site, 'power')} data2={series(site, 'grid')} height={120} fmt={(v) => `${v.toFixed(1)} kW`} />
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {site.solarPct > 0 ? `${site.solarPct}% vor Ort erzeugt` : 'aus dem Netz'} · Differenz = Eigenerzeugung
            </div>
          </div>

          <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
            Standort & Status sind live; Auslastung, Einnahmen und Energie sind für diese Vorschau
            geschätzt.
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

function DrawerChart({ title, data, unit = '', color, fmt }: { title: string; data: number[]; unit?: string; color?: string; fmt?: (v: number) => string }) {
  return (
    <div className="mt-4">
      <div className="b-kpi-label mb-1">{title}</div>
      <Area data={data} height={110} unit={unit} color={color} fmt={fmt} />
    </div>
  );
}
