import { NextResponse } from 'next/server';
import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password } = body;

    // Simulate login - in real app, hash password and verify
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!user) {
      // Create user if they don't exist for simulation
      const userId = uuidv4();
      db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, username, 'simulated_hash');
      user = { id: userId, username };
    }

    // Create session
    const sessionId = uuidv4();
    const token = uuidv4();
    
    db.prepare('INSERT INTO sessions (id, user_id, token, is_active) VALUES (?, ?, ?, 1)').run(sessionId, user.id, token);

    // Set cookie
    const cookieStore = await cookies();
    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });

    return NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
