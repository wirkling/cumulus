import { NextResponse } from 'next/server';
import { operatorPost } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Release (end) an active Model-A device lease. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    return NextResponse.json(await operatorPost(`/api/operator/leases/${id}/release`));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
