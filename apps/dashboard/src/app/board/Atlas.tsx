'use client';
/**
 * Infrastructure atlas — live compute sites + the Berlin-Brandenburg expansion
 * pipeline, plotted at real projected coordinates (equirectangular). No country
 * border (honest, no fake cartography): a blueprint graticule + coverage rings
 * carry the geography. Live sites are real nodes; candidates are TAMAX's region.
 */
import type { Site, PipelineSite } from './mock';

const BOUNDS = { latMin: 48.7, latMax: 53.6, lngMin: 10.3, lngMax: 15.2 };
const W = 520;
const H = 500;
const PAD = 46;
const plotW = W - PAD * 2;
const plotH = H - PAD * 2;

function project(lat: number, lng: number): [number, number] {
  const x = PAD + ((lng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin)) * plotW;
  const y = PAD + ((BOUNDS.latMax - lat) / (BOUNDS.latMax - BOUNDS.latMin)) * plotH;
  return [x, y];
}

/** Deterministic small offset so co-located sites (e.g. two nodes in the same
 * city) don't stack on exactly the same pixel. */
function jitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 9 + ((h >> 9) % 8);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function Atlas({
  sites,
  pipeline,
  selectedId,
  onSelect,
}: {
  sites: Site[];
  pipeline: PipelineSite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const live = sites.filter((s) => s.online);
  const cx = live.length ? live.reduce((a, s) => a + project(s.lat, s.lng)[0], 0) / live.length : W / 2;
  const cy = live.length ? live.reduce((a, s) => a + project(s.lat, s.lng)[1], 0) / live.length : H / 2;

  const lngTicks = [11, 12, 13, 14, 15];
  const latTicks = [49, 50, 51, 52, 53];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Compute site map">
      {/* graticule */}
      {lngTicks.map((lng) => {
        const [x] = project(0, lng);
        return (
          <g key={`v${lng}`}>
            <line x1={x} y1={PAD} x2={x} y2={H - PAD} stroke="var(--line)" strokeWidth={1} />
            <text x={x} y={H - PAD + 16} textAnchor="middle" fontSize={9} fill="var(--slate)">{lng}°E</text>
          </g>
        );
      })}
      {latTicks.map((lat) => {
        const [, y] = project(lat, 0);
        return (
          <g key={`h${lat}`}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD - 8} y={y + 3} textAnchor="end" fontSize={9} fill="var(--slate)">{lat}°N</text>
          </g>
        );
      })}

      {/* coverage rings around the live centroid */}
      {[70, 130, 200].map((r, i) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="var(--sand)" strokeWidth={1} strokeDasharray="2 5" opacity={0.5 - i * 0.12} />
      ))}

      {/* expansion arcs: candidate → live centroid */}
      {pipeline.map((p) => {
        const [px, py] = project(p.lat, p.lng);
        const mx = (px + cx) / 2;
        const my = (py + cy) / 2 - 24;
        return <path key={`arc${p.city}`} d={`M ${px} ${py} Q ${mx} ${my} ${cx} ${cy}`} fill="none" stroke="var(--sand)" strokeWidth={1} strokeDasharray="3 4" opacity={0.55} />;
      })}

      {/* pipeline candidate markers (hollow) */}
      {pipeline.map((p) => {
        const [x, y] = project(p.lat, p.lng);
        return (
          <g key={`p${p.city}`}>
            <circle cx={x} cy={y} r={5} fill="var(--paper)" stroke="var(--navy)" strokeWidth={1.5} strokeDasharray={p.stage === 'candidate' ? '2 2' : undefined} opacity={0.8} />
            <text x={x + 9} y={y + 3} fontSize={9.5} fontStyle="italic" fill="var(--slate)">{p.city}</text>
          </g>
        );
      })}

      {/* live sites (real nodes) */}
      {sites.map((s) => {
        const [bx, by] = project(s.lat, s.lng);
        const [jx, jy] = jitter(s.id);
        const x = bx + jx;
        const y = by + jy;
        const sel = s.id === selectedId;
        const rad = 6 + Math.min(6, s.capacityKw);
        const color = s.online ? 'var(--navy)' : 'var(--slate)';
        return (
          <g key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }}>
            {s.online && <circle className="atlas-pulse" cx={x} cy={y} r={rad} fill="var(--gold)" opacity={0.5} />}
            {sel && <circle cx={x} cy={y} r={rad + 7} fill="none" stroke="var(--gold)" strokeWidth={2} />}
            <circle className="atlas-dot" cx={x} cy={y} r={rad} fill={color} stroke="var(--paper)" strokeWidth={2} />
            {s.online && <circle cx={x} cy={y} r={rad * 0.4} fill="var(--gold)" />}
            <text x={x + rad + 5} y={y - 2} fontSize={11} fontWeight={600} fill="var(--navy)" className="board-display">{s.city}</text>
            <text x={x + rad + 5} y={y + 10} fontSize={9} fill="var(--slate)">{s.online ? `${s.utilizationPct}% · ${s.kind.toUpperCase()}` : 'offline'}</text>
          </g>
        );
      })}

      {/* legend */}
      <g transform={`translate(${PAD}, ${PAD - 22})`}>
        <circle cx={5} cy={0} r={5} fill="var(--navy)" />
        <text x={15} y={3} fontSize={10} fill="var(--ink)">Live site</text>
        <circle cx={92} cy={0} r={4.5} fill="var(--paper)" stroke="var(--navy)" strokeWidth={1.5} strokeDasharray="2 2" />
        <text x={102} y={3} fontSize={10} fill="var(--slate)">Pipeline (Berlin-Brandenburg)</text>
      </g>
    </svg>
  );
}
