import { NextResponse } from 'next/server';
import { operatorGet, operatorPost } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await operatorGet('/api/operator/customers'));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    // Returns the full API key exactly once.
    return NextResponse.json(await operatorPost('/api/operator/customers', body), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
