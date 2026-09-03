'use client';

import { useState } from 'react';
import {
  Box, Container, Heading, Text, Textarea, Button, Flex,
  Spinner, Badge, Grid, Input, Separator,
  Tabs,
} from '@chakra-ui/react';
import { AuditAnalysis } from '@/lib/audit-analyzer';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GradeBadge({ grade }: { grade: string }) {
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

function StatCard({ label, value, unit = '', color = 'blue' }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={4} textAlign="center">
      <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>{label}</Text>
      <Text fontSize="2xl" fontWeight="bold" color={`${color}.300`}>{value.toLocaleString()}</Text>
      {unit && <Text fontSize="xs" color="gray.500">{unit}</Text>}
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
          <StatCard label="Physical Reads" value={analysis.ioAnalysis.totalPhysicalReads} color={analysis.ioAnalysis.totalPhysicalReads > 0 ? 'orange' : 'green'} />
          <StatCard label="Scan Count" value={analysis.ioAnalysis.totalScanCount} color={analysis.ioAnalysis.totalScanCount > 3 ? 'red' : 'green'} />
          <StatCard label="Total Time" value={analysis.timeAnalysis.totalMs} unit="ms" color={analysis.timeAnalysis.totalMs > 1000 ? 'red' : 'green'} />
        </Grid>

        <Separator borderColor="gray.700" />

        {/* Time breakdown */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="cyan.400" mb={3} textTransform="uppercase" letterSpacing="wider">⏱ Time Analysis</Text>
          <Grid templateColumns="1fr 1fr" gap={4}>
            <Box p={4} bg="gray.800" borderRadius="lg">
              <Text fontSize="xs" color="gray.500" mb={1}>Parse & Compile</Text>
              <Text color="cyan.300" fontWeight="bold">{analysis.timeAnalysis.parseTimeMs}ms</Text>
            </Box>
            <Box p={4} bg="gray.800" borderRadius="lg">
              <Text fontSize="xs" color="gray.500" mb={1}>Execution</Text>
              <Text color="cyan.300" fontWeight="bold">{analysis.timeAnalysis.executeTimeMs}ms</Text>
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

function RawStatsPanel({ execution }: { execution: any }) {
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
          <Text fontSize="xs" color="gray.500" mt={3}>
            📁 Audit log saved: {execution.textFilePath}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutePage() {
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [originalSP, setOriginalSP] = useState('');
  const [optimizedSP, setOptimizedSP] = useState('');
  const [engine, setEngine] = useState<'simulation' | 'mssql' | 'postgres'>('simulation');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('1433');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [trustCert, setTrustCert] = useState(true);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'compare' | 'original' | 'optimized'>('compare');

  async function handleExecute() {
    if (!originalSP.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          originalSP,
          optimizedSP: mode === 'compare' ? optimizedSP : undefined,
          connection: {
            engine,
            host, port: parseInt(port), database, username, password,
            trustServerCertificate: trustCert,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');
      setResult(data.result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
                  <Input size="sm" value={port} onChange={e => setPort(e.target.value)} bg="gray.800" borderColor="gray.600" color="white" placeholder="1433" />
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
            <Textarea
              value={originalSP}
              onChange={e => setOriginalSP(e.target.value)}
              placeholder="-- Paste your Stored Procedure here..."
              minH="240px"
              fontFamily="mono"
              fontSize="sm"
              bg="gray.950"
              color={mode === 'compare' ? 'red.200' : 'cyan.100'}
              borderColor="gray.600"
              _focus={{ borderColor: 'orange.500' }}
              _placeholder={{ color: 'gray.600' }}
              resize="vertical"
            />
          </Box>

          {mode === 'compare' && (
            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
              <Flex align="center" gap={2} mb={3}>
                <Badge colorPalette="green" variant="subtle">OPTIMIZED</Badge>
                <Text fontSize="sm" fontWeight="semibold" color="gray.300" textTransform="uppercase" letterSpacing="wider">Improved SP</Text>
              </Flex>
              <Textarea
                value={optimizedSP}
                onChange={e => setOptimizedSP(e.target.value)}
                placeholder="-- Paste your Optimized SP here..."
                minH="240px"
                fontFamily="mono"
                fontSize="sm"
                bg="gray.950"
                color="green.200"
                borderColor="gray.600"
                _focus={{ borderColor: 'green.500' }}
                _placeholder={{ color: 'gray.600' }}
                resize="vertical"
              />
            </Box>
          )}
        </Grid>

        {/* Execute button */}
        <Flex justify="flex-end" mb={8}>
          <Button
            colorPalette="orange"
            size="lg"
            px={10}
            onClick={handleExecute}
            loading={loading}
            loadingText="Executing..."
            disabled={!originalSP.trim() || (mode === 'compare' && !optimizedSP.trim()) || loading}
          >
            ▶ Execute & Audit
          </Button>
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column">
            <Spinner size="xl" color="orange.400" borderWidth="3px" />
            <Text color="gray.400">
              Executing SP{mode === 'compare' ? 's' : ''} and collecting STATISTICS IO / TIME data...
            </Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={5} mb={6}>
            <Text color="red.300" fontWeight="semibold">⚠️ Execution Failed</Text>
            <Text color="red.400" fontSize="sm" mt={1}>{error}</Text>
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box display="flex" flexDirection="column" gap={6}>

            {result.mode === 'single' ? (
              <>
                <AnalysisPanel analysis={result.analysis} title={`📊 Execution Analysis — ${result.execution.spLabel}`} />
                <RawStatsPanel execution={result.execution} />
              </>
            ) : (
              <>
                {/* Comparison improvement strip */}
                {result.comparison.improvementPercent !== undefined && (
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
                    <AnalysisPanel analysis={result.original} title="🔴 Original SP Audit" />
                    <RawStatsPanel execution={result.original.execution} />
                  </>
                )}
                {activeTab === 'optimized' && (
                  <>
                    <AnalysisPanel analysis={result.optimized} title="🟢 Optimized SP Audit" />
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
