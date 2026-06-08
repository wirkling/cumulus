import { NextResponse } from 'next/server';
import { operatorPost } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Create a Model-A device lease. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    return NextResponse.json(await operatorPost('/api/operator/leases', body), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
