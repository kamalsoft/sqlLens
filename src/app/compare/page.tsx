'use client';

import { useState } from 'react';
import {
  Box, Container, Heading, Text, Textarea, Button, Flex,
  Spinner, Badge, Grid, GridItem, Input, Separator,
} from '@chakra-ui/react';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { CompareResult } from '@/lib/ai-transformer';

export default function ComparePage() {
  const [original, setOriginal] = useState('');
  const [optimized, setOptimized] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [sharedToken, setSharedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'original' | 'optimized'>('summary');

  async function handleCompare() {
    if (!original.trim() || !optimized.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSharedToken(null);
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, optimized }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Comparison failed');
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
            <Badge colorPalette="purple" size="lg" px={3} py={1} borderRadius="full">R002</Badge>
            <Heading as="h1" size="2xl" bgGradient="to-r" gradientFrom="purple.400" gradientTo="pink.400" bgClip="text">
              Compare Stored Procedures
            </Heading>
          </Flex>
          <Text color="gray.400" fontSize="lg">
            Compare the original vs optimized SP side by side. Get bottleneck analysis, 5 Why's, and a production-readiness verdict.
          </Text>
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
            disabled={!original.trim() || !optimized.trim() || loading}
          >
            ⚡ Compare SPs
          </Button>
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column">
            <Spinner size="xl" color="purple.400" borderWidth="3px" />
            <Text color="gray.400">Running comparative deep analysis on both Stored Procedures...</Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="red.950" borderWidth="1px" borderColor="red.700" borderRadius="xl" p={5} mb={6}>
            <Text color="red.300" fontWeight="semibold">⚠️ Comparison Failed</Text>
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
                    color="purple.300"
                    fontFamily="mono"
                    fontSize="xs"
                  />
                  <Button size="sm" colorPalette={copied ? 'green' : 'purple'} variant="outline" onClick={copyShareLink} flexShrink={0}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </Button>
                </Flex>
              </Box>
            )}

            {/* Tabs */}
            <Flex gap={2} mb={6}>
              {(['summary', 'original', 'optimized'] as const).map((tab) => (
                <Button
                  key={tab}
                  size="sm"
                  variant={activeTab === tab ? 'solid' : 'outline'}
                  colorPalette={tab === 'original' ? 'red' : tab === 'optimized' ? 'green' : 'purple'}
                  onClick={() => setActiveTab(tab)}
                  textTransform="capitalize"
                >
                  {tab === 'summary' ? '📊 Comparison Summary' : tab === 'original' ? '🔴 Original Analysis' : '🟢 Optimized Analysis'}
                </Button>
              ))}
            </Flex>

            {activeTab === 'summary' && (
              <Box>
                {/* Quick verdict strip */}
                <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={5} mb={6}>
                  <Box p={5} bg="red.950" borderRadius="xl" borderWidth="1px" borderColor="red.800">
                    <Text fontSize="xs" color="red.400" fontWeight="semibold" mb={2} textTransform="uppercase">Original SP Verdict</Text>
                    <Text color="red.200" fontSize="sm">{result.original.verdict}</Text>
                  </Box>
                  <Box p={5} bg="green.950" borderRadius="xl" borderWidth="1px" borderColor="green.800">
                    <Text fontSize="xs" color="green.400" fontWeight="semibold" mb={2} textTransform="uppercase">Optimized SP Verdict</Text>
                    <Text color="green.200" fontSize="sm">{result.optimized.verdict}</Text>
                  </Box>
                </Grid>

                <ReviewPanel
                  result={{
                    summary: result.summary,
                    bottlenecks: result.bottlenecks,
                    prosAndCons: result.prosAndCons,
                    recommendations: result.recommendations,
                    fiveWhys: result.fiveWhys,
                    deepDive: result.deepDive,
                    verdict: result.verdict,
                  }}
                  title="📊 Comparison Summary"
                />
              </Box>
            )}

            {activeTab === 'original' && (
              <ReviewPanel result={result.original} title="🔴 Original SP Deep Analysis" />
            )}

            {activeTab === 'optimized' && (
              <ReviewPanel result={result.optimized} title="🟢 Optimized SP Deep Analysis" />
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
