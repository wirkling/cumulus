import { NextResponse } from 'next/server';
import { operatorGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await operatorGet('/api/operator/allocation'));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
