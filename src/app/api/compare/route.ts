import { NextResponse } from 'next/server';
import db from '@/db';
import { compareStoredProcedures } from '@/lib/ai-transformer';
import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    const body = await req.json();
    const { original, optimized } = body as { original: string; optimized: string };

    if (!original?.trim() || !optimized?.trim()) {
      return NextResponse.json({ error: 'Both original and optimized stored procedures are required' }, { status: 400 });
    }

    let sessionId = 'anonymous';
    if (token) {
      const session = db.prepare('SELECT id FROM sessions WHERE token = ? AND is_active = 1').get(token) as any;
      if (session) sessionId = session.id;
    }

    const result = await compareStoredProcedures(original, optimized);

    const auditId = uuidv4();
    const sharedToken = uuidv4();

    if (sessionId === 'anonymous') {
      const anonExists = db.prepare("SELECT id FROM sessions WHERE id = 'anonymous'").get();
      if (!anonExists) {
        const anonUserId = 'anonymous-user';
        const anonUserExists = db.prepare("SELECT id FROM users WHERE id = ?").get(anonUserId);
        if (!anonUserExists) {
          db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(anonUserId, 'anonymous', 'n/a');
        }
        db.prepare("INSERT INTO sessions (id, user_id, token, is_active) VALUES ('anonymous', ?, 'anonymous', 1)").run(anonUserId);
      }
    }

    db.prepare(`
      INSERT INTO audit_requests (id, session_id, type, request_payload, response_payload, shared_token)
      VALUES (?, ?, 'COMPARE', ?, ?, ?)
    `).run(auditId, sessionId, JSON.stringify({ original, optimized }), JSON.stringify(result), sharedToken);

    return NextResponse.json({ id: auditId, sharedToken, result });
  } catch (error: any) {
    console.error('[compare/route]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
