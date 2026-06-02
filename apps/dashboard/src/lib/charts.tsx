'use client';
/**
 * Dependency-free, themed SVG charts. Responsive via viewBox (width: 100%).
 * Kept intentionally small + legible — business-facing, no chart-lib bloat.
 */
import { Fragment } from 'react';

export const PALETTE = [
  '#34d399', // emerald
  '#60a5fa', // blue
  '#f59e0b', // amber
  '#a78bfa', // violet
  '#f472b6', // pink
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#a3e635', // lime
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

interface Series {
  key: string;
  label: string;
  color?: string;
}
interface Group {
  label: string;
  values: Record<string, number | undefined>;
}

/** Grouped vertical bars: x = groups (e.g. use cases), one bar per series (e.g. runs). */
export function GroupedBars({
  groups,
  series,
  unit = '',
  height = 240,
  target,
  targetLabel = 'target',
}: {
  groups: Group[];
  series: Series[];
  unit?: string;
  height?: number;
  /** Optional horizontal reference line (e.g. an SLO). */
  target?: number;
  targetLabel?: string;
}) {
  const W = 760;
  const H = height;
  const padL = 46;
  const padB = 54;
  const padT = 12;
  const padR = 12;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = niceMax(
    Math.max(1, target ?? 0, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))),
  );
  const gw = plotW / Math.max(1, groups.length);
  const barW = (gw * 0.72) / Math.max(1, series.length);
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <div className="w-full overflow-x-auto">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {/* y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <Fragment key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="#1e2533" strokeWidth={1} />
            <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" fontSize={10} fill="#8b96a8">
              {Math.round(max * t)}
            </text>
          </Fragment>
        ))}
        {groups.map((g, gi) => {
          const x0 = padL + gi * gw + (gw - barW * series.length) / 2;
          return (
            <Fragment key={g.label}>
              {series.map((s, si) => {
                const v = g.values[s.key] ?? 0;
                const bx = x0 + si * barW;
                return (
                  <rect
                    key={s.key}
                    x={bx}
                    y={y(v)}
                    width={Math.max(1, barW - 2)}
                    height={Math.max(0, padT + plotH - y(v))}
                    fill={s.color ?? PALETTE[si % PALETTE.length]}
                    rx={1.5}
                  >
                    <title>{`${g.label} · ${s.label}: ${v}${unit}`}</title>
                  </rect>
                );
              })}
              <text x={padL + gi * gw + gw / 2} y={H - padB + 16} textAnchor="middle" fontSize={11} fill="#c9d1dc">
                {g.label}
              </text>
            </Fragment>
          );
        })}
        {target != null && target <= max && (
          <>
            <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#f87171" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize={10} fill="#f87171">
              {targetLabel} {target}{unit}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/** Single-series horizontal bars (e.g. reliability %, economics per run). */
export function HBars({
  rows,
  unit = '',
  max: maxOverride,
  target,
  higherIsBetter = true,
}: {
  rows: { label: string; value: number; color?: string }[];
  unit?: string;
  max?: number;
  /** When set, bars are coloured by pass(green)/near(amber)/fail(red) vs target. */
  target?: number;
  higherIsBetter?: boolean;
}) {
  const max = maxOverride ?? niceMax(Math.max(1, target ?? 0, ...rows.map((r) => r.value)));
  const colorFor = (v: number, fallback: string): string => {
    if (target == null) return fallback;
    const pass = higherIsBetter ? v >= target : v <= target;
    const near = higherIsBetter ? v >= target * 0.8 : v <= target * 1.25;
    return pass ? '#34d399' : near ? '#f59e0b' : '#f87171';
  };
  return (
    <div className="space-y-1.5">
      {target != null && (
        <div className="text-xs text-muted">
          target {higherIsBetter ? '≥' : '≤'} {target}{unit}
        </div>
      )}
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-40 shrink-0 truncate text-muted" title={r.label}>
            {r.label}
          </span>
          <div className="relative h-3 flex-1 overflow-hidden rounded bg-edge">
            <div
              className="h-full rounded"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: colorFor(r.value, r.color ?? PALETTE[i % PALETTE.length]) }}
            />
            {target != null && target <= max && (
              <span
                className="absolute top-0 h-full border-l border-dashed border-red-400"
                style={{ left: `${(target / max) * 100}%` }}
              />
            )}
          </div>
          <span className="w-20 shrink-0 text-right tabular-nums">
            {r.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Single horizontal stacked bar — per-node job distribution. */
export function StackedBar({ segments }: { segments: { label: string; value: number }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded bg-edge">
        {segments.map((s, i) => (
          <div
            key={s.label}
            className="h-full"
            style={{ width: `${(s.value / total) * 100}%`, background: PALETTE[i % PALETTE.length] }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
        {segments.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            {s.label}: {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Trend line — a metric across ordered runs (e.g. p95 over time / generations). */
export function TrendLine({
  points,
  unit = '',
  height = 200,
  target,
}: {
  points: { label: string; value: number }[];
  unit?: string;
  height?: number;
  target?: number;
}) {
  const W = 760;
  const H = height;
  const padL = 46;
  const padB = 48;
  const padT = 12;
  const padR = 12;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = niceMax(Math.max(1, target ?? 0, ...points.map((p) => p.value)));
  const x = (i: number) => padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {[0, 0.5, 1].map((t) => (
          <Fragment key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="#1e2533" />
            <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" fontSize={10} fill="#8b96a8">
              {Math.round(max * t)}
            </text>
          </Fragment>
        ))}
        {target != null && target <= max && (
          <>
            <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#f87171" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize={10} fill="#f87171">
              SLO {target}{unit}
            </text>
          </>
        )}
        <path d={path} fill="none" stroke="#34d399" strokeWidth={2} />
        {points.map((p, i) => (
          <Fragment key={p.label}>
            <circle cx={x(i)} cy={y(p.value)} r={3} fill="#34d399">
              <title>{`${p.label}: ${p.value}${unit}`}</title>
            </circle>
            <text x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="#c9d1dc">
              {p.label}
            </text>
          </Fragment>
        ))}
      </svg>
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
