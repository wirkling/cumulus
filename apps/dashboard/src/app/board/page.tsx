'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { NodeSummary, Customer, FleetAllocation } from '@cumulus/shared-types';
import { usePoll, timeAgo } from '@/lib/ui';
import { Atlas } from './Atlas';
import { Area, Gauge, GrowthChart, Spark } from './charts';
import {
  siteFromNode,
  series,
  boardKpis,
  hostShareOf,
  profitShareRatio,
  toCandidates,
  candidateToSite,
  customToCandidate,
  revenueTimeline,
  ASSUMPTIONS,
  revPerKwMonth,
  TL_START_YEAR,
  TL_NOW_INDEX,
  fmtEur,
  fmtEurFull,
  fmtNum,
  type Site,
  type Candidate,
  type CustomDraft,
} from './mock';
import { TAMAX, SALLIER } from './developers';

const STATUS_OPTIONS = ['In Planung', 'Im Bau', 'Im Vertrieb', 'Im Bestand', 'Abgeschlossen'];
const YEARS = Array.from({ length: 9 }, (_, i) => 2024 + i); // 2024–2032, for "Live ab"
const centerOf = (b: Bounds) => ({ lng: (b[0][0] + b[1][0]) / 2, lat: (b[0][1] + b[1][1]) / 2 });

const MapboxMap = dynamic(() => import('./MapboxMap').then((m) => m.MapboxMap), { ssr: false });
const HAS_MAPBOX = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type Tab = 'tamax' | 'sallier' | 'board';
type Bounds = [[number, number], [number, number]];
const ca = (s: string) => `ca. ${s}`;
const pct = (f: number) => Math.round(f * 100);
const NOW_YEAR = 2026;

// Each developer tab frames its own region; the Cumulus view frames the whole
// fleet (both developer regions + the southern live nodes).
const TAMAX_BOUNDS: Bounds = [[11.2, 51.9], [14.7, 53.8]];
const SALLIER_BOUNDS: Bounds = [[9.2, 52.7], [10.9, 53.8]];
const FLEET_BOUNDS: Bounds = [[9.3, 48.8], [15.0, 54.0]];
// user-added ("Eigenes Projekt") rows get a marker at their developer's centre
const CENTER: Record<string, { lat: number; lng: number }> = {
  tamax: centerOf(TAMAX_BOUNDS),
  sallier: centerOf(SALLIER_BOUNDS),
};

