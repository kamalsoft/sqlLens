'use client';

import { useEffect, useState } from 'react';
import { Box, Container, Heading, Text, Spinner, Flex, Badge } from '@chakra-ui/react';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { ReviewResult, CompareResult } from '@/lib/ai-transformer';

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ token }) => {
      fetch(`/api/share/${token}`)
        .then(r => r.json())
        .then(d => { setData(d); setLoading(false); })
        .catch(e => { setError(e.message); setLoading(false); });
    });
  }, [params]);

  return (
    <Box minH="100vh" bg="gray.950" color="white">
      <Container maxW="container.xl" py={10}>
        {loading && (
          <Flex justify="center" align="center" py={20} gap={4} direction="column">
            <Spinner size="xl" color="blue.400" borderWidth="3px" />
            <Text color="gray.400">Loading shared result...</Text>
          </Flex>
        )}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={6}>
            <Text color="red.300" fontWeight="semibold">Result not found</Text>
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
            {data.type === 'REVIEW' && <ReviewPanel result={data.result as ReviewResult} title="🔬 Shared SP Analysis" />}
            {data.type === 'COMPARE' && (
              <Box display="flex" flexDirection="column" gap={6}>
                <ReviewPanel result={(data.result as CompareResult).original} title="🔴 Original SP" />
                <ReviewPanel result={(data.result as CompareResult).optimized} title="🟢 Optimized SP" />
              </Box>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
