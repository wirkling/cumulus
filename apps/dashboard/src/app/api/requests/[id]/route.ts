import { NextResponse } from 'next/server';
import { callerGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    return NextResponse.json(await callerGet(`/api/requests/${id}`));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
