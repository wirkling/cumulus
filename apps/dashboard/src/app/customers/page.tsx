'use client';
import { useState } from 'react';
import type { Customer, CustomerWithKey } from '@cumulus/shared-types';
import { usePoll, timeAgo } from '@/lib/ui';

export default function CustomersPage() {
  const { data } = usePoll<Customer[]>('/api/customers', 5000);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<CustomerWithKey | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as CustomerWithKey;
      if (json.apiKey) setNewKey(json);
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Customers</h1>
        <p className="text-sm text-muted">
          The product front door. Each customer gets an API key to submit jobs against the
          public <code>/v1</code> API — the way a real user connects to the pool.
        </p>
      </div>

      <div className="card flex items-end gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-sm text-muted">New customer name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-edge bg-ink px-3 py-2 text-sm"
            placeholder="e.g. Acme Transcription"
          />
        </label>
        <button className="btn" disabled={busy} onClick={create}>
          {busy ? 'creating…' : 'Create API key'}
        </button>
      </div>

      {newKey && (
        <div className="card border-emerald-700/50">
          <p className="mb-2 text-sm text-emerald-300">
            API key for <strong>{newKey.name}</strong> — copy it now, it won&apos;t be shown again:
          </p>
          <code className="block break-all rounded bg-ink p-3 text-sm text-emerald-200">
            {newKey.apiKey}
          </code>
          <p className="mt-3 text-xs text-muted">Connect as this customer:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-ink p-3 text-xs text-gray-300">{`CUMULUS_API_URL=<api-url> CUMULUS_API_KEY=${newKey.apiKey} \\
  pnpm --filter @cumulus/client fake-user 6`}</pre>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="tabular w-full text-sm">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key prefix</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="font-mono text-muted">{c.keyPrefix}…</td>
                <td>{c.status}</td>
                <td className="text-muted">{timeAgo(c.createdAt)}</td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  No customers yet — create one to mint an API key.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
