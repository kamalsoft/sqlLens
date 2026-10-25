/**
 * Legacy result shapes still imported by the review panel, compare page and
 * share page (frontend). The mock analysis/compare implementations were removed:
 * reviews run through `/api/review` and compares through `/api/compare`,
 * both on local Transformers.js inference (P4-01, P4-02).
 */

export interface ReviewResult {
  summary: string;
  bottlenecks: string[];
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  fiveWhys: { why: string; answer: string }[];
  deepDive: string;
  verdict: string;
}

export interface CompareResult {
  summary: string;
  original: ReviewResult;
  optimized: ReviewResult;
  bottlenecks: string[];
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  fiveWhys: { why: string; answer: string }[];
  deepDive: string;
  verdict: string;
}
