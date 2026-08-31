import { NextResponse } from 'next/server';
import db from '@/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const audit = db.prepare('SELECT * FROM audit_requests WHERE shared_token = ?').get(token) as any;

    if (!audit) {
      return NextResponse.json({ error: 'Shared result not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: audit.id,
      type: audit.type,
      createdAt: audit.created_at,
      result: JSON.parse(audit.response_payload),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
