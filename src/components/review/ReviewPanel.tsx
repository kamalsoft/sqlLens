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
    result.verdict.startsWith('✅') ? 'status.ok' :
    result.verdict.startsWith('⚠️') ? 'status.warn' : 'status.bad';

  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="xl" overflow="hidden" bg="bg.panel">
      {/* Header */}
      <Box bg="bg.raised" px={6} py={4} borderBottomWidth="1px" borderColor="border.subtle">
        <Heading size="md" color="fg.default">{title}</Heading>
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={6}>

        {/* Summary */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={2} textTransform="uppercase" letterSpacing="wider">Summary</Text>
          <Text color="fg.default" lineHeight="tall">{result.summary}</Text>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* Verdict */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={2} textTransform="uppercase" letterSpacing="wider">Verdict</Text>
          <Box p={4} borderRadius="lg" bg="bg.raised" borderWidth="1px" borderColor={verdictColor}>
            <Text color={verdictColor} fontWeight="semibold">{result.verdict}</Text>
          </Box>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* Bottlenecks */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="status.bad" mb={3} textTransform="uppercase" letterSpacing="wider">
            🚨 Bottlenecks ({result.bottlenecks.length})
          </Text>
          <List.Root gap={2}>
            {result.bottlenecks.map((b, i) => (
              <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                <Badge variant="outline" color="status.bad" borderColor="status.bad" mt="1px">{i + 1}</Badge>
                <Text color="status.bad" fontSize="sm">{b}</Text>
              </List.Item>
            ))}
          </List.Root>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* Pros & Cons */}
        <Grid templateColumns="1fr 1fr" gap={4}>
          <GridItem>
            <Text fontSize="sm" fontWeight="semibold" color="status.ok" mb={3} textTransform="uppercase" letterSpacing="wider">✅ Pros</Text>
            <List.Root gap={2}>
              {result.prosAndCons.pros.map((p, i) => (
                <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                  <Text color="status.ok" mt="1px">+</Text>
                  <Text color="fg.default" fontSize="sm">{p}</Text>
                </List.Item>
              ))}
            </List.Root>
          </GridItem>
          <GridItem>
            <Text fontSize="sm" fontWeight="semibold" color="status.bad" mb={3} textTransform="uppercase" letterSpacing="wider">❌ Cons</Text>
            <List.Root gap={2}>
              {result.prosAndCons.cons.map((c, i) => (
                <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                  <Text color="status.bad" mt="1px">−</Text>
                  <Text color="fg.default" fontSize="sm">{c}</Text>
                </List.Item>
              ))}
            </List.Root>
          </GridItem>
        </Grid>

        <Separator borderColor="border.subtle" />

        {/* Recommendations */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">💡 Recommendations</Text>
          <List.Root gap={2}>
            {result.recommendations.map((r, i) => (
              <List.Item key={i} display="flex" alignItems="flex-start" gap={2}>
                <Badge colorPalette="brand" variant="subtle" mt="1px">{i + 1}</Badge>
                <Text color="fg.default" fontSize="sm">{r}</Text>
              </List.Item>
            ))}
          </List.Root>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* 5 Whys */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">🔍 5 Why&apos;s Analysis</Text>
          <Box display="flex" flexDirection="column" gap={3}>
            {result.fiveWhys.map((w, i) => (
              <Box key={i} p={4} bg="bg.raised" borderRadius="lg" borderLeftWidth="3px" borderColor="accent.default">
                <Text color="accent.default" fontSize="sm" fontWeight="semibold" mb={1}>Why {i + 1}: {w.why}</Text>
                <Text color="fg.default" fontSize="sm">{w.answer}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* Deep Dive */}
        <Accordion.Root collapsible>
          <Accordion.Item value="deep-dive">
            <Accordion.ItemTrigger>
              <Text fontSize="sm" fontWeight="semibold" color="accent.default" textTransform="uppercase" letterSpacing="wider">
                🔬 Deep Dive Analysis
              </Text>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Box pt={3}>
                {result.deepDive.split('\n\n').map((para, i) => (
                  para.startsWith('##')
                    ? <Text key={i} color="accent.default" fontWeight="semibold" mt={i > 0 ? 4 : 0} mb={2}>{para.replace(/^##\s*/, '')}</Text>
                    : <Text key={i} color="fg.default" fontSize="sm" lineHeight="tall" mb={2}>{para}</Text>
                ))}
              </Box>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>

      </Box>
    </Box>
  );
}
