'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Box, Container, Heading, Text, Textarea, Button, Flex,
  Spinner, Badge, Grid, GridItem,
} from '@chakra-ui/react';
import { useApi } from '@/components/api-client';
import type { MetricComparison } from '@/lib/audit-analyzer';
import type { CompareModelResult } from '@/lib/compare';
import { NOT_SQL_ERROR, looksLikeSql } from '@/lib/validation/sql-input';

type Model = { id: string; name: string; compatible: boolean };

type CompareResponse = {
  id?: string;
  model?: string;
  metrics?: MetricComparison | null;
  result: CompareModelResult;
};

const WINNER_LABEL: Record<CompareModelResult['winner'], { text: string; palette: string }> = {
  original: { text: 'Original SP is better', palette: 'red' },
  optimized: { text: 'Improved SP is better', palette: 'green' },
  inconclusive: { text: 'Inconclusive', palette: 'gray' },
};

export default function ComparePage() {
  const api = useApi();
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [original, setOriginal] = useState('');
  const [optimized, setOptimized] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api<{ models?: Model[] }>('/api/review/models', { cache: 'no-store' }, 'Unable to load installed models').then(
      (res) => {
        if (cancelled) return;
        if (res.ok) {
          const compatible = (res.data?.models ?? []).filter((m) => m.compatible);
          setModels(compatible);
          setModelId(compatible[0]?.id ?? '');
        } else if (res.status !== 401) {
          setError(res.error ?? 'Unable to load installed models');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function handleCompare() {
    if (!original.trim() || !optimized.trim()) return;
    setError(null);
    setDetails('');
    setResponse(null);
    if (!modelId) {
      setError('Select an installed model.');
      return;
    }
    if (!looksLikeSql(original) || !looksLikeSql(optimized)) {
      setError(NOT_SQL_ERROR);
      return;
    }
    setLoading(true);
    const res = await api<CompareResponse>(
      '/api/compare',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, original, optimized }),
      },
      'Comparison failed'
    );
    if (res.ok && res.data?.result) {
      setResponse(res.data);
    } else if (res.status !== 401) {
      setError(res.error ?? 'Comparison failed');
      const d = res.details as { responsePreview?: unknown; message?: unknown } | null;
      if (res.status === 502 && d && typeof d.responsePreview === 'string') {
        setDetails([d.responsePreview, typeof d.message === 'string' ? `Validation: ${d.message.split('; response ended with:')[0]}` : '']
          .filter(Boolean)
          .join('\n\n'));
      }
    }
    setLoading(false);
  }

  const result = response?.result;
  const metricRows = Object.entries(response?.metrics ?? {}).filter(
    ([, m]) => m && (m.original !== null || m.optimized !== null),
  );

  return (
    <Box minH="100vh" bg="gray.950" color="white">
      <Container maxW="container.xl" py={10}>

        {/* Page Header */}
        <Box mb={8}>
          <Flex align="center" gap={3} mb={2}>
            <Badge colorPalette="purple" size="lg" px={3} py={1} borderRadius="full">R002</Badge>
            <Heading as="h1" size="2xl" bgGradient="to-r" gradientFrom="purple.400" gradientTo="pink.400" bgClip="text">
              Compare Stored Procedures
            </Heading>
          </Flex>
          <Text color="gray.400" fontSize="lg">
            Compare the current and improved SP side by side with a local model: a verdict, the differences, and the risks of the change. Performance claims need execution metrics.
          </Text>
        </Box>

        {/* Model */}
        <Box mb={5}>
          <label htmlFor="compare-model" style={{ display: 'block', marginBottom: 8, color: '#cbd5e1', fontSize: 14, fontWeight: 600 }}>
            Model
          </label>
          <select
            id="compare-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={models.length === 0}
            style={{ width: '100%', maxWidth: 520, padding: '8px 10px', borderRadius: 8, background: '#020617', color: '#e5e7eb', border: '1px solid #475569' }}
          >
            {models.length === 0 ? (
              <option value="">No compatible model installed</option>
            ) : (
              models.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))
            )}
          </select>
        </Box>

        {/* Input Grid */}
        <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={5} mb={6}>
          <GridItem>
            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5} h="full">
              <Flex align="center" gap={2} mb={3}>
                <Badge colorPalette="red" variant="subtle">ORIGINAL</Badge>
                <Text color="gray.300" fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
                  Current SP
                </Text>
              </Flex>
              <Textarea
                value={original}
                onChange={(e) => setOriginal(e.target.value)}
                placeholder={`CREATE PROCEDURE usp_GetOrders
AS
BEGIN
  DECLARE @id INT
  DECLARE cur CURSOR FOR SELECT id FROM Orders
  OPEN cur
  FETCH NEXT FROM cur INTO @id
  WHILE @@FETCH_STATUS = 0 BEGIN
    -- row-by-row processing...
    FETCH NEXT FROM cur INTO @id
  END
  CLOSE cur
  DEALLOCATE cur
END`}
                minH="260px"
                fontFamily="mono"
                fontSize="sm"
                bg="gray.950"
                color="red.200"
                borderColor="gray.600"
                _focus={{ borderColor: 'red.500', boxShadow: '0 0 0 1px var(--chakra-colors-red-500)' }}
                _placeholder={{ color: 'gray.600' }}
                resize="vertical"
              />
              <Text fontSize="xs" color="gray.500" mt={2}>{original.length} characters</Text>
            </Box>
          </GridItem>

          <GridItem>
            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5} h="full">
              <Flex align="center" gap={2} mb={3}>
                <Badge colorPalette="green" variant="subtle">OPTIMIZED</Badge>
                <Text color="gray.300" fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
                  Improved SP
                </Text>
              </Flex>
              <Textarea
                value={optimized}
                onChange={(e) => setOptimized(e.target.value)}
                placeholder={`CREATE PROCEDURE usp_GetOrders_v2
AS
BEGIN
  SET NOCOUNT ON
  SELECT
    o.id, o.customer_id, o.total
  FROM Orders o WITH (NOLOCK)
  WHERE o.status = 'ACTIVE'
END`}
                minH="260px"
                fontFamily="mono"
                fontSize="sm"
                bg="gray.950"
                color="green.200"
                borderColor="gray.600"
                _focus={{ borderColor: 'green.500', boxShadow: '0 0 0 1px var(--chakra-colors-green-500)' }}
                _placeholder={{ color: 'gray.600' }}
                resize="vertical"
              />
              <Text fontSize="xs" color="gray.500" mt={2}>{optimized.length} characters</Text>
            </Box>
          </GridItem>
        </Grid>

        {/* Action */}
        <Flex justify="flex-end" mb={8}>
          <Button
            colorPalette="purple"
            size="lg"
            px={10}
            onClick={handleCompare}
            loading={loading}
            loadingText="Comparing..."
            disabled={!original.trim() || !optimized.trim() || !modelId || loading}
          >
            ⚡ Compare SPs
          </Button>
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column" role="status">
            <Spinner size="xl" color="purple.400" borderWidth="3px" />
            <Text color="gray.400">Running comparative deep analysis on both Stored Procedures...</Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={5} mb={6} role="alert">
            <Text color="red.300" fontWeight="semibold">⚠️ Comparison Failed</Text>
            <Text color="red.400" fontSize="sm" mt={1}>{error}</Text>
            {details && (
              <Box as="pre" aria-label="Response preview" mt={3} p={3} bg="gray.950" borderRadius="md" fontSize="xs" color="gray.300" whiteSpace="pre-wrap" overflowWrap="anywhere" maxH="320px" overflow="auto">
                {details}
              </Box>
            )}
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box>
            {response?.id && (
              <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={4} mb={6}>
                <Text color="gray.400" fontSize="sm">
                  To share this result, open it from the{' '}
                  <Link href={`/audit/${response.id}`} style={{ textDecoration: 'underline' }}>audit record</Link>.
                </Text>
              </Box>
            )}

            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5} mb={5}>
              <Flex align="center" gap={3} wrap="wrap" mb={3}>
                <Text fontSize="xs" color="gray.400" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">Verdict</Text>
                <Badge colorPalette={WINNER_LABEL[result.winner].palette} size="lg" data-testid="compare-winner">
                  {WINNER_LABEL[result.winner].text}
                </Badge>
                <Text fontSize="sm" color="gray.400">Confidence {Math.round(result.confidence * 100)}%</Text>
              </Flex>
              <Text color="gray.100" overflowWrap="anywhere">{result.summary}</Text>
            </Box>

            <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={5} mb={5}>
              <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
                <Heading as="h3" size="sm" color="gray.300" mb={3}>Differences ({result.differences.length})</Heading>
                {result.differences.length === 0 ? (
                  <Text color="gray.500" fontSize="sm">None reported.</Text>
                ) : (
                  <Box as="ul" pl={5} color="gray.200" fontSize="sm" overflowWrap="anywhere">
                    {result.differences.map((d, i) => <li key={i}>{d}</li>)}
                  </Box>
                )}
              </Box>
              <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
                <Heading as="h3" size="sm" color="gray.300" mb={3}>Risks of the change ({result.risks.length})</Heading>
                {result.risks.length === 0 ? (
                  <Text color="gray.500" fontSize="sm">None reported.</Text>
                ) : (
                  <Box as="ul" pl={5} color="gray.200" fontSize="sm" overflowWrap="anywhere">
                    {result.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </Box>
                )}
              </Box>
            </Grid>

            <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={5}>
              <Heading as="h3" size="sm" color="gray.300" mb={3}>Execution metrics</Heading>
              {metricRows.length === 0 ? (
                <Text color="gray.500" fontSize="sm">
                  No execution metrics were captured, so the verdict is based on the code only. Run both procedures on the Execute page and compare their audit records for measured results.
                </Text>
              ) : (
                <Box overflowX="auto">
                  <table aria-label="Execution metrics" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr>{['Metric', 'Original', 'Improved', 'Change'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#94a3b8' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {metricRows.map(([name, m]) => (
                        <tr key={name}>
                          <td style={{ padding: '6px 8px' }}>{name}</td>
                          <td style={{ padding: '6px 8px' }}>{m.original ?? 'not captured'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.optimized ?? 'not captured'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.deltaPct === null || m.deltaPct === undefined ? '—' : `${m.deltaPct}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Container>
    </Box>
  );
}
