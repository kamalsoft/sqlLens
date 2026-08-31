import { NextResponse } from 'next/server';
import db from '@/db';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (!token) return NextResponse.json({ audits: [] });

    const session = db.prepare('SELECT id FROM sessions WHERE token = ? AND is_active = 1').get(token) as any;
    if (!session) return NextResponse.json({ audits: [] });

    const audits = db.prepare(`
      SELECT id, type, created_at, shared_token
      FROM audit_requests
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(session.id);

    return NextResponse.json({ audits });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
