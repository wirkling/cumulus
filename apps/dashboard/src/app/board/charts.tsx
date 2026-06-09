'use client';
/**
 * Light, paper-themed SVG charts for the board view. Dependency-free, tuned to
 * the ivory/ink/pine aesthetic (the operator charts are hardcoded dark).
 */
import { useId } from 'react';

function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0]![0]} ${pts[0]![1]}` : '';
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Smooth area chart, optionally with a second (lower) series — e.g. grid vs total power. */
export function Area({
  data,
  data2,
  color = 'var(--navy)',
  color2 = 'var(--gold)',
  height = 150,
  unit = '',
  fmt = (v: number) => `${Math.round(v)}${unit}`,
}: {
  data: number[];
  data2?: number[];
  color?: string;
  color2?: string;
  height?: number;
  unit?: string;
  fmt?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, '');
  const W = 520;
  const H = height;
  const pad = { l: 8, r: 8, t: 14, b: 16 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const all = data2 ? [...data, ...data2] : data;
  const max = Math.max(1, ...all) * 1.12;
  const min = Math.min(0, ...all);
  const xAt = (i: number, n: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => pad.t + plotH - ((v - min) / (max - min)) * plotH;
  const toPts = (d: number[]): [number, number][] => d.map((v, i) => [xAt(i, d.length), yAt(v)]);

  const pts = toPts(data);
  const line = smooth(pts);
  const area = `${line} L ${pad.l + plotW} ${pad.t + plotH} L ${pad.l} ${pad.t + plotH} Z`;
  const last = pts[pts.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={pad.l} x2={W - pad.r} y1={pad.t + plotH * t} y2={pad.t + plotH * t} stroke="var(--line)" strokeWidth={1} strokeDasharray="2 4" />
      ))}
      {data2 && (
        <path d={smooth(toPts(data2))} fill="none" stroke={color2} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85} />
      )}
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--paper)" stroke={color} strokeWidth={2.25} />
      <text x={W - pad.r} y={pad.t - 2} textAnchor="end" fontSize={11} fontWeight={600} fill={color}>
        {fmt(data[data.length - 1] ?? 0)}
      </text>
    </svg>
  );
}

/** Revenue-over-time area chart with a year axis and a "heute" marker. The
 * curve ramps softly as each site comes online, so steps read as real growth. */
export function GrowthChart({
  data,
  nowIndex,
  startYear = 2024,
  color = 'var(--navy)',
  height = 150,
  fmt = (v: number) => `${Math.round(v)}`,
}: {
  data: number[];
  nowIndex: number;
  startYear?: number;
  color?: string;
  height?: number;
  fmt?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, '');
  const W = 520;
  const H = height;
  const pad = { l: 8, r: 8, t: 16, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = Math.max(1, ...data) * 1.14;
  const xAt = (i: number) => pad.l + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => pad.t + plotH - (v / max) * plotH;
  const pts: [number, number][] = data.map((v, i) => [xAt(i), yAt(v)]);
  const line = smooth(pts);
  const area = `${line} L ${pad.l + plotW} ${pad.t + plotH} L ${pad.l} ${pad.t + plotH} Z`;
  const last = pts[pts.length - 1] ?? [pad.l + plotW, yAt(0)];
  const ni = Math.max(0, Math.min(data.length - 1, nowIndex));
  const nowX = xAt(ni);
  const nowPt = pts[ni] ?? last;
  const yearTicks: number[] = [];
  for (let i = 0; i < data.length; i += 12) yearTicks.push(i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={`gg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH * 0.5} y2={pad.t + plotH * 0.5} stroke="var(--line)" strokeWidth={1} strokeDasharray="2 4" />
      <line x1={nowX} x2={nowX} y1={pad.t} y2={pad.t + plotH} stroke="var(--slate)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
      <text x={nowX} y={pad.t - 4} textAnchor="middle" fontSize={9} fill="var(--slate)">heute</text>
      <path d={area} fill={`url(#gg${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" />
      <circle cx={nowPt[0]} cy={nowPt[1]} r={3} fill="var(--paper)" stroke="var(--slate)" strokeWidth={1.5} />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--paper)" stroke={color} strokeWidth={2.25} />
      {yearTicks.map((i) => (
        <text key={i} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--slate)">
          {startYear + i / 12}
        </text>
      ))}
      <text x={W - pad.r} y={pad.t - 4} textAnchor="end" fontSize={11} fontWeight={600} fill={color}>
        {fmt(data[data.length - 1] ?? 0)}
      </text>
    </svg>
  );
}

/** Tiny inline sparkline. */
export function Spark({ data, color = 'var(--navy)', width = 96, height = 28 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(1, ...data);
  const min = Math.min(...data);
  const pts: [number, number][] = data.map((v, i) => [
    (i / Math.max(1, data.length - 1)) * width,
    height - 2 - ((v - min) / Math.max(1e-6, max - min)) * (height - 4),
  ]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" className="overflow-visible">
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.4} fill={color} />
    </svg>
  );
}

/** Radial utilization gauge (0–100). */
export function Gauge({ value, label, size = 132 }: { value: number; label?: string; size?: number }) {
  const r = size / 2 - 12;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  // warm at high utilization, cool at low — a heat read.
  const color = value >= 75 ? 'var(--gold)' : value >= 45 ? 'var(--navy)' : 'var(--slate)';
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={9} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
        <text x={c} y={c - 2} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--ink)" className="board-display">
          {Math.round(value)}
          <tspan fontSize={13} fill="var(--slate)">%</tspan>
        </text>
        {label && (
          <text x={c} y={c + 18} textAnchor="middle" fontSize={10} fill="var(--slate)" letterSpacing={0.5}>
            {label.toUpperCase()}
          </text>
        )}
      </svg>
    </div>
  );
}

/** Small ramp of bars (e.g. 6-month MRR trend). */
export function Ramp({ data, color = 'var(--navy)', height = 56 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all"
          style={{
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: i === data.length - 1 ? color : 'color-mix(in srgb, var(--navy) 32%, transparent)',
          }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}
