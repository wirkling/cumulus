'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PRESET_ORIGINS, type WorkloadType, type CompletionPolicy } from '@cumulus/shared-types';

export default function SubmitPage() {
  const router = useRouter();
  const [workloadType, setWorkloadType] = useState<WorkloadType>('split_map_merge');
  const [fanOut, setFanOut] = useState(4);
  const [originIdx, setOriginIdx] = useState(0);
  const [policy, setPolicy] = useState<CompletionPolicy>('wait_for_all');
  const [quorum, setQuorum] = useState(2);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [itemCount, setItemCount] = useState(40);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const origin = PRESET_ORIGINS[originIdx]!;
    const input =
      workloadType === 'split_map_merge'
        ? { items: Array.from({ length: itemCount }, (_, i) => `item-${i}`) }
        : workloadType === 'echo_sleep'
          ? { ms: 600, echo: 'hello' }
          : { iterations: 20_000_000 };
    const body = {
      workloadType,
      fanOut,
      originLocation: { lat: origin.lat, lng: origin.lng, label: origin.label },
      completionPolicy: policy,
      quorum: policy === 'wait_for_quorum' ? quorum : undefined,
      onPartial: 'return_partial',
      timeoutSeconds,
      input,
    };
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.push(`/ops/requests/${json.id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <main className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">Submit request</h1>
      <div className="card space-y-4">
        <Field label="Workload">
          <select className="input" value={workloadType} onChange={(e) => setWorkloadType(e.target.value as WorkloadType)}>
            <option value="split_map_merge">split_map_merge (scatter/gather)</option>
            <option value="echo_sleep">echo_sleep</option>
            <option value="cpu_benchmark">cpu_benchmark</option>
          </select>
        </Field>

        <Field label="Origin location">
          <select className="input" value={originIdx} onChange={(e) => setOriginIdx(Number(e.target.value))}>
            {PRESET_ORIGINS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fan-out (child shards)">
          <input className="input" type="number" min={1} max={20} value={fanOut} onChange={(e) => setFanOut(Number(e.target.value))} />
        </Field>

        {workloadType === 'split_map_merge' && (
          <Field label="Item count">
            <input className="input" type="number" min={1} max={1000} value={itemCount} onChange={(e) => setItemCount(Number(e.target.value))} />
          </Field>
        )}

        <Field label="Completion policy">
          <select className="input" value={policy} onChange={(e) => setPolicy(e.target.value as CompletionPolicy)}>
            <option value="wait_for_all">wait_for_all</option>
            <option value="wait_for_quorum">wait_for_quorum</option>
          </select>
        </Field>

        {policy === 'wait_for_quorum' && (
          <Field label="Quorum (K of N)">
            <input className="input" type="number" min={1} max={fanOut} value={quorum} onChange={(e) => setQuorum(Number(e.target.value))} />
          </Field>
        )}

        <Field label="Timeout (seconds)">
          <input className="input" type="number" min={1} max={3600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} />
        </Field>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn w-full" disabled={busy} onClick={submit}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
      <style>{`.input{width:100%;background:#0b0e14;border:1px solid #1e2533;border-radius:6px;padding:8px 10px;font-size:14px}`}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}
