'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Container, Tabs } from '@chakra-ui/react';
import { DISCLAIMER } from '@/components/AppShell';

const REPO = 'https://github.com/kamalsoft/sqlLens/blob/main';
const TABS = ['about', 'architecture', 'faq'] as const;
type Tab = (typeof TABS)[number];

function Doc({ path, children }: { path: string; children: React.ReactNode }) {
  return <a href={`${REPO}/${path}`} className="text-link" target="_blank" rel="noreferrer">{children}</a>;
}

const FEATURES = [
  { icon: '▣', title: 'Review SP', href: '/review', text: 'Findings, risks and index ideas for a stored procedure, optionally backed by the measurements of one of your runs.' },
  { icon: '▶', title: 'Execute & Audit SP', href: '/execute', text: 'Run a procedure or batch, capture I/O, time and the plan, grade it, and refactor it with a local model.' },
  { icon: '☰', title: 'Audit', href: '/audit', text: 'Runs, reviews, compares and refactors with their prompt, request and response. Reopen, share or delete records.' },
  { icon: '⚙', title: 'Settings & Models', href: '/settings', text: 'Choose models, limits, retention and whether live execution is allowed. Download models under Manage Models.' },
];

const FAQ: { topic: string; items: { q: string; a: React.ReactNode }[] }[] = [
  { topic: 'Using SQLLens', items: [
    { q: 'Will Execute & Audit SP change my database?',
      a: <>It can. With <code>allowLiveExecution</code> on, procedures and batches run for real and are not rolled back. Use a development or test database and a login with only the rights the procedure needs. With it off, only Simulation runs.</> },
    { q: 'What does the grade and the prod-readiness verdict mean?',
      a: 'The grade (A to F) rates the measured I/O and time of the run. The verdict says whether the run looks ready for production against the targets in Settings; when no targets are set it uses the grade limits.' },
    { q: 'What is "telemetry" in Review?',
      a: 'The measurements of one of your Execute & Audit SP runs: timings (parse and compile, execution, CPU, total), reads per table, and the execution plan. The run picker shows exactly what will be sent before you analyze.' },
    { q: 'How do I add a model?',
      a: 'Under Manage Models, download an ONNX model from Hugging Face (for example onnx-community/Qwen2.5-1.5B-Instruct). Set HF_TOKEN on the server for gated models. GGUF and Safetensors files are not ONNX and are not used.' },
  ] },
  { topic: 'AI and results', items: [
    { q: 'Can I trust the review or refactor?',
      a: <>Treat it as a suggestion. Small local models can be wrong or incomplete. Review rows whose evidence is not quoted from your SQL are removed and index ideas are checked against it, but the rest is the model&apos;s opinion. Model-written SQL is never executed. {DISCLAIMER}</> },
    { q: 'Why did a review fail with "stuck repeating itself" or "could not be parsed"?',
      a: <>The model ran out of new tokens or looped. Choose a larger instruction-tuned model under Settings → Review Model, or shorten the procedure. Raising <code>maxNewTokens</code> does not help a model that loops.</> },
    { q: 'Which model is used?',
      a: 'The one chosen in Settings (Review Model, Refactor Model). On Automatic, SQLLens picks an installed model with a chat template, preferring instruction-tuned (Instruct, Chat) names, then the largest.' },
    { q: 'Why is a result marked "low confidence"?',
      a: 'The model is under about 1B parameters, or its answer needed the simpler fallback format. Check every finding before acting on it.' },
  ] },
  { topic: 'Data and security', items: [
    { q: 'Does SQLLens send my SQL to an AI service on the internet?',
      a: 'No. Models run on this machine, in a separate local process. SQL, prompts and results stay in the local database.' },
    { q: 'How long are audit records kept?',
      a: 'For Keep Records (days) in Settings, 90 by default. Older records, run logs and unused expired sessions are deleted when the server starts and once a day. You can also delete a record on its page.' },
    { q: 'Who can open a share link?',
      a: 'Only someone signed in to this SQLLens. Links expire after the Share Link Lifetime (24 hours by default) and can be revoked from the record.' },
    { q: 'I signed in again and my older audit records are missing. Why?',
      a: 'Records belong to the session that created them, so a new sign-in starts a new list. This is a known limitation.' },
    { q: 'How do I report a security problem?',
      a: <>Privately, as described in <Doc path="SECURITY.md">SECURITY.md</Doc>. Do not include real credentials or production data.</> },
  ] },
];