function aggSeries(sites: Site[], kind: 'power' | 'grid'): number[] {
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
  const { data: allocation } = usePoll<FleetAllocation>('/api/allocation', 5000);
  const [tab, setTab] = useState<Tab>('tamax');
  const [selId, setSelId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [energyPrice, setEnergyPrice] = useState(ASSUMPTIONS.energyPriceEurKwh);
  const [hostShare, setHostShare] = useState(ASSUMPTIONS.hostSharePct);
  const [added, setAdded] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [customs, setCustoms] = useState<CustomDraft[]>([]);
  const customSeq = useRef(0);
  const toggleAdd = (key: string) =>
    setAdded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const isCustom = (key: string) => key.startsWith('custom:');
  const editKw = (key: string, kw: number) => {
    if (isCustom(key)) setCustoms((prev) => prev.map((c) => (c.key === key ? { ...c, connectionKw: kw } : c)));
    else setOverrides((prev) => ({ ...prev, [key]: kw }));
  };
  const addProject = (devId: string) => {
    const n = customSeq.current++;
    setCustoms((prev) => [...prev, { key: `custom:${devId}:${n}`, devId, n, name: '', status: 'In Planung', goLive: 2027, connectionKw: 0 }]);
  };
  const editCustom = (key: string, patch: Partial<CustomDraft>) =>
    setCustoms((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const removeCustom = (key: string) => {
    setCustoms((prev) => prev.filter((c) => c.key !== key));
    setAdded((prev) => prev.filter((k) => k !== key));
  };

  // Pin a condensed KPI strip into the sticky masthead once the band scrolls out.
  const [kpiPinned, setKpiPinned] = useState(false);
  const kpiObs = useRef<IntersectionObserver | null>(null);
  const kpiRef = useCallback((el: HTMLElement | null) => {
    kpiObs.current?.disconnect();
    if (!el) return;
    kpiObs.current = new IntersectionObserver(
      (entries) => setKpiPinned(!(entries[0]?.isIntersecting ?? true)),
      { rootMargin: '-76px 0px 0px 0px' },
    );
    kpiObs.current.observe(el);
  }, []);

  const sites = useMemo(() => (nodes ?? []).map(siteFromNode), [nodes]);
  const tamaxCands = useMemo(
    () => [
      ...toCandidates(TAMAX.id, TAMAX.sites, overrides),
      ...customs.filter((c) => c.devId === TAMAX.id).map((d) => customToCandidate(d, CENTER[TAMAX.id]!)),
    ],
    [overrides, customs],
  );
  const sallierCands = useMemo(
    () => [
      ...toCandidates(SALLIER.id, SALLIER.sites, overrides),
      ...customs.filter((c) => c.devId === SALLIER.id).map((d) => customToCandidate(d, CENTER[SALLIER.id]!)),
    ],
    [overrides, customs],
  );
  const allCands = useMemo(() => [...tamaxCands, ...sallierCands], [tamaxCands, sallierCands]);
  const addedSet = useMemo(() => new Set(added), [added]);
  const tamaxFleet = useMemo(
    () => tamaxCands.filter((c) => addedSet.has(c.key)).map(candidateToSite),
    [tamaxCands, addedSet],
  );
  const sallierFleet = useMemo(
    () => sallierCands.filter((c) => addedSet.has(c.key)).map(candidateToSite),
    [sallierCands, addedSet],
  );
  const cumulusFleet = useMemo(() => [...sites, ...tamaxFleet, ...sallierFleet], [sites, tamaxFleet, sallierFleet]);

  const cust = customers?.length ?? 0;
  const tamaxKpis = useMemo(
    () => boardKpis(tamaxFleet, cust, { energyPriceEurKwh: energyPrice, hostSharePct: hostShare }),
    [tamaxFleet, cust, energyPrice, hostShare],
  );
  const sallierKpis = useMemo(
    () => boardKpis(sallierFleet, cust, { energyPriceEurKwh: energyPrice, hostSharePct: hostShare }),
    [sallierFleet, cust, energyPrice, hostShare],
  );
  const cumulusKpis = useMemo(
    () => boardKpis(cumulusFleet, cust, { energyPriceEurKwh: energyPrice, hostSharePct: hostShare }),
    [cumulusFleet, cust, energyPrice, hostShare],
  );

  if (!nodes) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="board-display text-2xl" style={{ color: 'var(--navy)' }}>
          Portfolio wird geladen…
        </div>
      </div>
    );
  }

  const isBoard = tab === 'board';
  const dev = tab === 'sallier' ? SALLIER : TAMAX; // active developer (when !isBoard)
  const devCands = tab === 'sallier' ? sallierCands : tamaxCands;
  const devFleet = tab === 'sallier' ? sallierFleet : tamaxFleet;
  const devKpis = tab === 'sallier' ? sallierKpis : tamaxKpis;

  const kpis = isBoard ? cumulusKpis : devKpis;
  const viewFleet = isBoard ? cumulusFleet : devFleet;
  const liveNodes = nodes.filter((n) => n.status === 'online').length;
  const liveJobs = allocation?.jobs.length ?? 0;
  const liveLeases = allocation?.leases.length ?? 0;
  const splitLabel = `${pct(hostShare)}% vom Ergebnis`;

  // The host is paid a share of PROFIT — so per-site "Ihr Anteil" must use the
  // realized payout÷gross RATIO (≈8%), not the 40% profit-share headline. Using
  // the fleet ratio makes the per-site cards sum exactly to the headline
  // Vergütung; fall back to a representative ratio before anything is activated.
  const hostRatio =
    kpis.grossEur > 0
      ? kpis.hostPayoutEur / kpis.grossEur
      : profitShareRatio({ energyPriceEurKwh: energyPrice, hostSharePct: hostShare });

  // Over-time growth — a developer tab shows its host cash-share ramp; the board
  // shows the fleet gross. Each site ramps softly after its own go-live.
  const growthData = isBoard
    ? revenueTimeline(cumulusFleet)
    : revenueTimeline(devFleet).map((v) => Math.round(v * hostRatio));

  const kpiCards = !isBoard
    ? [
        { l: 'Vergütung', v: ca(fmtEurFull(kpis.hostPayoutEur)), s: `${splitLabel} / Mt` },
        { l: '+ Wärme-Gutschrift', v: ca(fmtEurFull(kpis.heatCreditEur)), s: 'Heizkosten gespart / Mt' },
        { l: '= Gesamtnutzen', v: ca(fmtEurFull(kpis.hostTotalBenefitEur)), s: 'weitgehend passiv / Mt' },
        { l: 'Aktive Standorte', v: String(kpis.liveSites), s: `${kpis.totalCapacityKw} kW Rechenlast` },
      ]
    : [
        { l: 'Live-Betrieb', v: `${liveNodes}/${nodes.length} Knoten`, s: `${liveJobs} Anfragen orchestriert` },
        { l: 'Bruttoumsatz', v: ca(fmtEurFull(kpis.grossEur)), s: `≈ ${fmtEur(kpis.grossArrEur)} / Jahr` },
        { l: 'Cumulus-Ergebnis', v: ca(fmtEurFull(kpis.cumulusResultEur)), s: 'nach Partner, Energie & Hardware / Mt' },
        { l: 'Amortisation', v: `${kpis.paybackMonths} Mt`, s: `bei ${ca(fmtEurFull(kpis.capexEur))} Capex` },
      ];

  // Map content is tab-aware: a developer tab shows only that developer's
  // candidates (no live-node dots — that infra isn't theirs); the board shows the
  // live nodes + the activated fleet across both regions.
  const mapSites = isBoard ? sites : [];
  const mapCands = isBoard ? allCands.filter((c) => addedSet.has(c.key)) : devCands;
  const mapBounds = isBoard ? FLEET_BOUNDS : tab === 'sallier' ? SALLIER_BOUNDS : TAMAX_BOUNDS;

  const selected = cumulusFleet.find((s) => s.id === selId) ?? null;
  const previewCand = previewKey ? (allCands.find((c) => c.key === previewKey) ?? null) : null;

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-7">
      {/* ── Masthead (sticky) ────────────────────────────────────────────── */}
      <header className="board-sticky mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="b-wordmark text-2xl font-medium" style={{ color: 'var(--navy)' }}>
            {isBoard ? (
              <>
                Cumulus <span style={{ color: 'var(--sand)' }}>·</span>{' '}
                <span style={{ color: 'var(--gold)' }}>Flotte</span>
              </>
            ) : (
              <>
                {dev.name} <span style={{ color: 'var(--sand)' }}>×</span>{' '}
                <span style={{ color: 'var(--gold)' }}>Cumulus</span>
              </>
            )}
          </div>
          <div className="mt-0.5 text-sm" style={{ color: 'var(--slate)' }}>
            {isBoard
              ? 'Cumulus Summary — Flotten-Performance aus allen Zuweisungen'
              : `${dev.name} · Opportunity Simulator — Rechenleistung in Ihren Flächen`}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--slate)' }}>
            <span className="live-dot" /> Live · {isBoard ? 'alle Regionen' : dev.region}
          </span>
          <div className="seg" role="tablist" aria-label="Ansicht">
            <button className={tab === 'tamax' ? 'active' : ''} onClick={() => setTab('tamax')}>
              {TAMAX.name}
            </button>
            <button className={tab === 'sallier' ? 'active' : ''} onClick={() => setTab('sallier')}>
              {SALLIER.name}
            </button>
            <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>
              Cumulus Summary
            </button>
          </div>
        </div>
        {/* condensed KPIs — appear in the sticky bar once the full band scrolls past */}
        <div
          className="w-full overflow-hidden transition-all duration-300"
          style={{ maxHeight: kpiPinned ? 40 : 0, opacity: kpiPinned ? 1 : 0 }}
          aria-hidden={!kpiPinned}
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            {kpiCards.map((k) => (
              <span key={k.l} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--slate)' }}>
                  {k.l}
                </span>
                <span className="board-display text-sm" style={{ color: 'var(--navy)' }}>
                  {k.v}
                </span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── KPI band ─────────────────────────────────────────────────────── */}
      <section ref={kpiRef} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpiCards.map((k, i) => (
          <div key={k.l} className="b-card b-card-pad reveal" style={{ '--d': `${80 + i * 60}ms` } as React.CSSProperties}>
            <div className="b-kpi-label">{k.l}</div>
            <div className="b-kpi-val mt-2 text-[1.85rem]">{k.v}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {k.s}
            </div>
          </div>
        ))}
      </section>

      {!isBoard && (
        <p className="mb-4 -mt-1 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
          Gesamtnutzen = Vergütung (Ergebnisanteil) + Wärme-Gutschrift. Die Vergütung ist weitgehend
          passiv; für die Wärmeauskopplung kann je nach Gebäude — v. a. im Bestand — eine einmalige
          Anschlussinvestition anfallen.
        </p>
      )}

      {/* ── Flächen anbinden (top — the primary action: add buildings → KPIs update) ── */}
      {!isBoard && (
        <PortfolioTable
          title={`${dev.name}-Portfolio — Flächen anbinden`}
          cands={devCands}
          addedSet={addedSet}
          onToggle={toggleAdd}
          onEditKw={editKw}
          onEditCustom={editCustom}
          onRemoveCustom={removeCustom}
          onAddProject={() => addProject(dev.id)}
          isOwner
          hostRatio={hostRatio}
        />
      )}

      {/* ── Stellschrauben (developer tabs only; the Cumulus view just consumes) ── */}
      {!isBoard && (
        <section className="reveal mb-6" style={{ '--d': '300ms' } as React.CSSProperties}>
          <div className="b-card b-card-pad">
            <div className="b-kpi-label mb-3">Stellschrauben — wirken auf beide Ansichten</div>
            <div className="grid gap-5 sm:grid-cols-2">
              <SliderRow
                label="Strompreis (Cumulus trägt)"
                value={energyPrice}
                min={0.05}
                max={0.6}
                step={0.01}
                display={`${energyPrice.toFixed(2).replace('.', ',')} €/kWh`}
                accent="var(--navy)"
                onChange={setEnergyPrice}
              />
              <SliderRow
                label="Host-Anteil am Ergebnis"
                value={hostShare}
                min={0.1}
                max={0.8}
                step={0.05}
                display={`${pct(hostShare)}% · Cumulus ${100 - pct(hostShare)}%`}
                accent="var(--gold)"
                onChange={setHostShare}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Map + side ───────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="b-card reveal lg:col-span-7" style={{ '--d': '320ms' } as React.CSSProperties}>
          <div className="flex items-baseline justify-between px-4 pb-3 pt-3">
            <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
              Standortkarte
            </h2>
            <span className="text-xs" style={{ color: 'var(--slate)' }}>
              {isBoard
                ? '● Live-Knoten · ○ aktivierte Flotte'
                : `○ ${dev.name}-Portfolio (anklicken für Vorschau)`}
            </span>
          </div>
          {HAS_MAPBOX ? (
            <div className="px-3 pb-3">
              <MapboxMap
                sites={mapSites}
                candidates={mapCands}
                addedKeys={added}
                onPreview={setPreviewKey}
                selectedId={selId}
                onSelect={setSelId}
                bounds={mapBounds}
              />
            </div>
          ) : (
            <Atlas sites={mapSites} candidates={mapCands} addedKeys={added} onPreview={setPreviewKey} selectedId={selId} onSelect={setSelId} />
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
              <Area data={aggSeries(viewFleet, 'power')} data2={aggSeries(viewFleet, 'grid')} height={92} fmt={(v) => `${v.toFixed(1)} kW`} />
            </div>
            <div className="mt-1 flex gap-4 text-[11px]" style={{ color: 'var(--slate)' }}>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 2, background: 'var(--navy)', display: 'inline-block' }} /> Gesamt
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--gold)', display: 'inline-block' }} /> aus Netz
              </span>
            </div>
            <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--slate)' }}>
              Strompreis {energyPrice.toFixed(2).replace('.', ',')} €/kWh · Energiekosten{' '}
              {ca(fmtEurFull(kpis.energyCostEur))}/Mt · Cumulus-Marge{' '}
              <strong style={{ color: 'var(--ink)' }}>{kpis.cumulusMarginPct}%</strong>
            </div>
          </div>

          {/* Wachstum über Zeit */}
          <div className="b-card b-card-pad reveal" style={{ '--d': '440ms' } as React.CSSProperties}>
            <div className="flex items-baseline justify-between">
              <h3 className="board-display text-base" style={{ color: 'var(--navy)' }}>
                {isBoard ? 'Bruttoumsatz über Zeit' : 'Ihr Anteil über Zeit'}
              </h3>
              <span className="text-xs" style={{ color: 'var(--gold)' }}>
                {ca(fmtEur(growthData[TL_NOW_INDEX] ?? 0))} → {ca(fmtEur(growthData[growthData.length - 1] ?? 0))}/Mt
              </span>
            </div>
            <div className="mt-2">
              <GrowthChart
                data={growthData}
                nowIndex={TL_NOW_INDEX}
                startYear={TL_START_YEAR}
                color={isBoard ? 'var(--navy)' : 'var(--gold)'}
                fmt={(v) => `${fmtEur(v)}/Mt`}
              />
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--slate)' }}>
              {isBoard
                ? 'Monatlicher Rechenumsatz der Flotte — jeder Standort rampt nach seinem Go-Live weich hoch (Jan 2024 – Dez 2029). Das KPI-Band oben zeigt das Ziel bei vollem Betrieb.'
                : 'Ihr monatlicher Anteil wächst, sobald Ihre Flächen ans Netz gehen — weicher Hochlauf je Standort (Jan 2024 – Dez 2029). Das KPI-Band oben zeigt das Ziel bei vollem Betrieb.'}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tab section ──────────────────────────────────────────────────── */}
      {!isBoard ? (
        <OwnerSites sites={devFleet} hostRatio={hostRatio} onSelect={setSelId} />
      ) : (
        <>
          <LiveOrchestration nodes={nodes} liveNodes={liveNodes} liveJobs={liveJobs} liveLeases={liveLeases} />
          <FleetMix liveNodes={liveNodes} tamax={tamaxFleet.length} sallier={sallierFleet.length} kpis={cumulusKpis} />
          <ExecSummary kpis={kpis} />
        </>
      )}

      <Assumptions energyPrice={energyPrice} hostShare={hostShare} />

      <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
        Knoten und Status sind <strong style={{ color: 'var(--ink)' }}>live</strong> aus der
        Cumulus-Steuerung. Portfolio-Umsätze, Auslastung, Energie und der zeitliche Hochlauf sind für
        diese Vorschau <strong style={{ color: 'var(--ink)' }}>geschätzt</strong> — in Produktion an
        echte Messung angebunden. {SALLIER.name} ist ein realer Entwickler der Region; die hier
        gezeigte Projektliste und alle Rechenwerte sind illustrativ.
      </footer>

      {selected && <SiteDrawer site={selected} hostRatio={hostRatio} onClose={() => setSelId(null)} />}
      {previewCand && (
        <PortfolioPreview
          cand={previewCand}
          hostRatio={hostRatio}
          added={addedSet.has(previewCand.key)}
          onToggle={() => toggleAdd(previewCand.key)}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  );
}

