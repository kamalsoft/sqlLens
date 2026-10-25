export type MetricDelta = {
  original: number | null;
  optimized: number | null;
  delta: number | null;
  deltaPct: number | null;
};

export type MetricsMap = Partial<
  Record<"logicalReads" | "physicalReads" | "scanCount" | "cpu" | "elapsed", MetricDelta | null>
>;

const ROWS: Array<[keyof MetricsMap, string]> = [
  ["logicalReads", "Logical reads"],
  ["physicalReads", "Physical reads"],
  ["scanCount", "Scan count"],
  ["cpu", "CPU (ms)"],
  ["elapsed", "Elapsed (ms)"],
];

export const NOT_CAPTURED = "not captured";

export function fmt(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? NOT_CAPTURED : `${value.toLocaleString()}${suffix}`;
}

export function MetricComparisonTable({ metrics }: { metrics: MetricsMap | null | undefined }) {
  return (
    <table aria-label="Metric comparison">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Original</th>
          <th>Optimized</th>
          <th>Delta</th>
          <th>Change</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(([key, label]) => {
          const m = metrics?.[key];
          return (
            <tr key={key}>
              <td>{label}</td>
              <td>{fmt(m?.original)}</td>
              <td>{fmt(m?.optimized)}</td>
              <td>{fmt(m?.delta)}</td>
              <td>{m?.deltaPct === null || m?.deltaPct === undefined ? NOT_CAPTURED : `${m.deltaPct.toFixed(1)}%`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
