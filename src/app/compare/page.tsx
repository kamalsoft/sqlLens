'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Box, Container, Heading, Text, Textarea, Button, Flex,
  Spinner, Badge, Grid, GridItem,
} from '@chakra-ui/react';
import { useApi } from '@/components/api-client';
import type { MetricComparison } from '@/lib/audit-analyzer';
import { COMPARE_SCHEMA_VERSION, type CompareModelResult } from '@/lib/compare';
import { NOT_SQL_ERROR, looksLikeSql } from '@/lib/validation/sql-input';

type Model = { id: string; name: string; compatible: boolean };

type CompareResponse = {
  id?: string;
  model?: string;
  schemaVersion?: string;
  metrics?: MetricComparison | null;
  result: CompareModelResult;
};

const WINNER_LABEL: Record<CompareModelResult['winner'], { text: string; tone: string }> = {
  original: { text: 'Original SP is better', tone: 'status.warn' },
  optimized: { text: 'Optimized SP is better', tone: 'status.ok' },
  inconclusive: { text: 'Inconclusive', tone: 'fg.muted' },
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
    if (res.ok && res.data?.result && res.data.schemaVersion === COMPARE_SCHEMA_VERSION) {
      setResponse(res.data);
    } else if (res.ok && res.data?.result) {
      setError(`Unsupported comparison result version: ${res.data.schemaVersion ?? 'unknown'}`);
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
    <Box color="fg.default">
      <Container maxW="container.xl" p={0}>

        {/* Page Header */}
        <header className="page-header">
          <div>
            <p className="page-kicker">Comparison</p>
            <h2 className="page-title">Compare Stored Procedures</h2>
            <p className="analysis-note">Compare the current and optimized SP side by side with a local model: a verdict, the differences, and the risks of the change. Performance claims need execution metrics.</p>
          </div>
        </header>

        {/* Model */}
        <Box mb={5}>
          <label htmlFor="compare-model" style={{ display: 'block', marginBottom: 8, color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>
            Model
          </label>
          <select
            id="compare-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={models.length === 0}
            style={{ width: '100%', maxWidth: 520, padding: '8px 10px', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--panel-border)' }}
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
            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5} h="full">
              <Flex align="center" gap={2} mb={3}>
                <Badge variant="outline" color="accent.default" borderColor="accent.default">ORIGINAL</Badge>
                <Text color="fg.default" fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
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
                bg="bg.canvas"
                color="fg.default"
                borderColor="border.subtle"
                _focus={{ borderColor: 'accent.default', boxShadow: '0 0 0 1px var(--chakra-colors-accent-default)' }}
                _placeholder={{ color: 'fg.muted' }}
                resize="vertical"
              />
              <Text fontSize="xs" color="fg.muted" mt={2}>{original.length} characters</Text>
            </Box>
          </GridItem>

          <GridItem>
            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5} h="full">
              <Flex align="center" gap={2} mb={3}>
                <Badge variant="outline" color="status.ok" borderColor="status.ok">OPTIMIZED</Badge>
                <Text color="fg.default" fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
                  Optimized SP
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
                bg="bg.canvas"
                color="fg.default"
                borderColor="border.subtle"
                _focus={{ borderColor: 'accent.default', boxShadow: '0 0 0 1px var(--chakra-colors-accent-default)' }}
                _placeholder={{ color: 'fg.muted' }}
                resize="vertical"
              />
              <Text fontSize="xs" color="fg.muted" mt={2}>{optimized.length} characters</Text>
            </Box>
          </GridItem>
        </Grid>

        {/* Action */}
        <Flex justify="flex-end" mb={8}>
          <Button
            colorPalette="brand"
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
            <Spinner size="xl" color="accent.default" borderWidth="3px" />
            <Text color="fg.muted">Running comparative deep analysis on both Stored Procedures...</Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="bg.raised" borderWidth="1px" borderColor="status.bad" borderRadius="xl" p={5} mb={6} role="alert">
            <Text color="status.bad" fontWeight="semibold">⚠️ Comparison Failed</Text>
            <Text color="status.bad" fontSize="sm" mt={1}>{error}</Text>
            {details && (
              <Box as="pre" aria-label="Response preview" mt={3} p={3} bg="bg.canvas" borderRadius="md" fontSize="xs" color="fg.default" whiteSpace="pre-wrap" overflowWrap="anywhere" maxH="320px" overflow="auto">
                {details}
              </Box>
            )}
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box>
            {response?.id && (
              <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={4} mb={6}>
                <Text color="fg.muted" fontSize="sm">
                  To share this result, open it from the{' '}
                  <Link href={`/audit/${response.id}`} style={{ textDecoration: 'underline' }}>audit record</Link>.
                </Text>
              </Box>
            )}

            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5} mb={5}>
              <Flex align="center" gap={3} wrap="wrap" mb={3}>
                <Text fontSize="xs" color="fg.muted" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">Verdict</Text>
                <Badge variant="outline" color={WINNER_LABEL[result.winner].tone} borderColor={WINNER_LABEL[result.winner].tone} size="lg" data-testid="compare-winner">
                  {WINNER_LABEL[result.winner].text}
                </Badge>
                <Text fontSize="sm" color="fg.muted">Confidence {Math.round(result.confidence * 100)}%</Text>
              </Flex>
              <Text color="fg.default" overflowWrap="anywhere">{result.summary}</Text>
            </Box>

            <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={5} mb={5}>
              <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
                <Heading as="h3" size="sm" color="fg.default" mb={3}>Differences ({result.differences.length})</Heading>
                {result.differences.length === 0 ? (
                  <Text color="fg.muted" fontSize="sm">None reported.</Text>
                ) : (
                  <Box as="ul" pl={5} color="fg.default" fontSize="sm" overflowWrap="anywhere">
                    {result.differences.map((d, i) => <li key={i}>{d}</li>)}
                  </Box>
                )}
              </Box>
              <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
                <Heading as="h3" size="sm" color="fg.default" mb={3}>Risks of the change ({result.risks.length})</Heading>
                {result.risks.length === 0 ? (
                  <Text color="fg.muted" fontSize="sm">None reported.</Text>
                ) : (
                  <Box as="ul" pl={5} color="fg.default" fontSize="sm" overflowWrap="anywhere">
                    {result.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </Box>
                )}
              </Box>
            </Grid>

            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
              <Heading as="h3" size="sm" color="fg.default" mb={3}>Execution metrics</Heading>
              {metricRows.length === 0 ? (
                <Text color="fg.muted" fontSize="sm">
                  No execution metrics were captured, so the verdict is based on the code only. Run both procedures on the Execute page and compare their audit records for measured results.
                </Text>
              ) : (
                <Box overflowX="auto">
                  <table aria-label="Execution metrics" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr>{['Metric', 'Original', 'Optimized', 'Change'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)' }}>{h}</th>)}</tr>
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
