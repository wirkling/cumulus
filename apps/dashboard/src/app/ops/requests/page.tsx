'use client';
import Link from 'next/link';
import type { Request as JobRequest } from '@cumulus/shared-types';
import { usePoll, statusClass, timeAgo } from '@/lib/ui';

export default function RequestsPage() {
  const { data, error } = usePoll<JobRequest[]>('/api/requests', 2000);
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Requests</h1>
      {error && <p className="card mb-4 text-red-300">{error}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="tabular w-full text-sm">
          <thead>
            <tr>
              <th>Workload</th>
              <th>Status</th>
              <th>Fan-out</th>
              <th>Origin</th>
              <th>Policy</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.workloadType}</td>
                <td>
                  <span className={`pill ${statusClass(r.status)}`}>{r.status}</span>
                </td>
                <td>{r.fanOut}</td>
                <td>{r.originLocation?.label ?? '—'}</td>
                <td className="text-muted">{r.completionPolicy}</td>
                <td className="text-muted">{timeAgo(r.createdAt)}</td>
                <td>
                  <Link className="btn" href={`/ops/requests/${r.id}`}>
                    view
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted">
                  No requests yet. <Link className="underline" href="/ops/submit">Submit one →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
