'use client';
/**
 * SVG fallback map (used when no Mapbox token). Real live nodes + the TAMAX
 * portfolio as clickable candidates (click toggles add-to-fleet). Equirectangular
 * projection over a Berlin-Brandenburg-inclusive frame; no country border.
 */
import type { Site } from './mock';
import type { PortfolioSite } from './tamax-portfolio';

const BOUNDS = { latMin: 48.6, latMax: 54.0, lngMin: 10.3, lngMax: 15.2 };
const W = 520;
const H = 520;
const PAD = 44;
const plotW = W - PAD * 2;
const plotH = H - PAD * 2;

function project(lat: number, lng: number): [number, number] {
  const x = PAD + ((lng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin)) * plotW;
  const y = PAD + ((BOUNDS.latMax - lat) / (BOUNDS.latMax - BOUNDS.latMin)) * plotH;
  return [x, y];
}
function jitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 5 + ((h >> 9) % 6);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function Atlas({
  sites,
  portfolio,
  added,
  onPreview,
  selectedId,
  onSelect,
}: {
  sites: Site[];
  portfolio: PortfolioSite[];
  added: number[];
  onPreview: (id: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const addedSet = new Set(added);
  const lngTicks = [11, 12, 13, 14, 15];
  const latTicks = [49, 50, 51, 52, 53];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Standortkarte">
      {lngTicks.map((lng) => {
        const [x] = project(0, lng);
        return <line key={`v${lng}`} x1={x} y1={PAD} x2={x} y2={H - PAD} stroke="var(--line)" strokeWidth={1} />;
      })}
      {latTicks.map((lat) => {
        const [, y] = project(lat, 0);
        return <line key={`h${lat}`} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="var(--line)" strokeWidth={1} />;
      })}

      {/* TAMAX portfolio candidates */}
      {portfolio.map((p) => {
        const [x, y] = project(p.lat, p.lng);
        const on = addedSet.has(p.id);
        const r = 4 + Math.min(6, p.connectionKw / 250);
        return (
          <g key={`p${p.id}`} style={{ cursor: 'pointer' }} onClick={() => onPreview(p.id)}>
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={on ? 'var(--gold)' : 'var(--paper)'}
              stroke={on ? 'var(--gold)' : 'var(--navy)'}
              strokeWidth={1.4}
              strokeDasharray={on ? undefined : '2 2'}
              opacity={0.9}
            >
              <title>{`${p.name} — ${p.ort} · ${p.connectionKw} kW`}</title>
            </circle>
          </g>
        );
      })}

      {/* Live Cumulus nodes */}
      {sites.map((s) => {
        const [bx, by] = project(s.lat, s.lng);
        const [jx, jy] = jitter(s.id);
        const x = bx + jx;
        const y = by + jy;
        const sel = s.id === selectedId;
        return (
          <g key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }}>
            {s.online && <circle className="atlas-pulse" cx={x} cy={y} r={8} fill="var(--gold)" opacity={0.5} />}
            {sel && <circle cx={x} cy={y} r={13} fill="none" stroke="var(--gold)" strokeWidth={2} />}
            <circle cx={x} cy={y} r={7} fill={s.online ? 'var(--navy)' : 'var(--slate)'} stroke="var(--paper)" strokeWidth={2} />
            <text x={x + 11} y={y + 3} fontSize={10} fontWeight={600} fill="var(--navy)" className="board-display">{s.city}</text>
          </g>
        );
      })}

      <g transform={`translate(${PAD}, ${PAD - 20})`}>
        <circle cx={5} cy={0} r={5} fill="var(--navy)" />
        <text x={15} y={3} fontSize={10} fill="var(--ink)">Live-Knoten</text>
        <circle cx={108} cy={0} r={4.5} fill="var(--paper)" stroke="var(--navy)" strokeWidth={1.4} strokeDasharray="2 2" />
        <text x={118} y={3} fontSize={10} fill="var(--slate)">TAMAX-Portfolio (anklicken → zur Flotte)</text>
      </g>
    </svg>
  );
}
