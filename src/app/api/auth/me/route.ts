import { NextResponse } from 'next/server';
import db from '@/db';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    const session = db.prepare(`
      SELECT s.*, u.username 
      FROM sessions s 
      JOIN users u ON s.user_id = u.id 
      WHERE s.token = ? AND s.is_active = 1
    `).get(token) as any;

    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    // Update last_accessed_at
    db.prepare('UPDATE sessions SET last_accessed_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);

    return NextResponse.json({ 
      authenticated: true, 
      user: { id: session.user_id, username: session.username } 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