// ── Owner: portfolio site cards (their share) ────────────────────────────────
function OwnerSites({ sites, hostRatio, onSelect }: { sites: Site[]; hostRatio: number; onSelect: (id: string) => void }) {
  return (
    <section className="reveal mb-6" style={{ '--d': '520ms' } as React.CSSProperties}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          Ihre aktivierten Standorte
        </h2>
        <span className="text-sm" style={{ color: 'var(--slate)' }}>
          {sites.length} aktiv
        </span>
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
              <span className="stage" style={{ background: 'rgba(0,26,69,.1)', color: 'var(--navy)' }}>
                {s.goLiveYear <= NOW_YEAR ? 'aktiv' : `ab ${s.goLiveYear}`}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="b-kpi-val text-[1.5rem]">{ca(fmtEur(hostShareOf(s.monthlyRevenueEur, hostRatio)))}</div>
                <div className="b-kpi-label">Ihr Anteil / Monat</div>
              </div>
              <div className="text-right">
                <Spark data={series(s, 'utilization')} />
                <div className="b-kpi-label mt-0.5">{s.utilizationPct}% Auslastung · {s.capacityKw} kW</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Cumulus fleet composition (live + activated developer fleets) ────────────
function FleetMix({ liveNodes, tamax, sallier, kpis }: { liveNodes: number; tamax: number; sallier: number; kpis: ReturnType<typeof boardKpis> }) {
  const items = [
    { l: 'Live-Knoten (real)', v: String(liveNodes) },
    { l: 'TAMAX-Flächen', v: String(tamax) },
    { l: 'SALLIER-Flächen', v: String(sallier) },
    { l: 'Rechenlast gesamt', v: `${fmtNum(kpis.totalCapacityKw)} kW` },
    { l: 'GPUs', v: fmtNum(kpis.gpus) },
  ];
  return (
    <section className="reveal mb-6" style={{ '--d': '500ms' } as React.CSSProperties}>
      <div className="b-card b-card-pad">
        <div className="b-kpi-label mb-2">Flotte aus den Entwickler-Zuweisungen</div>
        <p className="mb-3 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--slate)' }}>
          Cumulus bündelt mehrere Entwickler-Portfolios — <strong style={{ color: 'var(--ink)' }}>{TAMAX.name}</strong>{' '}
          und <strong style={{ color: 'var(--ink)' }}>{SALLIER.name}</strong> — zu einer Flotte. Aktivieren Sie
          Flächen in den jeweiligen Simulator-Tabs; das Potenzial endet nicht mit einem Partner.
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-5">
          {items.map((it) => (
            <div key={it.l}>
              <div className="b-kpi-val text-[1.5rem]">{it.v}</div>
              <div className="b-kpi-label mt-0.5">{it.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Exec Summary: the revenue → capex waterfall ──────────────────────────────
function ExecSummary({ kpis }: { kpis: ReturnType<typeof boardKpis> }) {
  const rows: { l: string; v: string; strong?: boolean }[] = [
    { l: 'Bruttoumsatz (Rechenleistung)', v: fmtEurFull(kpis.grossEur), strong: true },
    { l: `− Anteil Immobilienpartner (${pct(kpis.hostSharePct)}% vom Ergebnis)`, v: '− ' + fmtEurFull(kpis.hostPayoutEur) },
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
    <section className="reveal mb-6" style={{ '--d': '540ms' } as React.CSSProperties}>
      <h2 className="board-display mb-3 text-lg" style={{ color: 'var(--navy)' }}>
        Wirtschaftlichkeit (Cumulus)
      </h2>
      <div className="b-card b-card-pad">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.l} className="flex items-baseline justify-between py-2" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="text-sm" style={{ color: r.strong ? 'var(--ink)' : 'var(--slate)', fontWeight: r.strong ? 600 : 400 }}>
                {r.l}
              </span>
              <span className="board-display text-base" style={{ color: r.v.startsWith('−') ? 'var(--slate)' : 'var(--navy)' }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--slate)' }}>
        Zusätzlich fließt die <strong style={{ color: 'var(--ink)' }}>Abwärme (~{ca(fmtEurFull(kpis.heatCreditEur))}/Mt Heizwert)</strong>{' '}
        dem Immobilienpartner als Heizkostenersparnis zu — nicht in dieser Cumulus-Rechnung. Sie ist
        der Grund, im Gebäude zu rechnen statt nur am billigen Strom (für die Auskopplung kann je nach
        Bestand eine einmalige Anschlussinvestition anfallen).
      </p>
    </section>
  );
}

// ── Assumptions (single source of truth, made transparent) ───────────────────
function Assumptions({ energyPrice, hostShare }: { energyPrice: number; hostShare: number }) {
  const de = (n: number) => String(n).replace('.', ',');
  const rows: [string, string][] = [
    ['Ertrag je GPU / Monat (Cumulus brutto, konservativ)', ca(fmtEurFull(ASSUMPTIONS.revPerGpuMonth))],
    ['Daraus: Ertrag je kW / Monat (brutto)', ca(fmtEurFull(Math.round(revPerKwMonth)))],
    ['Beteiligung Immobilienpartner (Ergebnisanteil, anpassbar)', `${pct(hostShare)}% vom Ergebnis`],
    ['Hardware je GPU, fully installed (Annahme)', `${fmtEurFull(ASSUMPTIONS.capexPerGpuEur)}`],
    ['  inkl. Server/Feeder, Netzwerk, Rack, Kühlung, Installation', ''],
    ['Hardware-Laufzeit (Abschreibung)', `${ASSUMPTIONS.hardwareLifeMonths} Monate`],
    ['Strompreis (anpassbar, Cumulus trägt)', `${energyPrice.toFixed(2).replace('.', ',')} €/kWh`],
    ['Wärmerückgewinnung (Abwärme → Heizung)', `${pct(ASSUMPTIONS.heatRecoveryPct)}%`],
    ['Wärmewert (verdrängte Heizkosten)', `${de(ASSUMPTIONS.heatValueEurKwh)} €/kWh`],
    ['  Basis Gaswärme — bei Wärmepumpe niedriger anzusetzen', ''],
    ['Leistung je GPU (4090-Klasse, inkl. Kühlung)', `${de(ASSUMPTIONS.kwPerGpu)} kW`],
    ['Ziel-Auslastung', `${ASSUMPTIONS.targetUtilizationPct}%`],
    ['Eigenstrom (Solar), Ø', `${ASSUMPTIONS.avgSolarPct}%`],
    ['Nutzbarer Anteil des Netzanschlusses', `${pct(ASSUMPTIONS.computeHeadroomPct)}%`],
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
          am Ergebnis. Standorte und Status sind live.
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

// ── Reusable portfolio table — add buildings, edit connection, see go-live ────
function PortfolioTable({
  title,
  cands,
  addedSet,
  onToggle,
  onEditKw,
  onEditCustom,
  onRemoveCustom,
  onAddProject,
  isOwner,
  hostRatio,
}: {
  title: string;
  cands: Candidate[];
  addedSet: Set<string>;
  onToggle: (key: string) => void;
  onEditKw: (key: string, kw: number) => void;
  onEditCustom: (key: string, patch: { name?: string; status?: string; goLive?: number }) => void;
  onRemoveCustom: (key: string) => void;
  onAddProject: () => void;
  isOwner: boolean;
  hostRatio: number;
}) {
  const shown = (gross: number) => (isOwner ? hostShareOf(gross, hostRatio) : gross);
  const fixed = cands.filter((c) => !c.key.startsWith('custom:')).sort((a, b) => b.connectionKw - a.connectionKw);
  const custom = cands.filter((c) => c.key.startsWith('custom:')); // creation order, shown at the top
  const nAdded = cands.filter((c) => addedSet.has(c.key)).length;
  const addedTotal = cands.filter((c) => addedSet.has(c.key)).reduce((a, c) => a + shown(c.grossEur), 0);
  const allTotal = cands.reduce((a, c) => a + shown(c.grossEur), 0);
  return (
    <section className="reveal mb-6" style={{ '--d': '180ms' } as React.CSSProperties}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
            {title}
          </h2>
          <button className="b-add-row" onClick={onAddProject}>+ Projekt hinzufügen</button>
        </div>
        <span className="text-sm" style={{ color: 'var(--slate)' }}>
          {nAdded}/{cands.length} aktiviert ·{' '}
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>+ {ca(fmtEurFull(addedTotal))}/Monat</span>{' '}
          · Gesamtpotenzial {ca(fmtEurFull(allTotal))}/Monat
        </span>
      </div>
      <div className="b-card overflow-hidden">
        <div className="b-table-scroll" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="b-table w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="text-left">Projekt</th>
                <th className="text-left">Status</th>
                <th className="text-left">Live ab</th>
                <th className="text-right">Anschluss</th>
                <th className="text-right">Rechen-kW</th>
                <th className="text-right">{isOwner ? 'Ihr Anteil / Mt' : 'Brutto / Mt'}</th>
                <th className="text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {/* user-entered rows on top (immediately fillable), then the portfolio */}
              {[...custom, ...fixed].map((c) => {
                const on = addedSet.has(c.key);
                const isC = c.key.startsWith('custom:');
                return (
                  <tr key={c.key} style={{ background: on ? 'rgba(169,132,63,.08)' : isC ? 'rgba(0,26,69,.025)' : undefined }}>
                    <td>
                      {isC ? (
                        <input
                          className="b-cell-input board-display"
                          value={c.name}
                          placeholder="Projektname…"
                          onChange={(e) => onEditCustom(c.key, { name: e.target.value })}
                        />
                      ) : (
                        <>
                          <div className="board-display" style={{ color: 'var(--navy)' }}>{c.name}</div>
                          <div className="text-xs" style={{ color: 'var(--slate)' }}>{c.ort}</div>
                        </>
                      )}
                    </td>
                    <td>
                      {isC ? (
                        <select className="b-cell-select" value={c.status} onChange={(e) => onEditCustom(c.key, { status: e.target.value })}>
                          {STATUS_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="stage"
                          style={{
                            background: c.built ? 'rgba(0,26,69,.1)' : 'rgba(124,117,104,.14)',
                            color: c.built ? 'var(--navy)' : 'var(--slate)',
                          }}
                        >
                          {c.status}
                        </span>
                      )}
                    </td>
                    <td className={isC ? '' : 'tabular-nums'} style={isC ? undefined : { color: c.goLive <= NOW_YEAR ? 'var(--navy)' : 'var(--slate)' }}>
                      {isC ? (
                        <select className="b-cell-select" value={c.goLive} onChange={(e) => onEditCustom(c.key, { goLive: parseInt(e.target.value) })}>
                          {YEARS.map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      ) : c.goLive <= NOW_YEAR ? (
                        `seit ${c.goLive}`
                      ) : (
                        `ab ${c.goLive}`
                      )}
                    </td>
                    <td className="text-right">
                      <EditableKw value={c.connectionKw} onChange={(v) => onEditKw(c.key, v)} />
                    </td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--slate)' }}>{fmtNum(c.computeKw)} kW</td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--ink)' }}>{ca(fmtEurFull(shown(c.grossEur)))}</td>
                    <td className="text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          className={on ? 'b-btn-primary' : 'b-btn-ghost'}
                          style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
                          onClick={() => onToggle(c.key)}
                        >
                          {on ? '✓ in Flotte' : '+ Flotte'}
                        </button>
                        {isC && (
                          <button className="b-icon-btn" title="Zeile entfernen" aria-label="Zeile entfernen" onClick={() => onRemoveCustom(c.key)}>
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--slate)' }}>
        Rechen-kW = {pct(ASSUMPTIONS.computeHeadroomPct)}% des Netzanschlusses (nutzbare, flexible Last).
        Anschlusswerte sind <strong style={{ color: 'var(--ink)' }}>editierbar</strong> — anklicken und
        anpassen. Mit <strong style={{ color: 'var(--ink)' }}>„+ Projekt hinzufügen“</strong> tragen Sie
        eigene Flächen ein (Name, Status, Live ab, Anschluss). „Live ab“ = Jahr, ab dem die Fläche
        Rechenleistung tragen kann. Schätzungen, keine netzbestätigten Werte.
      </p>
    </section>
  );
}

// ── Inline-editable connection (kW) ──────────────────────────────────────────
function EditableKw({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <input
        className="b-kw-input"
        type="number"
        min={0}
        step={10}
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Math.max(0, Math.round(parseFloat(e.target.value) || 0)))}
        aria-label="Anschlussleistung in kW"
      />
      <span style={{ color: 'var(--slate)' }}>kW</span>
    </span>
  );
}

// ── Per-site drawer ──────────────────────────────────────────────────────────
function SiteDrawer({ site, hostRatio, onClose }: { site: Site; hostRatio: number; onClose: () => void }) {
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
              <Stat label="Ihr Anteil / Monat (Ergebnis)" value={ca(fmtEurFull(hostShareOf(site.monthlyRevenueEur, hostRatio)))} />
              <Stat label="Rechenumsatz brutto" value={ca(fmtEurFull(site.monthlyRevenueEur))} />
              <Stat label="Leistung" value={`${site.capacityKw} kW`} />
              <Stat label="Live ab" value={site.goLiveYear <= NOW_YEAR ? `seit ${site.goLiveYear}` : `${site.goLiveYear}`} />
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

// ── Reusable labelled slider ─────────────────────────────────────────────────
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  accent: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="b-kpi-label">{label}</span>
        <span className="board-display text-sm" style={{ color: 'var(--navy)' }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: accent }}
        aria-label={label}
      />
    </div>
  );
}

// ── Map preview popup (high-level info before adding) ────────────────────────
function PortfolioPreview({
  cand,
  hostRatio,
  added,
  onToggle,
  onClose,
}: {
  cand: Candidate;
  hostRatio: number;
  added: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const host = hostShareOf(cand.grossEur, hostRatio);
  return (
    <div className="b-modal">
      <div className="scrim" onClick={onClose} />
      <div className="b-card b-card-pad reveal" style={{ position: 'relative', zIndex: 51, width: 'min(440px, 96vw)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="board-display text-xl" style={{ color: 'var(--navy)' }}>{cand.name || 'Neues Projekt'}</div>
            <div className="text-sm" style={{ color: 'var(--slate)' }}>{[cand.ort, cand.typ].filter(Boolean).join(' · ')}</div>
          </div>
          <span
            className="stage"
            style={{
              background: cand.built ? 'rgba(0,26,69,.1)' : 'rgba(124,117,104,.14)',
              color: cand.built ? 'var(--navy)' : 'var(--slate)',
            }}
          >
            {cand.status}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Netzanschluss" value={`${fmtNum(cand.connectionKw)} kW`} />
          <Stat label={`Rechen-kW (${pct(ASSUMPTIONS.computeHeadroomPct)}%)`} value={`${fmtNum(cand.computeKw)} kW`} />
          <Stat label="Rechenumsatz brutto" value={`${ca(fmtEurFull(cand.grossEur))}/Mt`} />
          <Stat label="Ihr Anteil (Ergebnis)" value={`${ca(fmtEurFull(host))}/Mt`} />
        </div>
        <div className="mt-3 text-xs" style={{ color: 'var(--slate)' }}>
          Live ab <strong style={{ color: 'var(--ink)' }}>{cand.goLive <= NOW_YEAR ? `${cand.goLive} (aktiv)` : cand.goLive}</strong>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="b-btn-ghost" onClick={onClose}>Schließen</button>
          <button
            className={added ? 'b-btn-ghost' : 'b-btn-primary'}
            onClick={() => {
              onToggle();
              onClose();
            }}
          >
            {added ? '✓ Aus Flotte entfernen' : '+ Zur Flotte hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Live orchestration (Cumulus tab) — the real, running servers ─────────────
function LiveOrchestration({
  nodes,
  liveNodes,
  liveJobs,
  liveLeases,
}: {
  nodes: NodeSummary[];
  liveNodes: number;
  liveJobs: number;
  liveLeases: number;
}) {
  return (
    <section className="reveal mb-6" style={{ '--d': '480ms' } as React.CSSProperties}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="board-display text-lg" style={{ color: 'var(--navy)' }}>
          Live-Orchestrierung
        </h2>
        <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--slate)' }}>
          <span className="live-dot" /> läuft jetzt · {liveNodes}/{nodes.length} Knoten · {liveJobs} Anfragen
          {liveLeases ? ` · ${liveLeases} Leases` : ''}
        </span>
      </div>
      <div className="b-card b-card-pad">
        <p className="mb-3 text-sm leading-relaxed" style={{ color: 'var(--slate)' }}>
          Die Software ist <strong style={{ color: 'var(--ink)' }}>real und in Betrieb</strong> — Cumulus
          registriert Knoten, verteilt Anfragen lastabhängig und standortnah und führt Ergebnisse
          zusammen. Diese {nodes.length} Knoten beweisen den Betrieb; die Entwickler-Portfolios skalieren ihn.
        </p>
        <table className="b-table w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th className="text-left">Knoten</th>
              <th className="text-left">Standort</th>
              <th className="text-left">Status</th>
              <th className="text-right">CPU-Last</th>
              <th className="text-right">Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td className="board-display" style={{ color: 'var(--navy)' }}>{n.name}</td>
                <td style={{ color: 'var(--slate)' }}>{n.location?.city ?? '—'}</td>
                <td>
                  <span
                    className="stage"
                    style={{
                      background: n.status === 'online' ? 'rgba(0,26,69,.1)' : 'rgba(124,117,104,.14)',
                      color: n.status === 'online' ? 'var(--navy)' : 'var(--slate)',
                    }}
                  >
                    {n.status}
                  </span>
                </td>
                <td className="text-right tabular-nums">
                  {n.latestMetrics?.cpuUsagePct != null ? `${n.latestMetrics.cpuUsagePct}%` : '—'}
                </td>
                <td className="text-right" style={{ color: 'var(--slate)' }}>{timeAgo(n.lastHeartbeatAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
