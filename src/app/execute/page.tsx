'use client';

import { useRef, useState } from 'react';
import {
  Box, Container, Heading, Text, Button, Flex,
  Spinner, Badge, Grid, Input, Separator,
} from '@chakra-ui/react';
import type { AuditAnalysis } from '@/lib/audit-analyzer';
import type { ExecutionResult } from '@/lib/sp-executor';
import { useApi } from '@/components/api-client';
import {
  TargetEditor, buildTarget, emptyDraft, isDraftEmpty,
  type TargetDraft,
} from '@/components/execute/target-editor';

type ComparisonAnalysis = AuditAnalysis & {
  improvementPercent?: number | null;
  comparisonSummary?: string;
};
type Side = { execution: ExecutionResult; analysis: AuditAnalysis };
// Mirrors the result built in src/app/api/execute/route.ts.
type ExecuteResult =
  | { mode: 'single'; simulated?: boolean;
  warnings?: string[]; execution: ExecutionResult; analysis: AuditAnalysis }
  | {
      mode: 'compare';
      simulated?: boolean;
  warnings?: string[];
      original: Side;
      optimized: Side;
      comparison: ComparisonAnalysis;
    };
type TestInfo = { ok: boolean; message: string };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GradeBadge({ grade }: { grade: string | null }) {
  if (grade === null) {
    return <Badge colorPalette="gray" variant="subtle" px={3} py={2}>Not captured</Badge>;
  }
  const colors: Record<string, string> = { A: 'green', B: 'blue', C: 'yellow', D: 'orange', F: 'red' };
  return (
    <Box
      display="inline-flex" alignItems="center" justifyContent="center"
      w="56px" h="56px" borderRadius="full"
      bg={`${colors[grade] || 'gray'}.900`}
      borderWidth="2px" borderColor={`${colors[grade] || 'gray'}.500`}
      fontSize="2xl" fontWeight="black" color={`${colors[grade] || 'gray'}.300`}
    >
      {grade}
    </Box>
  );
}

function StatCard({ label, value, unit = '', color = 'blue' }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  return (
    <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={4} textAlign="center">
      <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>{label}</Text>
      <Text fontSize="2xl" fontWeight="bold" color={`${color}.300`}>{value === null ? 'Not captured' : value.toLocaleString()}</Text>
      {unit && value !== null && <Text fontSize="xs" color="gray.500">{unit}</Text>}
    </Box>
  );
}