/** One box of the diagram: a title and up to two detail lines. */
function Node({ x, y, w, h, title, lines = [], tone = 'default' }: {
  x: number; y: number; w: number; h: number; title: string; lines?: string[]; tone?: 'default' | 'accent' | 'warn' | 'store';
}) {
  const stroke = { default: 'var(--border-subtle)', accent: 'var(--accent-default)', warn: 'var(--status-warn)', store: 'var(--grade-B)' }[tone];
  // Boxes appear left to right, top to bottom, so the eye follows the flow (CSS .arch-node; off for reduced motion).
  const delay = `${((x / 1000) * 0.5 + (y / 580) * 0.3).toFixed(2)}s`;
  return (
    <g className="arch-node" style={{ animationDelay: delay }}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="var(--bg-raised)" stroke={stroke} strokeWidth={1.5} />
      <text x={x + 14} y={y + 24} fill="var(--fg-default)" fontSize={14} fontWeight={600}>{title}</text>
      {lines.map((line, i) => (
        <text key={i} x={x + 14} y={y + 44 + i * 17} fill="var(--fg-muted)" fontSize={12}>{line}</text>
      ))}
    </g>
  );
}

/** An arrow with an optional label at its middle. */
function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g className="arch-arrow">
      <path d={d} fill="none" stroke="var(--fg-muted)" strokeWidth={1.5} markerEnd="url(#arrow)"
        strokeDasharray={dashed ? '5 4' : undefined} className={dashed ? 'arch-optional' : undefined} />
      {/* A dot travels along each always-on flow to show its direction (hidden for reduced motion). */}
      {!dashed && (
        <circle r={3} className="arch-dot">
          <animateMotion dur="2.8s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      {label && <text x={lx} y={ly} fill="var(--fg-muted)" fontSize={11} textAnchor="middle">{label}</text>}
    </g>
  );
}

