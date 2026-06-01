'use client';
import { usePoll } from '@/lib/ui';

interface Row {
  id: string;
  name: string;
  city: string | null;
  cpuScore: number | null;
  networkMs: number | null;
}

function Bar({ value, max, invert }: { value: number | null; max: number; invert?: boolean }) {
  if (value == null) return <span className="text-muted">—</span>;
  // For latency (invert), shorter is better → fuller bar for smaller value.
  const pct = max > 0 ? Math.max(4, Math.round(((invert ? max - value : value) / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded bg-edge">
        <div className={`h-full ${invert ? 'bg-sky-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs">{value}</span>
    </div>
  );
}

export default function BenchmarksPage() {
  const { data, error } = usePoll<Row[]>('/api/benchmarks', 4000);
  const rows = data ?? [];
  const maxCpu = Math.max(1, ...rows.map((r) => r.cpuScore ?? 0));
  const maxNet = Math.max(1, ...rows.map((r) => r.networkMs ?? 0));

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold">Benchmarks</h1>
      <p className="mb-4 text-sm text-muted">
        Comparable across heterogeneous nodes. CPU = ops/sec (higher better); network = latency to
        control plane in ms (lower better).
      </p>
      {error && <p className="card mb-4 text-red-300">{error}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="tabular w-full text-sm">
          <thead>
            <tr>
              <th>Node</th>
              <th>Location</th>
              <th>CPU (ops/sec)</th>
              <th>Network latency (ms)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>{r.city ?? '—'}</td>
                <td>
                  <Bar value={r.cpuScore} max={maxCpu} />
                </td>
                <td>
                  <Bar value={r.networkMs} max={maxNet} invert />
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted">
                  No benchmark data yet — nodes submit CPU + network benchmarks on startup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
