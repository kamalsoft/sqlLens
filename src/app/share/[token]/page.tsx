'use client';

import { useEffect, useState } from 'react';
import { Box, Container, Heading, Text, Spinner, Flex, Badge } from '@chakra-ui/react';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { useApi } from '@/components/api-client';
import { CompareVerdict } from '@/components/compare/CompareVerdict';
import type { MetricComparison } from '@/lib/audit-analyzer';
import type { CompareModelResult } from '@/lib/compare';
import type { ReviewResult, CompareResult } from '@/lib/ai-transformer';

type SharedData = (
  | { type: 'REVIEW'; result: ReviewResult }
  | { type: 'COMPARE'; result: CompareSharePayload | CompareResult }
  | { type: string; result: unknown }
) & { expiresAt?: string | null };

/** Stored compare-v1 audit payload: the verdict plus the metrics it was based on. */
type CompareSharePayload = { result?: CompareModelResult; metrics?: MetricComparison | null };

function CompareShare({ data }: { data: CompareSharePayload | CompareResult }) {
  const payload = data as CompareSharePayload;
  if (payload.result && 'winner' in payload.result) {
    return <CompareVerdict result={payload.result} metrics={payload.metrics ?? null} />;
  }
  // Older shared comparisons stored the two reviews side by side.
  const legacy = data as CompareResult;
  if (legacy.original && legacy.optimized) {
    return (
      <Box display="flex" flexDirection="column" gap={6}>
        <ReviewPanel result={legacy.original} title="🔴 Original SP" />
        <ReviewPanel result={legacy.optimized} title="🟢 Optimized SP" />
      </Box>
    );
  }
  return (
    <Text color="red.300" role="alert">This shared comparison uses a format this page cannot show.</Text>
  );
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const api = useApi();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void params.then(async ({ token }) => {
      const result = await api<SharedData>(
        `/api/share/${encodeURIComponent(token)}`,
        { cache: 'no-store' },
        'Unable to load shared result'
      );
      if (cancelled) return;
      if (result.ok && result.data) setData(result.data);
      else if (result.status === 404) setError('Link not found or revoked.');
      else if (result.status === 410) setError('Link expired.');
      else if (result.status !== 401) setError(result.error ?? 'Unable to load shared result');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [params, api]);

  return (
    <Box minH="100vh" bg="gray.950" color="white">
      <Container maxW="container.xl" py={10}>
        {loading && (
          <Flex justify="center" align="center" py={20} gap={4} direction="column" role="status">
            <Spinner size="xl" color="blue.400" borderWidth="3px" />
            <Text color="gray.400">Loading shared result...</Text>
          </Flex>
        )}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={6} role="alert">
            <Text color="red.300" fontWeight="semibold">Shared result unavailable</Text>
            <Text color="red.400" fontSize="sm" mt={1}>{error}</Text>
          </Box>
        )}
        {data && !loading && (
          <Box>
            <Flex align="center" gap={3} mb={8}>
              <Badge colorPalette={data.type === 'REVIEW' ? 'blue' : 'purple'} size="lg" px={3} py={1} borderRadius="full">
                {data.type}
              </Badge>
              <Heading size="xl" color="white">Shared SQLLens Result</Heading>
            </Flex>
            {data.expiresAt && (
              <Text color="gray.400" fontSize="sm" mb={4}>
                Expires {new Date(data.expiresAt).toLocaleString()}
              </Text>
            )}
            {data.type === 'REVIEW' && <ReviewPanel result={data.result as ReviewResult} title="🔬 Shared SP Analysis" />}
            {data.type === 'COMPARE' && <CompareShare data={data.result as CompareSharePayload | CompareResult} />}
          </Box>
        )}
      </Container>
    </Box>
  );
}