/** HP-1: the application architecture, drawn with the theme colours. */
function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 1000 580" className="help-diagram" role="img" aria-labelledby="arch-title" aria-describedby="arch-desc">
      <title id="arch-title">SQLLens architecture</title>
      <desc id="arch-desc">
        One Next.js server on this machine serves the browser. A proxy checks API calls and sends pages without a session cookie to
        sign-in; API routes check the session. Execution runs Simulation, or SQL Server or PostgreSQL only when live execution is on.
        Review, Compare and Refactor send prompts to a separate local model worker that reads model files. Results are saved in a SQLite
        database, settings and prompts are files in data, executions also write run logs, and Manage Models downloads from Hugging Face.
      </desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-muted)" />
        </marker>
      </defs>

      {/* Outside, left */}
      <Node x={20} y={72} w={180} h={76} title="Browser" lines={['Pages on localhost']} />
      <Node x={20} y={430} w={180} h={84} title="Hugging Face" lines={['Downloads you start', 'in Manage Models']} />

      {/* The server: one Next.js process */}
      <rect x={250} y={30} width={390} height={530} rx={14} fill="var(--bg-panel)" stroke="var(--accent-default)" strokeWidth={1.5} />
      <text x={270} y={58} fill="var(--accent-default)" fontSize={15} fontWeight={700}>Next.js server (one process)</text>
      <Node x={270} y={72} w={350} h={76} title="Proxy" lines={['API: allowed hosts, no cross-site writes', 'Pages: no session cookie → sign-in']} tone="accent" />
      <Node x={270} y={160} w={350} h={76} title="API routes" lines={['Session check (all but sign-in), input', 'checks, rate limits on writes and models']} tone="accent" />
      <Node x={270} y={248} w={150} h={92} title="Analysis" lines={['Grade and verdict', 'from the run,', 'computed by code']} />
      <Node x={430} y={248} w={190} h={92} title="Execution" lines={['Simulation; SQL Server', 'or PostgreSQL only', 'when live is on']} />
      <Node x={270} y={352} w={350} h={92} title="Model output checks" lines={['JSON shape; review rows need evidence', 'from your SQL; index and rewrite checks;', 'model SQL is never run']} />
      <Node x={270} y={456} w={350} h={62} title="Retention job" lines={['On start and daily (Keep Records setting)']} />
      <text x={445} y={536} fill="var(--fg-muted)" fontSize={11} textAnchor="middle">Saved as audit records:</text>
      <text x={445} y={551} fill="var(--fg-muted)" fontSize={11} textAnchor="middle">Execute, Review, Compare, Refactor</text>

      {/* Outside, right */}
      <Node x={700} y={30} w={280} h={76} title="Model worker" lines={['Separate local Node process', 'one run at a time, with a timeout']} />
      <Node x={700} y={124} w={280} h={62} title="Model files (ONNX)" lines={['downloadDirectory in Settings']} tone="store" />
      <Node x={700} y={210} w={280} h={78} title="SQL Server / PostgreSQL" lines={['Only with allowLiveExecution on', 'SQL Server: TLS on by default']} tone="warn" />
      <Node x={700} y={306} w={280} h={78} title="SQLite database" lines={['Audit records, feedback,', 'users, sessions']} tone="store" />
      <Node x={700} y={402} w={280} h={62} title="data/ folder" lines={['appconfig.json, prompts/*.md']} tone="store" />
      <Node x={700} y={482} w={280} h={62} title="audit_logs/" lines={['One file per execution']} tone="store" />

      {/* Flows */}
      <Arrow d="M200,110 H268" label="HTTP" lx={234} ly={102} />
      <Arrow d="M620,198 L698,68" label="prompts" lx={668} ly={150} />
      <Arrow d="M840,106 V122" />
      <Arrow d="M620,262 H698" label="live SQL" lx={659} ly={254} dashed />
      <Arrow d="M640,345 H698" label="records" lx={669} ly={337} />
      <Arrow d="M640,433 H698" label="config" lx={669} ly={425} />
      <Arrow d="M640,513 H698" label="logs" lx={669} ly={505} />
      <Arrow d="M200,472 H248" label="models" lx={224} ly={464} dashed />
    </svg>
  );
}

const FLOW = [
  { step: 'Request', text: 'Pages and API calls go to one Next.js server on this machine. The proxy rejects API calls with an unknown host or from another site, and sends pages without a session cookie to sign-in.' },
  { step: 'Check', text: 'Every API route except sign-in checks your session. Routes that run SQL, call a model, download or change data also apply a rate limit.' },
  { step: 'Work', text: 'Execute runs Simulation, or SQL Server or PostgreSQL when live execution is on. Review, Compare and Refactor send a prompt to the local model worker.' },
  { step: 'Verify', text: 'Grades and verdicts are computed by code from the measurements. Model answers must be valid JSON; review rows without evidence from your SQL are dropped; index ideas and refactored SQL are checked, never run.' },
  { step: 'Record', text: 'Execute, Review, Compare and Refactor save an audit record for your session; Execute also writes a run log. Nothing is sent to an outside service except model downloads you start.' },
];

/**
 * HP-1: About, Architecture and FAQ, written for the app, with links to the full docs.
 * `/help?tab=faq` opens a tab directly.
 */
