import { NextResponse } from 'next/server';
import { operatorPost } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['pause', 'drain', 'disable', 'benchmark']);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
): Promise<NextResponse> {
  const { id, action } = await params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  try {
    return NextResponse.json(await operatorPost(`/api/operator/nodes/${id}/${action}`));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
