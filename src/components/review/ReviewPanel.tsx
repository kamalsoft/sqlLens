'use client';

import { ReviewResult } from '@/lib/ai-transformer';
import {
  Box, Heading, Text, Badge, List, Separator, Grid, GridItem,
  Accordion,
} from '@chakra-ui/react';

interface Props {
  result: ReviewResult;
  title?: string;
}

export function ReviewPanel({ result, title = 'Analysis Results' }: Props) {
  const verdictColor =
    result.verdict.startsWith('✅') ? 'green' :
    result.verdict.startsWith('⚠️') ? 'yellow' : 'red';

  return (
    <Box borderWidth="1px" borderColor="gray.700" borderRadius="xl" overflow="hidden" bg="gray.850">
      {/* Header */}
      <Box bg="gray.800" px={6} py={4} borderBottomWidth="1px" borderColor="gray.700">
        <Heading size="md" color="white">{title}</Heading>
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={6}>

        {/* Summary */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="blue.400" mb={2} textTransform="uppercase" letterSpacing="wider">Summary</Text>
          <Text color="gray.200" lineHeight="tall">{result.summary}</Text>
        </Box>

        <Separator borderColor="gray.700" />

        {/* Verdict */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="blue.400" mb={2} textTransform="uppercase" letterSpacing="wider">Verdict</Text>
          <Box p={4} borderRadius="lg" bg={`${verdictColor}.950`} borderWidth="1px" borderColor={`${verdictColor}.700`}>
            <Text color={`${verdictColor}.300`} fontWeight="semibold">{result.verdict}</Text>
          </Box>
        </Box>

        <Separator borderColor="gray.700" />

        {/* Bottlenecks */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="red.400" mb={3} textTransform="uppercase" letterSpacing="wider">
            🚨 Bottlenecks ({result.bottlenecks.length})
          </Text>
          <List.Root gap={2}>
            {result.bottlenecks.map((b, i) => (
              <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                <Badge colorPalette="red" variant="subtle" mt="1px">{i + 1}</Badge>
                <Text color="red.200" fontSize="sm">{b}</Text>
              </List.Item>
            ))}
          </List.Root>
        </Box>

        <Separator borderColor="gray.700" />

        {/* Pros & Cons */}
        <Grid templateColumns="1fr 1fr" gap={4}>
          <GridItem>
            <Text fontSize="sm" fontWeight="semibold" color="green.400" mb={3} textTransform="uppercase" letterSpacing="wider">✅ Pros</Text>
            <List.Root gap={2}>
              {result.prosAndCons.pros.map((p, i) => (
                <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                  <Text color="green.400" mt="1px">+</Text>
                  <Text color="gray.300" fontSize="sm">{p}</Text>
                </List.Item>
              ))}
            </List.Root>
          </GridItem>
          <GridItem>
            <Text fontSize="sm" fontWeight="semibold" color="red.400" mb={3} textTransform="uppercase" letterSpacing="wider">❌ Cons</Text>
            <List.Root gap={2}>
              {result.prosAndCons.cons.map((c, i) => (
                <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                  <Text color="red.400" mt="1px">−</Text>
                  <Text color="gray.300" fontSize="sm">{c}</Text>
                </List.Item>
              ))}
            </List.Root>
          </GridItem>
        </Grid>

        <Separator borderColor="gray.700" />

        {/* Recommendations */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="blue.400" mb={3} textTransform="uppercase" letterSpacing="wider">💡 Recommendations</Text>
          <List.Root gap={2}>
            {result.recommendations.map((r, i) => (
              <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                <Badge colorPalette="blue" variant="subtle" mt="1px">{i + 1}</Badge>
                <Text color="gray.200" fontSize="sm">{r}</Text>
              </List.Item>
            ))}
          </List.Root>
        </Box>

        <Separator borderColor="gray.700" />

        {/* 5 Whys */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="purple.400" mb={3} textTransform="uppercase" letterSpacing="wider">🔍 5 Why's Analysis</Text>
          <Box display="flex" flexDirection="column" gap={3}>
            {result.fiveWhys.map((w, i) => (
              <Box key={i} p={4} bg="gray.800" borderRadius="lg" borderLeftWidth="3px" borderColor="purple.500">
                <Text color="purple.300" fontSize="sm" fontWeight="semibold" mb={1}>Why {i + 1}: {w.why}</Text>
                <Text color="gray.300" fontSize="sm">{w.answer}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        <Separator borderColor="gray.700" />

        {/* Deep Dive */}
        <Accordion.Root collapsible>
          <Accordion.Item value="deep-dive">
            <Accordion.ItemTrigger>
              <Text fontSize="sm" fontWeight="semibold" color="cyan.400" textTransform="uppercase" letterSpacing="wider">
                🔬 Deep Dive Analysis
              </Text>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Box pt={3}>
                {result.deepDive.split('\n\n').map((para, i) => (
                  para.startsWith('##')
                    ? <Text key={i} color="cyan.300" fontWeight="semibold" mt={i > 0 ? 4 : 0} mb={2}>{para.replace(/^##\s*/, '')}</Text>
                    : <Text key={i} color="gray.300" fontSize="sm" lineHeight="tall" mb={2}>{para}</Text>
                ))}
              </Box>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>

      </Box>
    </Box>
  );
}