export default function HelpPage() {
  const [tab, setTab] = useState<Tab>('about');
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL once after mount (no Suspense needed)
    if (wanted && (TABS as readonly string[]).includes(wanted)) setTab(wanted as Tab);
  }, []);

  return (
    <Box color="fg.default">
      <Container maxW="container.lg" p={0}>
        <header className="page-header">
          <div>
            <p className="page-kicker">Reference</p>
            <h2 className="page-title">Help</h2>
            <p className="analysis-note">What SQLLens does, how it is built, and answers to common questions.</p>
          </div>
        </header>

        <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as Tab)} variant="line" lazyMount>
          <Tabs.List>
            <Tabs.Trigger value="about">About</Tabs.Trigger>
            <Tabs.Trigger value="architecture">Architecture</Tabs.Trigger>
            <Tabs.Trigger value="faq">FAQ</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="about">
            {/* The fade sits on an inner wrapper: on the panel itself Chakra would wait for it to end before hiding the panel. */}
            <div className="help-panel">
            <section className="help-hero" aria-label="What SQLLens is">
              <h3>Understand, run and improve SQL Server stored procedures</h3>
              <p>
                SQLLens runs on this machine: the app, its database and the AI models are local. With live execution on, it runs a
                procedure on your SQL Server and measures it (otherwise it simulates), grades the run, asks a local model for findings
                and a refactor, and keeps an audit record of runs, reviews, compares and refactors.
              </p>
              <span className="help-badge">Version 0.1.0 · <Doc path="docs/changelog.md">What&apos;s new</Doc></span>
            </section>

            <div className="help-cards" aria-label="Features">
              {FEATURES.map((f) => (
                <Link key={f.href} href={f.href} className="help-card">
                  <span className="help-card-icon" aria-hidden="true">{f.icon}</span>
                  <span className="help-card-title">{f.title}</span>
                  <span className="help-card-text">{f.text}</span>
                </Link>
              ))}
            </div>

            <section className="help-callout" aria-label="What it does not do">
              <h3>What it never does</h3>
              <ul>
                <li>Run SQL unless live execution is on in Settings, or run SQL written by a model.</li>
                <li>Send SQL, prompts or results to an online AI service.</li>
                <li>Replace your DBA. {DISCLAIMER}</li>
              </ul>
            </section>
            </div>
          </Tabs.Content>

          <Tabs.Content value="architecture">
            <div className="help-panel">
            <section className="help-section" aria-label="Application architecture">
              <h3>Application architecture</h3>
              <p className="help-lead">How the parts of SQLLens connect, as built today. Dashed lines happen only when you turn them on or ask: live SQL and model downloads.</p>
              <div className="help-diagram-frame">
                <ArchitectureDiagram />
              </div>
              <div className="help-legend" aria-hidden="true">
                <span><i style={{ borderColor: 'var(--accent-default)' }} /> Request checks</span>
                <span><i style={{ borderColor: 'var(--status-warn)' }} /> Changes data when live</span>
                <span><i style={{ borderColor: 'var(--grade-B)' }} /> Stored on this machine</span>
              </div>
            </section>

            <section className="help-section" aria-label="How a request flows">
              <h3>How a request flows</h3>
              <ol className="help-steps">
                {FLOW.map((f, i) => (
                  <li key={f.step}>
                    <span className="help-step-no" aria-hidden="true">{i + 1}</span>
                    <span><strong>{f.step}.</strong> {f.text}</span>
                  </li>
                ))}
              </ol>
              <p className="help-lead">
                More detail: <Doc path="docs/architecture.md">architecture</Doc>, <Doc path="docs/security.md">security and compliance</Doc>,{' '}
                <Doc path="docs/api.md">API reference</Doc>.
              </p>
            </section>
            </div>
          </Tabs.Content>

          <Tabs.Content value="faq">
            <div className="help-panel">
            {FAQ.map((group) => (
              <section key={group.topic} className="help-section help-faq-group" aria-label={group.topic}>
                <h3>
                  {group.topic} <span className="help-count" aria-label={`${group.items.length} questions`}>{group.items.length}</span>
                </h3>
                {group.items.map((item) => (
                  <details key={item.q} className="help-faq">
                    <summary>
                      <span className="help-faq-q">{item.q}</span>
                      <span className="help-faq-chevron" aria-hidden="true">›</span>
                    </summary>
                    <div className="help-faq-a">{item.a}</div>
                  </details>
                ))}
              </section>
            ))}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </Container>
    </Box>
  );
}
