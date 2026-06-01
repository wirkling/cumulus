import { NextResponse } from 'next/server';
import { operatorGet, callerPost } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await operatorGet('/api/operator/requests'));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    return NextResponse.json(await callerPost('/api/requests', body), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
