import { Badge, Box, Heading, Text } from '@chakra-ui/react';
import type { MetricComparison, MetricName } from '@/lib/audit-analyzer';
import type { CompareModelResult } from '@/lib/compare';

const WINNER_LABEL: Record<CompareModelResult['winner'], { text: string; tone: string }> = {
  original: { text: 'Original SP is better', tone: 'status.warn' },
  optimized: { text: 'Optimized SP is better', tone: 'status.ok' },
  inconclusive: { text: 'Inconclusive', tone: 'fg.muted' },
};

const METRIC_LABEL: Record<MetricName, string> = {
  logicalReads: 'Logical reads',
  physicalReads: 'Physical reads',
  scanCount: 'Scan count',
  cpu: 'CPU',
  elapsed: 'Elapsed',
};

/** Shows a compare-v1 verdict: winner, confidence, summary, differences, risks and metrics. */
export function CompareVerdict({
  result,
  metrics,
}: {
  result: CompareModelResult;
  metrics: MetricComparison | null;
}) {
  const rows = Object.entries(metrics ?? {}).filter(
    ([, m]) => m && (m.original !== null || m.optimized !== null),
  ) as [MetricName, MetricComparison[MetricName]][];

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6}>
        <Badge variant="outline" color={WINNER_LABEL[result.winner].tone} borderColor={WINNER_LABEL[result.winner].tone} size="lg" data-testid="compare-winner">
          {WINNER_LABEL[result.winner].text}
        </Badge>
        <Text fontSize="sm" color="fg.muted" mt={2}>Confidence {Math.round(result.confidence * 100)}%</Text>
        <Text color="fg.default" mt={3} overflowWrap="anywhere">{result.summary}</Text>
      </Box>

      <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6}>
        <Heading as="h3" size="sm" color="fg.default" mb={3}>Differences ({result.differences.length})</Heading>
        {result.differences.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">None reported.</Text>
        ) : (
          <Box as="ul" pl={5} color="fg.default" fontSize="sm">
            {result.differences.map((d, i) => <li key={i}>{d}</li>)}
          </Box>
        )}
      </Box>

      <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6}>
        <Heading as="h3" size="sm" color="fg.default" mb={3}>Risks of the change ({result.risks.length})</Heading>
        {result.risks.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">None reported.</Text>
        ) : (
          <Box as="ul" pl={5} color="fg.default" fontSize="sm">
            {result.risks.map((r, i) => <li key={i}>{r}</li>)}
          </Box>
        )}
      </Box>

      <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6}>
        <Heading as="h3" size="sm" color="fg.default" mb={3}>Execution metrics</Heading>
        {rows.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">Not captured. The verdict is based on the code only.</Text>
        ) : (
          <table aria-label="Execution metrics" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>Metric</th>
                <th scope="col" style={{ textAlign: 'right' }}>Original</th>
                <th scope="col" style={{ textAlign: 'right' }}>Optimized</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, m]) => (
                <tr key={name}>
                  <td>{METRIC_LABEL[name]}</td>
                  <td style={{ textAlign: 'right' }}>{m.original ?? 'Not captured'}</td>
                  <td style={{ textAlign: 'right' }}>{m.optimized ?? 'Not captured'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>
    </Box>
  );
}
