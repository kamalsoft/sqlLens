import { NextResponse } from 'next/server';
import db from '@/db';
import { analyzeStoredProcedure } from '@/lib/ai-transformer';
import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    const body = await req.json();
    const { storedProcedure } = body as { storedProcedure: string };

    if (!storedProcedure?.trim()) {
      return NextResponse.json({ error: 'storedProcedure is required' }, { status: 400 });
    }

    // Resolve session if available
    let sessionId = 'anonymous';
    if (token) {
      const session = db.prepare('SELECT id FROM sessions WHERE token = ? AND is_active = 1').get(token) as any;
      if (session) sessionId = session.id;
    }

    // Run AI analysis
    const result = await analyzeStoredProcedure(storedProcedure);

    // Persist to DB
    const auditId = uuidv4();
    const sharedToken = uuidv4();

    // Ensure anonymous session exists for unauthenticated use
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
      VALUES (?, ?, 'REVIEW', ?, ?, ?)
    `).run(auditId, sessionId, JSON.stringify({ storedProcedure }), JSON.stringify(result), sharedToken);

    return NextResponse.json({ id: auditId, sharedToken, result });
  } catch (error: any) {
    console.error('[review/route]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (id) {
      // Fetch specific audit by id
      const audit = db.prepare('SELECT * FROM audit_requests WHERE id = ?').get(id) as any;
      if (!audit) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ ...audit, result: JSON.parse(audit.response_payload) });
    }

    // Fetch all reviews for current session
    if (!token) return NextResponse.json({ audits: [] });
    const session = db.prepare('SELECT id FROM sessions WHERE token = ? AND is_active = 1').get(token) as any;
    if (!session) return NextResponse.json({ audits: [] });

    const audits = db.prepare(`
      SELECT id, type, created_at, shared_token FROM audit_requests 
      WHERE session_id = ? AND type = 'REVIEW' 
      ORDER BY created_at DESC LIMIT 50
    `).all(session.id);

    return NextResponse.json({ audits });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
