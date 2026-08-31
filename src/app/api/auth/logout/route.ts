import { NextResponse } from 'next/server';
import db from '@/db';
import { cookies } from 'next/headers';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (token) {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE token = ?').run(token);
      cookieStore.delete('session_token');
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
