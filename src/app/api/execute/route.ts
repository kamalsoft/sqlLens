import { NextResponse } from 'next/server';
import db from '@/db';
import { executeSP, DbConnectionConfig } from '@/lib/sp-executor';
import { analyzeExecution, compareExecutions } from '@/lib/audit-analyzer';
import { v4 as uuidv4 } from 'uuid';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    const body = await req.json();
    const {
      mode,          // 'single' | 'compare'
      originalSP,
      optimizedSP,
      connection,
    } = body as {
      mode: 'single' | 'compare';
      originalSP: string;
      optimizedSP?: string;
      connection: DbConnectionConfig;
    };

    if (!originalSP?.trim()) {
      return NextResponse.json({ error: 'originalSP is required' }, { status: 400 });
    }
    if (mode === 'compare' && !optimizedSP?.trim()) {
      return NextResponse.json({ error: 'optimizedSP is required for compare mode' }, { status: 400 });
    }

    let sessionId = 'anonymous';
    if (token) {
      const session = db.prepare('SELECT id FROM sessions WHERE token = ? AND is_active = 1').get(token) as any;
      if (session) sessionId = session.id;
    }

    // Ensure anonymous user/session
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

    // Execute SPs
    const originalResult = await executeSP(originalSP, 'Original_SP', connection);

    let result: any;
    let auditType = 'EXECUTE';

    if (mode === 'compare' && optimizedSP) {
      const optimizedResult = await executeSP(optimizedSP, 'Optimized_SP', connection);
      const { original, optimized, comparison } = compareExecutions(originalResult, optimizedResult);

      result = {
        mode: 'compare',
        original: { execution: originalResult, analysis: original },
        optimized: { execution: optimizedResult, analysis: optimized },
        comparison,
      };
      auditType = 'EXECUTE_COMPARE';
    } else {
      const analysis = analyzeExecution(originalResult);
      result = {
        mode: 'single',
        execution: originalResult,
        analysis,
      };
    }

    const auditId = uuidv4();
    const sharedToken = uuidv4();

    db.prepare(`
      INSERT INTO audit_requests (id, session_id, type, request_payload, response_payload, shared_token)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      sessionId,
      auditType,
      JSON.stringify({ mode, originalSP, optimizedSP, engine: connection.engine }),
      JSON.stringify(result),
      sharedToken,
    );

    return NextResponse.json({ id: auditId, sharedToken, result });
  } catch (error: any) {
    console.error('[execute/route]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
