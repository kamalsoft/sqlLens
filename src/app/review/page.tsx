'use client';

import { useState } from 'react';
import {
  Box, Container, Heading, Text, Textarea, Button, Flex,
  Spinner, Badge, Input,
} from '@chakra-ui/react';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { ReviewResult } from '@/lib/ai-transformer';

export default function ReviewPage() {
  const [sp, setSp] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [sharedToken, setSharedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleReview() {
    if (!sp.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSharedToken(null);
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storedProcedure: sp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data.result);
      setSharedToken(data.sharedToken);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyShareLink() {
    if (!sharedToken) return;
    navigator.clipboard.writeText(`${window.location.origin}/share/${sharedToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Box minH="100vh" bg="gray.950" color="white">
      <Container maxW="container.xl" py={10}>

        {/* Page Header */}
        <Box mb={8}>
          <Flex align="center" gap={3} mb={2}>
            <Badge colorPalette="blue" size="lg" px={3} py={1} borderRadius="full">R001</Badge>
            <Heading as="h1" size="2xl" bgGradient="to-r" gradientFrom="blue.400" gradientTo="cyan.400" bgClip="text">
              Review Stored Procedure
            </Heading>
          </Flex>
          <Text color="gray.400" fontSize="lg">
            Paste your SQL Stored Procedure to get a deep AI-powered analysis with bottleneck detection, 5 Why's, and an actionable verdict.
          </Text>
        </Box>

        {/* Input Area */}
        <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={6} mb={6}>
          <Text color="gray.300" fontSize="sm" fontWeight="semibold" mb={3} textTransform="uppercase" letterSpacing="wider">
            Stored Procedure SQL
          </Text>
          <Textarea
            value={sp}
            onChange={(e) => setSp(e.target.value)}
            placeholder={`-- Paste your Stored Procedure here
CREATE PROCEDURE usp_GetCustomerOrders
  @CustomerId INT
AS
BEGIN
  SELECT * FROM Orders WHERE CustomerId = @CustomerId
END`}
            minH="280px"
            fontFamily="mono"
            fontSize="sm"
            bg="gray.950"
            color="cyan.100"
            borderColor="gray.600"
            _focus={{ borderColor: 'blue.500', boxShadow: '0 0 0 1px var(--chakra-colors-blue-500)' }}
            _placeholder={{ color: 'gray.600' }}
            resize="vertical"
          />

          <Flex justify="space-between" align="center" mt={4}>
            <Text fontSize="xs" color="gray.500">{sp.length} characters</Text>
            <Flex gap={3}>
              {sp && (
                <Button variant="ghost" colorPalette="gray" size="sm" onClick={() => { setSp(''); setResult(null); setError(null); }}>
                  Clear
                </Button>
              )}
              <Button
                colorPalette="blue"
                size="md"
                onClick={handleReview}
                loading={loading}
                loadingText="Analyzing..."
                disabled={!sp.trim() || loading}
                px={8}
              >
                🔍 Analyze SP
              </Button>
            </Flex>
          </Flex>
        </Box>

        {/* Loading State */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column">
            <Spinner size="xl" color="blue.400" borderWidth="3px" />
            <Text color="gray.400">Running deep analysis on your Stored Procedure...</Text>
          </Flex>
        )}

        {/* Error State */}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={5} mb={6}>
            <Text color="red.300" fontWeight="semibold">⚠️ Analysis Failed</Text>
            <Text color="red.400" fontSize="sm" mt={1}>{error}</Text>
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box>
            {/* Share bar */}
            {sharedToken && (
              <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="xl" p={4} mb={6}>
                <Flex align="center" gap={3}>
                  <Text color="gray.400" fontSize="sm" flexShrink={0}>🔗 Shareable link:</Text>
                  <Input
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/${sharedToken}`}
                    size="sm"
                    bg="gray.950"
                    borderColor="gray.600"
                    color="blue.300"
                    fontFamily="mono"
                    fontSize="xs"
                  />
                  <Button size="sm" colorPalette={copied ? 'green' : 'blue'} variant="outline" onClick={copyShareLink} flexShrink={0}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </Button>
                </Flex>
              </Box>
            )}

            <ReviewPanel result={result} title="🔬 SP Analysis Results" />
          </Box>
        )}
      </Container>
    </Box>
  );
}