function AnalysisPanel({ analysis, title }: { analysis: AuditAnalysis; title: string }) {
  return (
    <Box borderWidth="1px" borderColor="gray.700" borderRadius="xl" overflow="hidden">
      <Box bg="gray.800" px={6} py={4} borderBottomWidth="1px" borderColor="gray.700">
        <Flex align="center" gap={4}>
          <GradeBadge grade={analysis.performanceGrade} />
          <Box>
            <Heading size="md" color="white">{title}</Heading>
            <Text fontSize="sm" color="gray.400">{analysis.gradeRationale}</Text>
          </Box>
        </Flex>
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={6}>
        {/* Summary */}
        <Text color="gray.200" lineHeight="tall">{analysis.summary}</Text>

        <Separator borderColor="gray.700" />

        {/* Stats */}
        <Grid templateColumns="repeat(4, 1fr)" gap={4}>
          <StatCard label="Total Logical Reads" value={analysis.ioAnalysis.totalLogicalReads} color="blue" />
          <StatCard label="Physical Reads" value={analysis.ioAnalysis.totalPhysicalReads} color={analysis.ioAnalysis.totalPhysicalReads === null ? 'gray' : analysis.ioAnalysis.totalPhysicalReads > 0 ? 'orange' : 'green'} />
          <StatCard label="Scan Count" value={analysis.ioAnalysis.totalScanCount} color={analysis.ioAnalysis.totalScanCount === null ? 'gray' : analysis.ioAnalysis.totalScanCount > 3 ? 'red' : 'green'} />
          <StatCard label="Total Time" value={analysis.timeAnalysis.totalMs} unit="ms" color={analysis.timeAnalysis.totalMs === null ? 'gray' : analysis.timeAnalysis.totalMs > 1000 ? 'red' : 'green'} />
        </Grid>

        <Separator borderColor="gray.700" />

        {/* Time breakdown */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="cyan.400" mb={3} textTransform="uppercase" letterSpacing="wider">⏱ Time Analysis</Text>
          <Grid templateColumns="1fr 1fr" gap={4}>
            <Box p={4} bg="gray.800" borderRadius="lg">
              <Text fontSize="xs" color="gray.500" mb={1}>Parse & Compile</Text>
              <Text color="cyan.300" fontWeight="bold">{analysis.timeAnalysis.parseTimeMs === null ? 'Not captured' : `${analysis.timeAnalysis.parseTimeMs}ms`}</Text>
            </Box>
            <Box p={4} bg="gray.800" borderRadius="lg">
              <Text fontSize="xs" color="gray.500" mb={1}>Execution</Text>
              <Text color="cyan.300" fontWeight="bold">{analysis.timeAnalysis.executeTimeMs === null ? 'Not captured' : `${analysis.timeAnalysis.executeTimeMs}ms`}</Text>
            </Box>
          </Grid>
          <Box mt={3} p={4} bg="gray.800" borderRadius="lg" borderLeftWidth="3px" borderColor="cyan.500">
            <Text color="gray.300" fontSize="sm">{analysis.timeAnalysis.classification}</Text>
            <Text color="gray.500" fontSize="xs" mt={1}>{analysis.timeAnalysis.recommendation}</Text>
          </Box>
        </Box>

        <Separator borderColor="gray.700" />

        {/* Hot tables */}
        {analysis.ioAnalysis.hotTables.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="orange.400" mb={3} textTransform="uppercase" letterSpacing="wider">🔥 Hot Tables (I/O)</Text>
            <Box display="flex" flexDirection="column" gap={2}>
              {analysis.ioAnalysis.hotTables.map((ht, i) => (
                <Box key={i} p={4} bg="gray.800" borderRadius="lg" borderLeftWidth="3px"
                  borderColor={ht.concern.startsWith('HIGH') ? 'red.500' : ht.concern.startsWith('MEDIUM') ? 'yellow.500' : 'green.500'}>
                  <Flex justify="space-between" align="flex-start">
                    <Box>
                      <Text color="white" fontWeight="semibold" fontSize="sm">{ht.table}</Text>
                      <Text color="gray.400" fontSize="xs" mt={1}>{ht.concern}</Text>
                    </Box>
                    <Flex gap={4} textAlign="right">
                      <Box>
                        <Text fontSize="xs" color="gray.500">Logical Reads</Text>
                        <Text color="orange.300" fontWeight="bold">{ht.logicalReads.toLocaleString()}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" color="gray.500">Scans</Text>
                        <Text color={ht.scanCount > 10 ? 'red.400' : 'gray.300'} fontWeight="bold">{ht.scanCount}</Text>
                      </Box>
                    </Flex>
                  </Flex>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Separator borderColor="gray.700" />

        {/* Pros & Cons */}
        <Grid templateColumns="1fr 1fr" gap={4}>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="green.400" mb={3} textTransform="uppercase" letterSpacing="wider">✅ Pros</Text>
            {analysis.prosAndCons.pros.map((p, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="green.400">+</Text>
                <Text color="gray.300" fontSize="sm">{p}</Text>
              </Flex>
            ))}
          </Box>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="red.400" mb={3} textTransform="uppercase" letterSpacing="wider">❌ Cons</Text>
            {analysis.prosAndCons.cons.map((c, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="red.400">−</Text>
                <Text color="gray.300" fontSize="sm">{c}</Text>
              </Flex>
            ))}
          </Box>
        </Grid>

        <Separator borderColor="gray.700" />

        {/* Recommendations */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="blue.400" mb={3} textTransform="uppercase" letterSpacing="wider">💡 Recommendations</Text>
          {analysis.recommendations.map((r, i) => (
            <Flex key={i} gap={2} mb={2} align="flex-start">
              <Badge colorPalette="blue" variant="subtle" mt="1px" flexShrink={0}>{i + 1}</Badge>
              <Text color="gray.200" fontSize="sm">{r}</Text>
            </Flex>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function RawStatsPanel({ execution }: { execution: ExecutionResult }) {
  const [show, setShow] = useState(false);
  return (
    <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" overflow="hidden">
      <Flex justify="space-between" align="center" px={5} py={3} borderBottomWidth="1px" borderColor="gray.700">
        <Text fontSize="sm" fontWeight="semibold" color="gray.300">📄 Raw Execution Output</Text>
        <Button size="xs" variant="ghost" colorPalette="gray" onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </Button>
      </Flex>
      {show && (
        <Box p={5}>
          <Flex gap={4} mb={4} flexWrap="wrap">
            <Badge colorPalette="blue">Record #{execution.recordNumber}</Badge>
            <Badge colorPalette="gray">Engine: {execution.connectionEngine}</Badge>
            <Badge colorPalette="gray">{execution.executedAt}</Badge>
            <Badge colorPalette={execution.success ? 'green' : 'red'}>{execution.success ? 'SUCCESS' : 'FAILED'}</Badge>
          </Flex>
          <Box as="pre" fontSize="xs" color="green.300" bg="gray.950" p={4} borderRadius="lg"
            overflowX="auto" fontFamily="mono" whiteSpace="pre-wrap" lineHeight="tall">
            {execution.stats.rawOutput}
          </Box>
          {(execution as { textFilePath?: string }).textFilePath && (
            <Text fontSize="xs" color="gray.500" mt={3}>📁 Audit log saved</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutePage() {
  const api = useApi();
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [kind, setKind] = useState<'procedure' | 'batch'>('batch');
  const [original, setOriginal] = useState<TargetDraft>(emptyDraft());
  const [optimized, setOptimized] = useState<TargetDraft>(emptyDraft());
  const [engine, setEngine] = useState<'simulation' | 'mssql' | 'postgres'>('simulation');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('1433');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [trustCert, setTrustCert] = useState(true);

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'compare' | 'original' | 'optimized'>('compare');
  const abortRef = useRef<AbortController | null>(null);

  const [portError, setPortError] = useState<string | null>(null);

  /** Returns false (and sets a field error) when the port is not an integer in 1-65535. */
  function validatePort(): boolean {
    const n = Number(port);
    if (port.trim() === '' || !Number.isInteger(n) || n < 1 || n > 65535) {
      setPortError('Port must be a whole number between 1 and 65535');
      return false;
    }
    setPortError(null);
    return true;
  }

  const connection = () => ({
    host, port: Number(port), database, username, password,
    ...(engine === 'mssql' ? { trustServerCertificate: trustCert } : {}),
  });

  async function handleTest() {
    if (engine === 'simulation') return;
    if (!validatePort()) return;
    setTesting(true);
    setTestInfo(null);
    const res = await api<{ serverVersion?: string }>(
      '/api/connections/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, connection: connection() }),
      },
      'Connection test failed'
    );
    if (res.ok) {
      setTestInfo({ ok: true, message: `Connected${res.data?.serverVersion ? `: ${res.data.serverVersion}` : ''}` });
    } else if (res.status !== 401) {
      setTestInfo({ ok: false, message: res.error ?? 'Connection test failed' });
    }
    setTesting(false);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleExecute() {
    if (isDraftEmpty(kind, original)) return;
    if (engine !== 'simulation' && !validatePort()) return;
    const orig = buildTarget(kind, original);
    if (!orig.ok) { setError(orig.error); return; }
    let opt: ReturnType<typeof buildTarget> | null = null;
    if (mode === 'compare') {
      opt = buildTarget(kind, optimized);
      if (!opt.ok) { setError(opt.error); return; }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);

    const res = await api<{ result: ExecuteResult }>(
      '/api/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          engine,
          ...(engine !== 'simulation' ? { connection: connection() } : {}),
          original: orig.target,
          ...(opt && opt.ok ? { optimized: opt.target } : {}),
        }),
      },
      'Execution failed'
    );
    abortRef.current = null;
    if (res.ok && res.data) {
      setResult(res.data.result);
    } else if (controller.signal.aborted) {
      setError('Execution cancelled');
    } else if (res.status !== 401) {
      setError(res.error ?? 'Execution failed');
    }
    setLoading(false);
  }

  return (
    <Box minH="100vh" bg="gray.950" color="white">
      <Container maxW="container.xl" py={10}>

        {/* Header */}
        <Box mb={8}>
          <Flex align="center" gap={3} mb={2}>
            <Badge colorPalette="orange" size="lg" px={3} py={1} borderRadius="full">R003 / R004</Badge>
            <Heading as="h1" size="2xl" bgGradient="to-r" gradientFrom="orange.400" gradientTo="red.400" bgClip="text">
              Execute & Audit SP
            </Heading>
          </Flex>
          <Text color="gray.400" fontSize="lg">
            Execute Stored Procedures, collect full IO/Statistical metrics, store audit logs, and get deep R004 performance analysis.
          </Text>
        </Box>

        {/* Mode toggle */}
        <Flex gap={3} mb={6}>
          <Button
            size="sm" colorPalette="orange"
            variant={mode === 'single' ? 'solid' : 'outline'}
            onClick={() => setMode('single')}
          >
            Single SP
          </Button>
          <Button
            size="sm" colorPalette="purple"
            variant={mode === 'compare' ? 'solid' : 'outline'}
            onClick={() => setMode('compare')}
          >
            Compare Original vs Optimized
          </Button>
        </Flex>

        {/* Target kind toggle */}
        <Flex gap={3} mb={6} role="group" aria-label="Target kind">
          <Button size="sm" colorPalette="cyan" variant={kind === 'procedure' ? 'solid' : 'outline'}
            aria-pressed={kind === 'procedure'} onClick={() => setKind('procedure')}>
            Procedure
          </Button>
          <Button size="sm" colorPalette="cyan" variant={kind === 'batch' ? 'solid' : 'outline'}
            aria-pressed={kind === 'batch'} onClick={() => setKind('batch')}>
            Batch
          </Button>
        </Flex>

        {/* Connection Config */}
        <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={6} mb={6}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.300" mb={4} textTransform="uppercase" letterSpacing="wider">
            🔌 Database Connection
          </Text>
          <Grid templateColumns={{ base: '1fr', md: 'repeat(3, 1fr)' }} gap={4}>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>Engine</Text>
              <select
                value={engine}
                onChange={(e) =>
                  setEngine(e.target.value as 'simulation' | 'mssql' | 'postgres')
                }
                className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white outline-none ring-0 focus:border-orange-500"
              >
                <option value="simulation">🧪 Simulation (no DB needed)</option>
                <option value="mssql">🗄 SQL Server (mssql)</option>
                <option value="postgres">🐘 PostgreSQL (pg)</option>
              </select>
            </Box>

            {engine !== 'simulation' && (
              <>
                <Box>
                  <Text fontSize="xs" color="gray.400" mb={1}>Host</Text>
                  <Input size="sm" value={host} onChange={e => setHost(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="localhost" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.400" mb={1}>Port</Text>
                  <Input size="sm" value={port} onChange={e => setPort(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="1433" aria-label="Port" aria-invalid={portError !== null} />
                  {portError && <Text fontSize="xs" color="red.300" mt={1} role="alert">{portError}</Text>}
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.400" mb={1}>Database</Text>
                  <Input size="sm" value={database} onChange={e => setDatabase(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="MyDatabase" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.400" mb={1}>Username</Text>
                  <Input size="sm" value={username} onChange={e => setUsername(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="sa" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.400" mb={1}>Password</Text>
                  <Input size="sm" type="password" value={password} onChange={e => setPassword(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="••••••••" />
                </Box>
                {engine === 'mssql' && (
                  <Flex align="center" gap={3} pt={4}>
                    <input
                      type="checkbox"
                      checked={trustCert}
                      onChange={(e) => setTrustCert(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500"
                    />
                    <Text fontSize="xs" color="gray.400">Trust Server Certificate</Text>
                  </Flex>
                )}
              </>
            )}
          </Grid>
          {engine !== 'simulation' && (
            <Flex mt={4} gap={3} align="center">
              <Button size="sm" variant="outline" colorPalette="blue" onClick={handleTest}
                loading={testing} loadingText="Testing..." disabled={testing || !host.trim() || !database.trim()}>
                Test connection
              </Button>
              {testInfo && (
                <Text fontSize="sm" role="status" color={testInfo.ok ? 'green.300' : 'red.300'}>{testInfo.message}</Text>
              )}
            </Flex>
          )}
          {engine === 'simulation' && (
            <Box mt={4} p={3} bg="blue.950" borderRadius="lg" borderWidth="1px" borderColor="blue.800">
              <Text fontSize="sm" color="blue.300">
                🧪 <strong>Simulation Mode:</strong> Generates realistic SQL Server statistical output based on SP pattern analysis. No database connection required.
              </Text>
            </Box>
          )}
        </Box>

        {/* SP Input */}
        <Grid templateColumns={mode === 'compare' ? '1fr 1fr' : '1fr'} gap={5} mb={6}>
          <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
            <Flex align="center" gap={2} mb={3}>
              {mode === 'compare' && <Badge colorPalette="red" variant="subtle">ORIGINAL</Badge>}
              <Text fontSize="sm" fontWeight="semibold" color="gray.300" textTransform="uppercase" letterSpacing="wider">
                {mode === 'compare' ? 'Current SP' : 'Stored Procedure'}
              </Text>
            </Flex>
            <TargetEditor
              kind={kind} draft={original} onChange={setOriginal} color={mode === 'compare' ? 'red.200' : 'cyan.100'}
              placeholder="-- Paste your Stored Procedure here..."
            />
          </Box>

          {mode === 'compare' && (
            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
              <Flex align="center" gap={2} mb={3}>
                <Badge colorPalette="green" variant="subtle">OPTIMIZED</Badge>
                <Text fontSize="sm" fontWeight="semibold" color="gray.300" textTransform="uppercase" letterSpacing="wider">Improved SP</Text>
              </Flex>
              <TargetEditor
                kind={kind} draft={optimized} onChange={setOptimized} color="green.200"
                placeholder="-- Paste your Optimized SP here..."
              />
            </Box>
          )}
        </Grid>

        {/* Execute button */}
        <Flex justify="flex-end" gap={3} mb={8}>
          {loading && (
            <Button size="lg" variant="outline" colorPalette="red" onClick={handleCancel}>Cancel</Button>
          )}
          <Button
            colorPalette="orange"
            size="lg"
            px={10}
            onClick={handleExecute}
            loading={loading}
            loadingText="Executing..."
            disabled={isDraftEmpty(kind, original) || (mode === 'compare' && isDraftEmpty(kind, optimized)) || loading}
          >
            ▶ Execute & Audit
          </Button>
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column" role="status">
            <Spinner size="xl" color="orange.400" borderWidth="3px" />
            <Text color="gray.400">
              Executing SP{mode === 'compare' ? 's' : ''} and collecting STATISTICS IO / TIME data...
            </Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={5} mb={6} role="alert">
            <Text color="red.300" fontWeight="semibold">⚠️ Execution Failed</Text>
            <Text color="red.400" fontSize="sm" mt={1}>{error}</Text>
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box display="flex" flexDirection="column" gap={6}>
            {result.warnings && result.warnings.length > 0 && (
              <Box bg="yellow.950" borderWidth="1px" borderColor="yellow.700" borderRadius="xl" p={4} role="status">
                <Text color="yellow.300" fontWeight="semibold" fontSize="sm">Warnings</Text>
                {result.warnings.map((w, i) => <Text key={i} color="yellow.200" fontSize="sm">{w}</Text>)}
              </Box>
            )}
            {(result.simulated ??
              (result.mode === 'single' ? result.execution.stats.simulated : result.original.execution.stats.simulated)) && (
              <Box><Badge colorPalette="yellow">Simulated</Badge></Box>
            )}

            {result.mode === 'single' ? (
              <>
                <AnalysisPanel analysis={result.analysis} title={`📊 Execution Analysis — ${result.execution.spLabel}`} />
                <RawStatsPanel execution={result.execution} />
              </>
            ) : (
              <>
                {/* Comparison improvement strip */}
                {result.comparison.improvementPercent != null && (
                  <Box p={5} borderRadius="xl" borderWidth="1px"
                    bg={result.comparison.improvementPercent > 0 ? 'green.950' : 'red.950'}
                    borderColor={result.comparison.improvementPercent > 0 ? 'green.700' : 'red.700'}>
                    <Flex align="center" gap={4}>
                      <Box fontSize="3xl">{result.comparison.improvementPercent > 20 ? '🚀' : result.comparison.improvementPercent > 0 ? '📈' : '📉'}</Box>
                      <Box>
                        <Text fontWeight="bold" color={result.comparison.improvementPercent > 0 ? 'green.300' : 'red.300'} fontSize="lg">
                          {result.comparison.improvementPercent > 0
                            ? `${result.comparison.improvementPercent}% I/O Improvement`
                            : `${Math.abs(result.comparison.improvementPercent)}% I/O Regression`}
                        </Text>
                        <Text color="gray.400" fontSize="sm">{result.comparison.comparisonSummary}</Text>
                      </Box>
                    </Flex>
                  </Box>
                )}

                {/* Tabs */}
                <Flex gap={2}>
                  {(['compare', 'original', 'optimized'] as const).map(tab => (
                    <Button key={tab} size="sm"
                      variant={activeTab === tab ? 'solid' : 'outline'}
                      colorPalette={tab === 'original' ? 'red' : tab === 'optimized' ? 'green' : 'orange'}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab === 'compare' ? '📊 Comparison' : tab === 'original' ? '🔴 Original' : '🟢 Optimized'}
                    </Button>
                  ))}
                </Flex>

                {activeTab === 'compare' && <AnalysisPanel analysis={result.comparison} title="📊 Comparative Audit" />}
                {activeTab === 'original' && (
                  <>
                    <AnalysisPanel analysis={result.original.analysis} title="🔴 Original SP Audit" />
                    <RawStatsPanel execution={result.original.execution} />
                  </>
                )}
                {activeTab === 'optimized' && (
                  <>
                    <AnalysisPanel analysis={result.optimized.analysis} title="🟢 Optimized SP Audit" />
                    <RawStatsPanel execution={result.optimized.execution} />
                  </>
                )}
              </>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
