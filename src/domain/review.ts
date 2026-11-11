/** 判定、执行和结果有效性各自独立，不能把待复检当成新判定。 */
export type ReviewVerdict =
  "passed" | "failed" | "needs_confirmation" | "unable_to_check" | "not_applicable";

export type ExecutionStatus = "not_started" | "running" | "completed" | "cancelled" | "failed";

export type ResultValidity = "current" | "needs_recheck";

export type RequirementStrength = "required" | "recommended" | "optional";

export interface SourcePosition {
  sourceId: string;
  paragraphIndex: number;
  quotedText: string;
  pageNumber?: number;
}

export interface MaterialEvidence {
  materialId: string;
  materialVersion: number;
  quotedText: string;
  pageNumber?: number;
  paragraphIndex?: number;
}
