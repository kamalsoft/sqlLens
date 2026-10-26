// Types and limits shared by the refactor route and page (no server-only imports).
import type { IndexRecommendation } from "@/lib/review-schema";

export const MAX_INSTRUCTIONS_LENGTH = 2000;

export type ViewRecommendation = {
  name: string;
  reason: string;
  definition: string;
  createStatement?: string;
};

/** What the model returns (the SQL itself comes from the <rewritten_procedure> block). */
export type RefactorModelResult = {
  summary: string;
  changes: string[];
  indexRecommendations: IndexRecommendation[];
  viewRecommendations: ViewRecommendation[];
  otherRecommendations: string[];
  limitations: string[];
};

export type RefactorCheck = { id: string; label: string; passed: boolean; detail?: string };

/** provided, none (no SQL returned), unsafe (adds writes; removed) or truncated (cut off; removed). */
export type RefactorStatus = "provided" | "none" | "unsafe" | "truncated";

export type RefactorResult = RefactorModelResult & {
  status: RefactorStatus;
  refactoredSql: string;
  formatted: boolean;
  checks: RefactorCheck[];
  statusDetail?: string;
};
