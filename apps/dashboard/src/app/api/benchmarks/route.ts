import { NextResponse } from 'next/server';
import { operatorGet } from '@/lib/server-api';
import type { NodeDetail, NodeSummary } from '@cumulus/shared-types';

export const dynamic = 'force-dynamic';

/** Aggregate the latest CPU + network benchmark per node for the comparison view. */
export async function GET(): Promise<NextResponse> {
  try {
    const list = (await operatorGet('/api/operator/nodes')) as NodeSummary[];
    const details = await Promise.all(
      list.map((n) => operatorGet(`/api/operator/nodes/${n.id}`) as Promise<NodeDetail>),
    );
    const rows = details.map((d) => {
      const cpu = d.benchmarks.find((b) => b.benchmarkType === 'cpu' && b.status === 'completed');
      const net = d.benchmarks.find((b) => b.benchmarkType === 'network' && b.status === 'completed');
      return {
        id: d.id,
        name: d.name,
        city: d.location?.city ?? null,
        cpuScore: cpu?.score ?? null,
        networkMs: net?.score ?? null,
      };
    });
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
