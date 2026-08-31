/**
 * AI Transformer Service for SQLLens
 * Handles prompt construction and AI-driven analysis for R001 and R002.
 * 
 * In production: Replace the MOCK_MODE block with a real LLM call
 * (OpenAI, Gemini, Anthropic, or local Ollama endpoint).
 */

export interface ReviewResult {
  summary: string;
  bottlenecks: string[];
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  fiveWhys: { why: string; answer: string }[];
  deepDive: string;
  verdict: string;
}

export interface CompareResult {
  summary: string;
  original: ReviewResult;
  optimized: ReviewResult;
  bottlenecks: string[];
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  fiveWhys: { why: string; answer: string }[];
  deepDive: string;
  verdict: string;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildReviewPrompt(sp: string): string {
  return `You are an expert database performance engineer. Analyse the following SQL Stored Procedure deeply.

Return a JSON object with exactly this structure (no markdown fences):
{
  "summary": "One paragraph executive summary",
  "bottlenecks": ["bottleneck 1", "bottleneck 2", ...],
  "prosAndCons": {
    "pros": ["pro 1", ...],
    "cons": ["con 1", ...]
  },
  "recommendations": ["recommendation 1", ...],
  "fiveWhys": [
    { "why": "Why does this SP have a performance issue?", "answer": "..." },
    { "why": "Why does that cause slowness?", "answer": "..." },
    { "why": "Why is that root cause hard to fix?", "answer": "..." },
    { "why": "Why has it not been fixed already?", "answer": "..." },
    { "why": "Why would fixing it improve user experience?", "answer": "..." }
  ],
  "deepDive": "Detailed multi-paragraph technical analysis",
  "verdict": "Final verdict: PASS | NEEDS IMPROVEMENT | FAIL with brief justification"
}

Stored Procedure:
\`\`\`sql
${sp}
\`\`\``;
}

function buildComparePrompt(original: string, optimized: string): string {
  return `You are an expert database performance engineer. Compare these two SQL Stored Procedures — the ORIGINAL and the OPTIMIZED version.

Return a JSON object with exactly this structure (no markdown fences):
{
  "summary": "One paragraph executive summary of the comparison",
  "original": {
    "summary": "...", "bottlenecks": [...], "prosAndCons": {"pros":[...],"cons":[...]},
    "recommendations": [...], "fiveWhys": [{"why":"...","answer":"..."},...],
    "deepDive": "...", "verdict": "..."
  },
  "optimized": {
    "summary": "...", "bottlenecks": [...], "prosAndCons": {"pros":[...],"cons":[...]},
    "recommendations": [...], "fiveWhys": [{"why":"...","answer":"..."},...],
    "deepDive": "...", "verdict": "..."
  },
  "bottlenecks": ["key bottleneck differences between the two"],
  "prosAndCons": {
    "pros": ["advantages of the optimized version"],
    "cons": ["remaining issues or trade-offs"]
  },
  "recommendations": ["what to do next"],
  "fiveWhys": [
    { "why": "Why was the original SP underperforming?", "answer": "..." },
    { "why": "Why does the optimized version fix that?", "answer": "..." },
    { "why": "Why might further improvements still be needed?", "answer": "..." },
    { "why": "Why is the optimization approach correct?", "answer": "..." },
    { "why": "Why should this be adopted in production?", "answer": "..." }
  ],
  "deepDive": "Detailed technical comparison",
  "verdict": "Final verdict: IS THE OPTIMIZED VERSION READY FOR PRODUCTION? Yes/No with justification."
}

ORIGINAL Stored Procedure:
\`\`\`sql
${original}
\`\`\`

OPTIMIZED Stored Procedure:
\`\`\`sql
${optimized}
\`\`\``;
}

// ---------------------------------------------------------------------------
// Mock AI engine (replace with real LLM call)
// ---------------------------------------------------------------------------

function mockReview(sp: string, label = 'the Stored Procedure'): ReviewResult {
  const hasCursor = /CURSOR/i.test(sp);
  const hasSelect = /SELECT\s+\*/i.test(sp);
  const hasNoIndex = !/CREATE\s+INDEX|WITH\s*\(NOLOCK\)/i.test(sp);
  const hasLoop = /WHILE|FOR\s+EACH/i.test(sp);

  const bottlenecks: string[] = [];
  if (hasCursor) bottlenecks.push('CURSOR usage detected — row-by-row processing is extremely slow at scale');
  if (hasSelect) bottlenecks.push('SELECT * returns unnecessary columns — increases I/O and network overhead');
  if (hasNoIndex) bottlenecks.push('No index hints or covering index guidance — potential table scans likely');
  if (hasLoop) bottlenecks.push('Iterative loop construct — prefer set-based operations over procedural loops');
  if (bottlenecks.length === 0) bottlenecks.push('No obvious structural bottlenecks detected — review query plans for further tuning');

  return {
    summary: `${label} has been analysed. ${hasCursor ? 'A CURSOR was found which is a well-known SQL anti-pattern.' : 'No CURSORs were found.'} ${hasSelect ? 'SELECT * usage detected.' : ''} Overall performance classification: ${bottlenecks.length > 2 ? 'HIGH RISK' : bottlenecks.length > 0 ? 'MEDIUM RISK' : 'LOW RISK'}.`,
    bottlenecks,
    prosAndCons: {
      pros: [
        'Encapsulated business logic in a single reusable unit',
        'Reduces round-trips between application and database server',
        'Execution plan can be cached by the query optimizer',
      ],
      cons: bottlenecks.length > 0
        ? bottlenecks.map(b => `Performance issue: ${b}`)
        : ['No significant cons identified in this analysis'],
    },
    recommendations: [
      hasCursor ? 'Replace CURSOR with a set-based UPDATE/INSERT pattern' : 'Maintain the current set-based approach',
      hasSelect ? 'Replace SELECT * with explicit column lists' : 'Column selection looks appropriate',
      'Add WITH (NOLOCK) hints where dirty reads are acceptable to reduce lock contention',
      'Consider adding missing indexes based on execution plan output',
      'Use TRY...CATCH blocks for robust error handling',
      'Add SET NOCOUNT ON at the top to suppress row count messages',
    ],
    fiveWhys: [
      { why: 'Why does this procedure have performance issues?', answer: bottlenecks[0] || 'No critical bottlenecks found' },
      { why: 'Why does that cause slowness at scale?', answer: 'As data volume grows, un-indexed row-by-row operations grow linearly or worse in complexity' },
      { why: 'Why has this pattern been introduced?', answer: 'Often due to procedural programming habits translated directly to SQL without considering set-based alternatives' },
      { why: 'Why is it difficult to change now?', answer: 'Changing the execution strategy requires understanding downstream dependencies and re-testing all affected business flows' },
      { why: 'Why is fixing this a priority?', answer: 'Database performance bottlenecks compound — a slow SP called by multiple services degrades the entire application stack' },
    ],
    deepDive: `## Deep Dive Analysis\n\n**Structural Analysis:** The procedure contains ${sp.split('\n').length} lines of SQL. ${hasCursor ? '⚠️ A CURSOR loop was identified. Each iteration opens a new logical read, creating N×cost for N rows. This scales terribly.' : '✅ No CURSORs found.'}\n\n**I/O Analysis:** ${hasSelect ? '⚠️ SELECT * fetches all columns including potentially large text/blob columns not needed by the caller. Always prefer explicit column lists.' : '✅ Column selection appears targeted.'}\n\n**Locking & Concurrency:** Without explicit lock hints, SQL Server defaults to SHARED locks during reads, which can cause blocking under high concurrency. Consider READ UNCOMMITTED or SNAPSHOT isolation for read-heavy paths.\n\n**Execution Plan Recommendations:** Run \`SET STATISTICS IO ON\` and \`SET STATISTICS TIME ON\` before executing to capture logical reads and CPU time. Look for table scan operators in the actual execution plan.`,
    verdict: bottlenecks.length === 0
      ? '✅ PASS — No critical issues found. Minor optimisations recommended before production promotion.'
      : bottlenecks.length <= 2
      ? '⚠️ NEEDS IMPROVEMENT — Address the identified bottlenecks before high-load production use.'
      : '❌ FAIL — Multiple critical performance anti-patterns detected. Refactoring required before production use.',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeStoredProcedure(sp: string): Promise<ReviewResult> {
  // TODO: Replace with real LLM call. Example:
  // const prompt = buildReviewPrompt(sp);
  // const response = await fetch('https://api.openai.com/v1/...', { ... });
  // return JSON.parse(await response.json().choices[0].message.content);
  
  return mockReview(sp, 'the Stored Procedure');
}

export async function compareStoredProcedures(original: string, optimized: string): Promise<CompareResult> {
  // TODO: Replace with real LLM call using buildComparePrompt(original, optimized)
  
  const originalReview = mockReview(original, 'Original SP');
  const optimizedReview = mockReview(optimized, 'Optimized SP');

  const originalRisk = originalReview.bottlenecks.length;
  const optimizedRisk = optimizedReview.bottlenecks.length;
  const improvement = originalRisk - optimizedRisk;

  return {
    summary: `Comparison completed. The original SP has ${originalRisk} bottleneck(s) vs ${optimizedRisk} in the optimized version — a ${improvement > 0 ? `${improvement} issue reduction` : 'no structural reduction'}.`,
    original: originalReview,
    optimized: optimizedReview,
    bottlenecks: [
      `Original: ${originalRisk} bottleneck(s). Optimized: ${optimizedRisk} bottleneck(s).`,
      ...optimizedReview.bottlenecks.map(b => `Still present: ${b}`),
    ],
    prosAndCons: {
      pros: improvement > 0
        ? [`Reduced bottleneck count by ${improvement}`, 'Improved set-based operations', 'Better column selection']
        : ['Logic structure is consistent between versions'],
      cons: optimizedRisk > 0
        ? optimizedReview.bottlenecks.map(b => `Remaining issue: ${b}`)
        : ['No remaining cons identified'],
    },
    recommendations: [
      ...optimizedReview.recommendations,
      'Run both procedures against representative data volumes and compare actual execution plans',
      'Use STATISTICS IO/TIME to quantify the improvement numerically',
    ],
    fiveWhys: [
      { why: 'Why was the original SP underperforming?', answer: originalReview.bottlenecks[0] || 'No critical issues found' },
      { why: 'Why does the optimized version address that?', answer: improvement > 0 ? `It eliminates ${improvement} of the bottleneck(s)` : 'Structural changes were minimal — further refactoring needed' },
      { why: 'Why might further improvements still be needed?', answer: optimizedRisk > 0 ? `${optimizedRisk} bottleneck(s) still remain` : 'No further structural improvements detected at this level' },
      { why: 'Why is this optimisation approach the right one?', answer: 'Set-based SQL operations leverage the query optimizer; row-by-row procedures bypass it' },
      { why: 'Why should the optimized version be adopted in production?', answer: optimizedRisk < originalRisk ? 'It demonstrably has fewer performance anti-patterns' : 'Both versions should be further reviewed before production adoption' },
    ],
    deepDive: `## Comparative Deep Dive\n\n**Original SP:** ${originalReview.deepDive.substring(0, 300)}...\n\n**Optimized SP:** ${optimizedReview.deepDive.substring(0, 300)}...\n\n**Key Difference:** The optimized version ${improvement > 0 ? `resolves ${improvement} issue(s) compared to the original` : 'shows no significant structural improvement — consider a deeper refactoring pass'}.`,
    verdict: optimizedRisk < originalRisk
      ? `✅ OPTIMIZED VERSION RECOMMENDED — Reduces bottlenecks from ${originalRisk} to ${optimizedRisk}. Ready for load testing.`
      : optimizedRisk === 0
      ? '✅ BOTH VERSIONS ARE CLEAN — No critical issues in either. The optimized version can be safely promoted.'
      : `⚠️ OPTIMIZED VERSION NEEDS MORE WORK — ${optimizedRisk} issue(s) remain. Do not promote to production without further refactoring.`,
  };
}
