'use client';
import { useState } from 'react';
import type {
  FleetAllocation,
  AllocationNode,
  LeaseView,
  ActiveJobAllocation,
  Customer,
} from '@cumulus/shared-types';
import { usePoll, statusClass } from '@/lib/ui';

/** Human "expires in" for a future timestamp (timeAgo is for the past). */
function expiresIn(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'expired';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function cardsLabel(gpuIndices: number[]): string {
  return gpuIndices.length > 0 ? `cards [${gpuIndices.join(', ')}]` : 'whole node';
}

function custLabel(name?: string, id?: string): string {
  return name ?? id ?? 'internal';
}

/** GPU summary if the node has cards, else a CPU summary. */
function HardwareCell({ n }: { n: AllocationNode }): React.ReactElement {
  if (n.gpuCount && n.gpuCount > 0) {
    const model = n.gpuModels?.[0] ?? 'GPU';
    const vram = n.gpuVramGb?.[0];
    const tp = n.tpGroups?.length
      ? n.tpGroups.map((g) => `[${g.join(',')}]`).join(' ')
      : null;
    return (
      <div>
        <div className="font-medium">
          {n.gpuCount}× {model}
          {vram ? ` · ${vram}GB` : ''}
        </div>
        <div className="text-xs text-muted">
          {tp ? `NVLink TP ${tp}` : 'single-card'}
          {n.executors?.includes('gpu') ? ' · gpu' : ''}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-medium">
        {n.cpuCores ?? '?'} vCPU · {n.ramGb ?? '?'}GB
      </div>
      <div className="text-xs text-muted">no GPU</div>
    </div>
  );
}

function LeaseBadge({
  lease,
  onRelease,
  releasing,
}: {
  lease: LeaseView;
  onRelease: (id: string) => void;
  releasing: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="pill bg-amber-500/20 text-amber-300">🔒 leased</span>
      <span>
        <strong>{custLabel(lease.customerName, lease.customerId)}</strong>
        <span className="text-muted"> · {cardsLabel(lease.gpuIndices)} · exp {expiresIn(lease.expiresAt)}</span>
      </span>
      <button className="btn" disabled={releasing} onClick={() => onRelease(lease.id)}>
        {releasing ? 'releasing…' : 'release'}
      </button>
    </div>
  );
}

function JobLine({ job }: { job: ActiveJobAllocation }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="pill bg-sky-500/20 text-sky-300">▶ {job.status}</span>
      <span>
        <strong>{custLabel(job.customerName, job.customerId)}</strong>
        <span className="text-muted">
          {' · '}
          {job.model ?? job.workloadType}
          {job.model ? ` (${job.workloadType})` : ''}
        </span>
      </span>
    </div>
  );
}

export default function AllocationPage(): React.ReactElement {
  const { data, error } = usePoll<FleetAllocation>('/api/allocation', 3000);
  const { data: customers } = usePoll<Customer[]>('/api/customers', 10000);
  const [pivot, setPivot] = useState<'node' | 'customer'>('node');
  const [form, setForm] = useState({ nodeId: '', customerId: '', amount: 1, unit: 'hours' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);

  const nodes = data?.nodes ?? [];
  const leases = data?.leases ?? [];
  const jobs = data?.jobs ?? [];
  const leasedNodeIds = new Set(leases.map((l) => l.nodeId));
  const leasableNodes = nodes.filter((n) => n.status === 'online' && !leasedNodeIds.has(n.id));

  const release = async (id: string): Promise<void> => {
    setReleasing(id);
    await fetch(`/api/leases/${id}/release`, { method: 'POST' });
    setReleasing(null);
  };

  const create = async (): Promise<void> => {
    if (!form.nodeId || !form.customerId) return;
    setBusy(true);
    setFormError(null);
    const durationSeconds = form.amount * (form.unit === 'days' ? 86400 : 3600);
    try {
      const res = await fetch('/api/leases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: form.nodeId, customerId: form.customerId, durationSeconds }),
      });
      const json = await res.json();
      if (!res.ok) setFormError(json.error ?? `HTTP ${res.status}`);
      else setForm((f) => ({ ...f, nodeId: '' }));
    } catch (err) {
      setFormError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Allocation</h1>
          <p className="text-sm text-muted">
            Who is on which hardware for which model — Model A leases (🔒) and live Model B
            inference (▶), across one fleet.
          </p>
        </div>
        <span className="text-sm text-muted">
          {data ? `${nodes.length} nodes · ${leases.length} leased · ${jobs.length} live` : 'loading…'}
        </span>
      </div>
      {error && <p className="card text-red-300">Control plane unreachable: {error}</p>}

      {/* New lease (Model A) */}
      <div className="card space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex-1 min-w-[180px]">
            <span className="mb-1 block text-sm text-muted">Lease a node (Model A)</span>
            <select
              value={form.nodeId}
              onChange={(e) => setForm((f) => ({ ...f, nodeId: e.target.value }))}
              className="w-full rounded border border-edge bg-ink px-3 py-2 text-sm"
            >
              <option value="">select an idle node…</option>
              {leasableNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} {n.gpuCount ? `(${n.gpuCount}× GPU)` : '(CPU)'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[180px]">
            <span className="mb-1 block text-sm text-muted">Customer</span>
            <select
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
              className="w-full rounded border border-edge bg-ink px-3 py-2 text-sm"
            >
              <option value="">select a customer…</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm text-muted">Duration</span>
            <div className="flex gap-1">
              <input
                type="number"
                min={1}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: Math.max(1, Number(e.target.value)) }))}
                className="w-20 rounded border border-edge bg-ink px-3 py-2 text-sm"
              />
              <select
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="rounded border border-edge bg-ink px-2 py-2 text-sm"
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          </label>
          <button className="btn" disabled={busy || !form.nodeId || !form.customerId} onClick={create}>
            {busy ? 'creating…' : 'Create lease'}
          </button>
        </div>
        {formError && <p className="text-sm text-red-300">{formError}</p>}
      </div>

      {/* Pivot toggle */}
      <div className="flex gap-1">
        {(['node', 'customer'] as const).map((p) => (
          <button
            key={p}
            className={`btn ${pivot === p ? 'bg-edge' : ''}`}
            onClick={() => setPivot(p)}
          >
            By {p}
          </button>
        ))}
      </div>

      {pivot === 'node' ? (
        <div className="card overflow-x-auto p-0">
          <table className="tabular w-full text-sm">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th>Hardware</th>
                <th>Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const lease = leases.find((l) => l.nodeId === n.id);
                const nodeJobs = jobs.filter((j) => j.nodeId === n.id);
                return (
                  <tr key={n.id}>
                    <td className="align-top font-medium">
                      {n.name}
                      <div className="text-xs text-muted">{n.city ?? '—'}</div>
                    </td>
                    <td className="align-top">
                      <span className={`pill ${statusClass(n.status)}`}>{n.status}</span>
                    </td>
                    <td className="align-top">
                      <HardwareCell n={n} />
                    </td>
                    <td className="align-top">
                      {!lease && nodeJobs.length === 0 ? (
                        <span className="text-muted">— idle —</span>
                      ) : (
                        <div className="space-y-1">
                          {lease && (
                            <LeaseBadge lease={lease} onRelease={release} releasing={releasing === lease.id} />
                          )}
                          {nodeJobs.map((j) => (
                            <JobLine key={j.attemptId} job={j} />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data && nodes.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted">
                    No nodes registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <ByCustomer
          nodes={nodes}
          leases={leases}
          jobs={jobs}
          onRelease={release}
          releasing={releasing}
        />
      )}
    </main>
  );
}

function ByCustomer({
  nodes,
  leases,
  jobs,
  onRelease,
  releasing,
}: {
  nodes: AllocationNode[];
  leases: LeaseView[];
  jobs: ActiveJobAllocation[];
  onRelease: (id: string) => void;
  releasing: string | null;
}): React.ReactElement {
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));

  // Group leases + jobs by customer (keyed by id, falling back to 'internal').
  const groups = new Map<string, { label: string; leases: LeaseView[]; jobs: ActiveJobAllocation[] }>();
  const bucket = (id: string | undefined, label: string) => {
    const key = id ?? 'internal';
    if (!groups.has(key)) groups.set(key, { label, leases: [], jobs: [] });
    return groups.get(key)!;
  };
  for (const l of leases) bucket(l.customerId, custLabel(l.customerName, l.customerId)).leases.push(l);
  for (const j of jobs) bucket(j.customerId, custLabel(j.customerName, j.customerId)).jobs.push(j);

  const leasedOrBusy = new Set([...leases.map((l) => l.nodeId), ...jobs.map((j) => j.nodeId)]);
  const idle = nodes.filter((n) => !leasedOrBusy.has(n.id));

  if (groups.size === 0) {
    return (
      <div className="card text-muted">
        Nothing allocated right now. Create a lease above, or submit hosted inference to see live jobs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([key, g]) => (
        <div key={key} className="card space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{g.label}</h2>
            {g.leases.length > 0 && <span className="pill bg-amber-500/20 text-amber-300">Model A</span>}
            {g.jobs.length > 0 && <span className="pill bg-sky-500/20 text-sky-300">Model B</span>}
          </div>
          <div className="space-y-1 text-sm">
            {g.leases.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="pill bg-amber-500/20 text-amber-300">🔒</span>
                <span>
                  {nodeName.get(l.nodeId) ?? l.nodeId}
                  <span className="text-muted"> · {cardsLabel(l.gpuIndices)} · exp {expiresIn(l.expiresAt)}</span>
                </span>
                <button className="btn" disabled={releasing === l.id} onClick={() => onRelease(l.id)}>
                  {releasing === l.id ? 'releasing…' : 'release'}
                </button>
              </div>
            ))}
            {g.jobs.map((j) => (
              <div key={j.attemptId} className="flex items-center gap-2">
                <span className="pill bg-sky-500/20 text-sky-300">▶</span>
                <span>
                  {j.model ?? j.workloadType}
                  {j.model ? <span className="text-muted"> ({j.workloadType})</span> : null}
                  <span className="text-muted"> on {nodeName.get(j.nodeId) ?? j.nodeId}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {idle.length > 0 && (
        <p className="text-sm text-muted">
          Idle: {idle.map((n) => n.name).join(', ')}
        </p>
      )}
    </div>
  );
}
