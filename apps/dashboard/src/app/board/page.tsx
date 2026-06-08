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
  hostShareOf,
  portfolioToSite,
  portfolioComputeKw,
  portfolioMrr,
  ASSUMPTIONS,
  revPerKwMonth,
  fmtEur,
  fmtEurFull,
  fmtNum,
  type Site,
  type SeriesKind,
} from './mock';
import { TAMAX_PORTFOLIO } from './tamax-portfolio';

const MapboxMap = dynamic(() => import('./MapboxMap').then((m) => m.MapboxMap), { ssr: false });
const HAS_MAPBOX = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type Role = 'owner' | 'board';
const ca = (s: string) => `ca. ${s}`;
const pct = (f: number) => Math.round(f * 100);

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
  const [energyPrice, setEnergyPrice] = useState(ASSUMPTIONS.energyPriceEurKwh);
  const [hostShare, setHostShare] = useState(ASSUMPTIONS.hostSharePct);
  const [capexPerGpu, setCapexPerGpu] = useState(ASSUMPTIONS.capexPerGpuEur);
  const [added, setAdded] = useState<number[]>([]);
  const toggleAdd = (id: number) =>
    setAdded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const sites = useMemo(() => (nodes ?? []).map(siteFromNode), [nodes]);
  const addedSites = useMemo(
    () => TAMAX_PORTFOLIO.filter((p) => added.includes(p.id)).map(portfolioToSite),
    [added],
  );
  const effectiveSites = useMemo(() => [...sites, ...addedSites], [sites, addedSites]);
  const kpis = useMemo(
    () => boardKpis(effectiveSites, customers?.length ?? 0, energyPrice, hostShare, capexPerGpu),
    [effectiveSites, customers, energyPrice, hostShare, capexPerGpu],
  );
  const selected = effectiveSites.find((s) => s.id === selId) ?? null;

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
      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(role === 'owner'
          ? [
              { l: 'Aktive Standorte', v: String(kpis.liveSites), s: `von ${sites.length} Gebäuden` },
              { l: 'Ihre Vergütung', v: ca(fmtEurFull(kpis.hostPayoutEur)), s: `${pct(hostShare)}% vom Rechenumsatz / Monat` },
              { l: 'Ø Auslastung', v: `${kpis.avgUtilizationPct}%`, s: 'der Rechenleistung' },
              { l: 'Leistungsaufnahme', v: `${kpis.totalPowerKw} kW`, s: `${kpis.totalGridKw} kW aus dem Netz` },
            ]
          : [
              { l: 'Bruttoumsatz', v: ca(fmtEurFull(kpis.grossEur)), s: `≈ ${fmtEur(kpis.grossArrEur)} / Jahr` },
              { l: 'Cumulus-Ergebnis', v: ca(fmtEurFull(kpis.cumulusResultEur)), s: 'nach Partner, Energie & Hardware / Mt' },
              { l: 'Hardware-Investition', v: ca(fmtEurFull(kpis.capexEur)), s: `${fmtNum(kpis.gpus)} GPUs (Cumulus)` },
              { l: 'Amortisation', v: `${kpis.paybackMonths} Mt`, s: 'bis Hardware bezahlt' },
            ]
        ).map((k, i) => (
          <div key={k.l} className="b-card b-card-pad reveal" style={{ '--d': `${80 + i * 60}ms` } as React.CSSProperties}>
            <div className="b-kpi-label">{k.l}</div>
            <div className="b-kpi-val mt-2 text-[1.85rem]">{k.v}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {k.s}
            </div>
          </div>
        ))}
      </section>

      {/* ── Revenue split lever (visible on both tabs) ───────────────────── */}
      <section className="reveal mb-6" style={{ '--d': '300ms' } as React.CSSProperties}>
        <div className="b-card b-card-pad flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="b-kpi-label" style={{ whiteSpace: 'nowrap' }}>
            Umsatzaufteilung
          </span>
          <input
            type="range"
            min={0.1}
            max={0.6}
            step={0.05}
            value={hostShare}
            onChange={(e) => setHostShare(parseFloat(e.target.value))}
            className="min-w-[160px] flex-1"
            style={{ accentColor: 'var(--gold)' }}
            aria-label="Umsatzanteil Immobilienpartner"
          />
          <span className="text-sm" style={{ whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Immobilienpartner {pct(hostShare)}%</span>
            <span style={{ color: 'var(--slate)' }}> · </span>
            <span style={{ color: 'var(--navy)', fontWeight: 600 }}>Cumulus {100 - pct(hostShare)}%</span>
          </span>
        </div>
      </section>

      {/* ── Map + side ───────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="b-card reveal lg:col-span-7" style={{ '--d': '320ms' } as React.CSSProperties}>
          <div className="flex items-baseline justify-between px-4 pb-3 pt-3">
            <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
              Standortkarte
            </h2>
            <span className="text-xs" style={{ color: 'var(--slate)' }}>
              TAMAX-Portfolio (○) anklicken → zur Flotte
            </span>
          </div>
          {HAS_MAPBOX ? (
            <div className="px-3 pb-3">
              <MapboxMap sites={sites} portfolio={TAMAX_PORTFOLIO} added={added} onToggleAdd={toggleAdd} selectedId={selId} onSelect={setSelId} />
            </div>
          ) : (
            <Atlas sites={sites} portfolio={TAMAX_PORTFOLIO} added={added} onToggleAdd={toggleAdd} selectedId={selId} onSelect={setSelId} />
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
              <Area data={aggSeries(effectiveSites, 'power')} data2={aggSeries(effectiveSites, 'grid')} height={92} fmt={(v) => `${v.toFixed(1)} kW`} />
            </div>
            <div className="mt-1 flex gap-4 text-[11px]" style={{ color: 'var(--slate)' }}>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 2, background: 'var(--navy)', display: 'inline-block' }} /> Gesamt
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--gold)', display: 'inline-block' }} /> aus Netz
              </span>
            </div>

            {/* Adjustable electricity price → flows into energy cost + Cumulus margin */}
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="flex items-center justify-between">
                <span className="b-kpi-label">Strompreis (Cumulus trägt Energie)</span>
                <span className="board-display text-sm" style={{ color: 'var(--navy)' }}>
                  {energyPrice.toFixed(2).replace('.', ',')} €/kWh
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.6}
                step={0.01}
                value={energyPrice}
                onChange={(e) => setEnergyPrice(parseFloat(e.target.value))}
                className="mt-1 w-full"
                style={{ accentColor: 'var(--navy)' }}
                aria-label="Strompreis in Euro pro kWh"
              />
              <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
                Energiekosten {ca(fmtEurFull(kpis.energyCostEur))}/Monat · Cumulus-Marge{' '}
                <strong style={{ color: 'var(--ink)' }}>{kpis.cumulusMarginPct}%</strong>
              </div>
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
                Gewerbeeinheiten — beherbergen Rechenleistung. Ihr Anteil:{' '}
                <strong style={{ color: 'var(--ink)' }}>{ca(fmtEurFull(kpis.hostPayoutEur))}/Monat</strong>{' '}
                ({pct(hostShare)}% vom Rechenumsatz von {ca(fmtEurFull(kpis.grossEur))}) an{' '}
                {kpis.liveSites} {kpis.liveSites === 1 ? 'Standort' : 'Standorten'} — passiv;
                Hardware, Strom und Betrieb finanziert Cumulus.
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
                <Ramp data={kpis.grossTrend} />
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--slate)' }}>
                {fmtEur(kpis.grossTrend[0] ?? 0)} → {ca(fmtEur(kpis.grossEur))} Brutto · Ergebnis{' '}
                {ca(fmtEur(kpis.cumulusResultEur))}/Monat
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Role section ─────────────────────────────────────────────────── */}
      {role === 'owner' ? (
        <OwnerSites sites={addedSites} hostShare={hostShare} onSelect={setSelId} onAdd={() => setShowAdd(true)} />
      ) : (
        <ExecSummary kpis={kpis} capexPerGpu={capexPerGpu} setCapexPerGpu={setCapexPerGpu} />
      )}

      <Portfolio role={role} hostShare={hostShare} added={added} onToggleAdd={toggleAdd} />

      <Assumptions energyPrice={energyPrice} hostShare={hostShare} capexPerGpu={capexPerGpu} />

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
        Standorte und Status sind <strong style={{ color: 'var(--ink)' }}>live</strong> aus der
        Cumulus-Steuerung. Auslastung, Umsätze und Energiewerte sind für diese Vorschau{' '}
        <strong style={{ color: 'var(--ink)' }}>geschätzt</strong> — in Produktion an echte Messung
        angebunden.
      </footer>

      {selected && (
        <SiteDrawer site={selected} hostShare={hostShare} onClose={() => setSelId(null)} />
      )}
      {showAdd && <PropertyModal hostShare={hostShare} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ── Owner: portfolio site cards (their share) ────────────────────────────────
function OwnerSites({
  sites,
  hostShare,
  onSelect,
  onAdd,
}: {
  sites: Site[];
  hostShare: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          Ihre aktivierten Standorte
        </h2>
        <button className="b-btn-ghost" onClick={onAdd}>
          + Immobilie schätzen
        </button>
      </div>
      {sites.length === 0 && (
        <div className="b-card b-card-pad text-sm" style={{ color: 'var(--slate)' }}>
          Noch keine Fläche aktiviert. Wählen Sie unten in der Liste oder auf der Karte (○) Gebäude
          aus Ihrem Portfolio aus — die Kennzahlen oben aktualisieren sich sofort.
        </div>
      )}
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
                <div className="b-kpi-val text-[1.5rem]">{ca(fmtEur(hostShareOf(s.monthlyRevenueEur, hostShare)))}</div>
                <div className="b-kpi-label">Ihr Anteil / Monat</div>
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

// ── Exec Summary: the revenue → capex waterfall ──────────────────────────────
function ExecSummary({
  kpis,
  capexPerGpu,
  setCapexPerGpu,
}: {
  kpis: ReturnType<typeof boardKpis>;
  capexPerGpu: number;
  setCapexPerGpu: (v: number) => void;
}) {
  const rows: { l: string; v: string; strong?: boolean }[] = [
    { l: 'Bruttoumsatz (Rechenleistung)', v: fmtEurFull(kpis.grossEur), strong: true },
    { l: `− Vergütung Immobilienpartner (${pct(kpis.hostSharePct)}%)`, v: '− ' + fmtEurFull(kpis.hostPayoutEur) },
    { l: '− Energiekosten (Cumulus)', v: '− ' + fmtEurFull(kpis.energyCostEur) },
    { l: '= Operativer Beitrag / Monat', v: fmtEurFull(kpis.contributionEur), strong: true },
    { l: `− Hardware-Abschreibung (${ASSUMPTIONS.hardwareLifeMonths} Mt)`, v: '− ' + fmtEurFull(kpis.amortEur) },
    { l: '= Cumulus-Ergebnis / Monat', v: fmtEurFull(kpis.cumulusResultEur), strong: true },
    { l: 'Cumulus-Marge (Ergebnis/Brutto)', v: `${kpis.cumulusMarginPct}%` },
    { l: 'Hardware-Investition (Capex)', v: fmtEurFull(kpis.capexEur) },
    { l: 'GPUs (von Cumulus finanziert)', v: fmtNum(kpis.gpus) },
    { l: 'Amortisation (Payback)', v: `${kpis.paybackMonths} Monate` },
    { l: 'Installierte Leistung', v: `${kpis.totalCapacityKw} kW` },
    { l: 'Zahlende Kunden', v: String(kpis.customers) },
  ];
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <h2 className="board-display mb-3 text-lg" style={{ color: 'var(--navy)' }}>
        Wirtschaftlichkeit (Cumulus)
      </h2>
      <div className="b-card b-card-pad mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="b-kpi-label" style={{ whiteSpace: 'nowrap' }}>
          Hardware-Kosten je GPU (Capex)
        </span>
        <input
          type="range"
          min={1500}
          max={6000}
          step={250}
          value={capexPerGpu}
          onChange={(e) => setCapexPerGpu(parseFloat(e.target.value))}
          className="min-w-[160px] flex-1"
          style={{ accentColor: 'var(--navy)' }}
          aria-label="Hardware-Kosten je GPU"
        />
        <span className="board-display text-sm" style={{ color: 'var(--navy)', whiteSpace: 'nowrap' }}>
          {fmtEurFull(capexPerGpu)} / GPU
        </span>
      </div>
      <div className="b-card b-card-pad">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.l} className="flex items-baseline justify-between py-2" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="text-sm" style={{ color: r.strong ? 'var(--ink)' : 'var(--slate)', fontWeight: r.strong ? 600 : 400 }}>
                {r.l}
              </span>
              <span
                className="board-display text-base"
                style={{ color: r.v.startsWith('−') ? 'var(--slate)' : 'var(--navy)' }}
              >
                {r.v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Assumptions (single source of truth, made transparent) ───────────────────
function Assumptions({ energyPrice, hostShare, capexPerGpu }: { energyPrice: number; hostShare: number; capexPerGpu: number }) {
  const de = (n: number) => String(n).replace('.', ',');
  const rows: [string, string][] = [
    ['Ertrag je GPU / Monat (Cumulus brutto, konservativ)', ca(fmtEurFull(ASSUMPTIONS.revPerGpuMonth))],
    ['Daraus: Ertrag je kW / Monat (brutto)', ca(fmtEurFull(Math.round(revPerKwMonth)))],
    ['Umsatzanteil Immobilienpartner (anpassbar)', `${pct(hostShare)}%`],
    ['Leistung je GPU (4090-Klasse, inkl. Kühlung)', `${de(ASSUMPTIONS.kwPerGpu)} kW`],
    ['Fläche je GPU (inkl. Gang/Technik)', `${de(ASSUMPTIONS.sqmPerGpu)} m²`],
    ['Ziel-Auslastung', `${ASSUMPTIONS.targetUtilizationPct}%`],
    ['Strompreis (anpassbar, Cumulus trägt)', `${energyPrice.toFixed(2).replace('.', ',')} €/kWh`],
    ['Eigenstrom (Solar), Ø', `${ASSUMPTIONS.avgSolarPct}%`],
    ['Nutzbarer Anteil des Netzanschlusses', `${pct(ASSUMPTIONS.computeHeadroomPct)}%`],
    ['Hardware-Kosten je GPU (anpassbar)', `${fmtEurFull(capexPerGpu)}`],
    ['Hardware-Laufzeit (Abschreibung)', `${ASSUMPTIONS.hardwareLifeMonths} Monate`],
  ];
  return (
    <section className="reveal mt-6" style={{ '--d': '680ms' } as React.CSSProperties}>
      <details className="b-card b-card-pad">
        <summary className="board-display text-base" style={{ cursor: 'pointer', color: 'var(--navy)' }}>
          Annahmen
        </summary>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
          Alle Beträge auf dieser Seite leiten sich aus diesen Annahmen ab — Schätzungen für die
          Vorschau. €/GPU ist Cumulus&apos; Bruttoumsatz; der Immobilienpartner erhält seinen Anteil
          davon. Standorte und Status sind live.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {rows.map(([l, v]) => (
            <div key={l} className="flex items-baseline justify-between py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="text-sm" style={{ color: 'var(--slate)' }}>
                {l}
              </span>
              <span className="board-display text-sm" style={{ color: 'var(--navy)' }}>
                {v}
              </span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// ── TAMAX portfolio — add buildings to the fleet ─────────────────────────────
function Portfolio({
  role,
  hostShare,
  added,
  onToggleAdd,
}: {
  role: Role;
  hostShare: number;
  added: number[];
  onToggleAdd: (id: number) => void;
}) {
  const isOwner = role === 'owner';
  const addedSet = new Set(added);
  const sorted = [...TAMAX_PORTFOLIO].sort((a, b) => b.connectionKw - a.connectionKw);
  const shown = (kw: number) => (isOwner ? hostShareOf(kw, hostShare) : kw);
  const addedTotal = sorted.filter((p) => addedSet.has(p.id)).reduce((a, p) => a + shown(portfolioMrr(p)), 0);
  const allTotal = sorted.reduce((a, p) => a + shown(portfolioMrr(p)), 0);
  return (
    <section className="reveal mb-2" style={{ '--d': '600ms' } as React.CSSProperties}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          TAMAX-Portfolio — Flächen anbinden
        </h2>
        <span className="text-sm" style={{ color: 'var(--slate)' }}>
          {added.length}/{TAMAX_PORTFOLIO.length} aktiviert ·{' '}
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>+ {ca(fmtEurFull(addedTotal))}/Monat</span>{' '}
          · Gesamtpotenzial {ca(fmtEurFull(allTotal))}/Monat
        </span>
      </div>
      <div className="b-card overflow-hidden">
        <div style={{ maxHeight: 440, overflowY: 'auto' }}>
          <table className="b-table w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="text-left">Projekt</th>
                <th className="text-left">Status</th>
                <th className="text-right">Anschluss</th>
                <th className="text-right">Rechen-kW</th>
                <th className="text-right">{isOwner ? 'Ihr Anteil / Mt' : 'Brutto / Mt'}</th>
                <th className="text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const on = addedSet.has(p.id);
                return (
                  <tr key={p.id} style={{ background: on ? 'rgba(169,132,63,.08)' : undefined }}>
                    <td>
                      <div className="board-display" style={{ color: 'var(--navy)' }}>{p.name}</div>
                      <div className="text-xs" style={{ color: 'var(--slate)' }}>{p.ort}</div>
                    </td>
                    <td>
                      <span
                        className="stage"
                        style={{
                          background: p.built ? 'rgba(0,26,69,.1)' : 'rgba(124,117,104,.14)',
                          color: p.built ? 'var(--navy)' : 'var(--slate)',
                        }}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{fmtNum(p.connectionKw)} kW</td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--slate)' }}>{fmtNum(portfolioComputeKw(p))} kW</td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--ink)' }}>{ca(fmtEurFull(shown(portfolioMrr(p))))}</td>
                    <td className="text-right">
                      <button
                        className={on ? 'b-btn-primary' : 'b-btn-ghost'}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
                        onClick={() => onToggleAdd(p.id)}
                      >
                        {on ? '✓ in Flotte' : '+ Flotte'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--slate)' }}>
        Rechen-kW = {pct(ASSUMPTIONS.computeHeadroomPct)}% des Netzanschlusses (nutzbare, flexible
        Last) — Schätzung, keine netzbestätigten Werte.
      </p>
    </section>
  );
}

// ── Property potential calculator ────────────────────────────────────────────
function PropertyModal({ hostShare, onClose }: { hostShare: number; onClose: () => void }) {
  const [sqm, setSqm] = useState('');
  const [kw, setKw] = useState('');
  const sqmN = parseFloat(sqm) || 0;
  const kwN = parseFloat(kw) || 0;
  const est = useMemo(() => estimateProperty(sqmN, kwN), [sqmN, kwN]);
  const ready = sqmN > 0 && kwN > 0;
  const yourShare = hostShareOf(est.monthlyRevenueEur, hostShare);

  return (
    <div className="b-modal">
      <div className="scrim" onClick={onClose} />
      <div className="b-card b-card-pad reveal" style={{ position: 'relative', zIndex: 51, width: 'min(520px, 96vw)' }}>
        <h3 className="board-display text-xl" style={{ color: 'var(--navy)' }}>
          Immobilie hinzufügen
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--slate)' }}>
          Schätzen Sie das Potenzial einer Fläche — z. B. ein Technikraum oder ein leerstehendes
          Ladenlokal. Maßgeblich sind verfügbare Fläche und vor allem die Anschlussleistung
          (in der Regel der Engpass).
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="b-kpi-label mb-1 block">Verfügbare Fläche (m²)</span>
            <input className="b-input" type="number" min={0} placeholder="z. B. 80" value={sqm} onChange={(e) => setSqm(e.target.value)} />
          </label>
          <label>
            <span className="b-kpi-label mb-1 block">Anschlussleistung (kW)</span>
            <input className="b-input" type="number" min={0} step={5} placeholder="z. B. 120" value={kw} onChange={(e) => setKw(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="b-card b-card-pad" style={{ background: '#faf8f3' }}>
            <div className="b-kpi-val text-[1.7rem]">{ready ? `ca. ${fmtNum(est.gpus)}` : '—'}</div>
            <div className="b-kpi-label">GPUs (geschätzt)</div>
          </div>
          <div className="b-card b-card-pad" style={{ background: '#faf8f3' }}>
            <div className="b-kpi-val text-[1.7rem]">{ready ? ca(fmtEurFull(yourShare)) : '—'}</div>
            <div className="b-kpi-label">Ihr Anteil / Monat ({pct(hostShare)}%)</div>
          </div>
        </div>

        {ready && (
          <div className="mt-3 rounded-lg p-3 text-xs leading-relaxed" style={{ background: '#f1eee6', color: 'var(--slate)' }}>
            <div className="flex items-center justify-between">
              <span>Anschlussleistung erlaubt</span>
              <span className="tabular-nums" style={{ color: 'var(--navy)', fontWeight: est.limitedBy === 'power' ? 700 : 400 }}>
                {fmtNum(est.byPower)} GPUs
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fläche erlaubt</span>
              <span className="tabular-nums" style={{ color: 'var(--navy)', fontWeight: est.limitedBy === 'space' ? 700 : 400 }}>
                {fmtNum(est.bySpace)} GPUs
              </span>
            </div>
            <div className="mt-2">
              Begrenzend:{' '}
              <strong style={{ color: 'var(--navy)' }}>
                {est.limitedBy === 'power' ? 'Anschlussleistung' : 'Fläche'}
              </strong>{' '}
              — meist ist die Anschlussleistung der Engpass. Rechenumsatz brutto{' '}
              {ca(fmtEurFull(est.monthlyRevenueEur))}/Monat; Ihr Anteil {pct(hostShare)}% ={' '}
              {ca(fmtEurFull(yourShare))}/Monat. Grobe Planungsschätzung — keine Zusage.
            </div>
          </div>
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
function SiteDrawer({ site, hostShare, onClose }: { site: Site; hostShare: number; onClose: () => void }) {
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
              <Stat label={`Ihr Anteil / Monat (${pct(hostShare)}%)`} value={ca(fmtEurFull(hostShareOf(site.monthlyRevenueEur, hostShare)))} />
              <Stat label="Rechenumsatz brutto" value={ca(fmtEurFull(site.monthlyRevenueEur))} />
              <Stat label="Leistung" value={`${site.capacityKw} kW`} />
              <Stat label="Verfügbarkeit" value={`${site.uptimePct}%`} />
            </div>
          </div>

          <DrawerChart title="Auslastung · 24h" unit="%" data={series(site, 'utilization')} />
          <DrawerChart title="Rechenumsatz · 24h (brutto, ca.)" data={series(site, 'revenue')} color="var(--gold)" fmt={(v) => `€${v.toFixed(0)}/h`} />
          <div className="mt-4">
            <div className="b-kpi-label mb-1">Strom vs. Netz · 24h</div>
            <Area data={series(site, 'power')} data2={series(site, 'grid')} height={120} fmt={(v) => `${v.toFixed(1)} kW`} />
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {site.solarPct > 0 ? `${site.solarPct}% vor Ort erzeugt` : 'aus dem Netz'} · Differenz = Eigenerzeugung
            </div>
          </div>

          <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
            Standort & Status sind live; Auslastung, Umsatz und Energie sind für diese Vorschau
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
