import type { ModelCall } from "@/domain/model-call";

/** 判定、执行和结果有效性各自独立，不能把待复检当成新判定。 */
export type ReviewVerdict =
  "passed" | "failed" | "needs_confirmation" | "unable_to_check" | "not_applicable";

export type ExecutionStatus = "not_started" | "running" | "completed" | "cancelled" | "failed";

export type ResultValidity = "current" | "needs_recheck";

export type RequirementStrength = "required" | "recommended" | "optional";

export type CollaborationScope = "individual" | "team" | "unknown";

export interface ReviewTaskBackground {
  projectType: string;
  projectStage: string;
  collaborationScope: CollaborationScope;
}

export interface RequirementSourceSegment {
  paragraphIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  location?: string;
}

export function getRequirementSourceSegmentId(
  sourceId: string,
  sourceVersion: number,
  paragraphIndex: number,
): string {
  return `requirement-source-${sourceId}-v${sourceVersion}-segment-${paragraphIndex}`;
}

export interface RequirementSourceVersion {
  id: string;
  version: number;
  inputType: "text" | "webpage" | "file";
  displayName: string;
  sourceUrl?: string;
  fetchedAt?: string;
  originalText: string;
  parseStatus: MaterialParseStatus;
  segments: RequirementSourceSegment[];
  createdAt: string;
}

export interface ReviewTaskSummary {
  id: string;
  name: string;
  description: string;
  background: ReviewTaskBackground;
  sourceCount: number;
  noticeSourceVersion: number;
  noticePreview: string;
  latestUpdatedAt: string;
}

export interface ReviewTaskDetails extends ReviewTaskSummary {
  createdAt: string;
  noticeSource: RequirementSourceVersion;
  noticeHistory: RequirementSourceVersion[];
  supplementalSources: RequirementSourceVersion[];
  materials: ReviewMaterialSummary[];
}

export type MaterialParseStatus = "text_extracted" | "partial" | "failed" | "ocr_required";

export interface MaterialContentSegment {
  segmentIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  location: string;
}

export interface ReviewMaterialSummary {
  id: string;
  version: number;
  originalFileName: string;
  mediaType: string;
  extension: string;
  fileSizeBytes: number;
  sha256: string;
  parseStatus: MaterialParseStatus;
  parserName: string;
  extractedText: string;
  segments: MaterialContentSegment[];
  pageCount: number | null;
  sheetNames: string[];
  parseMessage: string;
  createdAt: string;
}

export type ReviewExecutionStatus = "running" | "completed" | "cancelled" | "failed";

export interface ReviewCheckEvidence {
  materialId: string;
  materialVersion: number;
  quotedText: string;
  location: string;
  segmentIndex?: number;
}

export interface ReviewCheckResult {
  ruleId: string;
  ruleCode: string;
  requirement: string;
  strength: "required" | "recommended" | "optional" | "unknown";
  verdict: ReviewVerdict;
  reason: string;
  recommendation: string;
  source: SourcePosition;
  evidence: ReviewCheckEvidence[];
  method?: "deterministic" | "model" | "unavailable";
  coverage?: { examinedSegments: number; totalSegments: number; isComplete: boolean };
}

export interface ReviewExecution {
  id: string;
  taskId: string;
  ruleSetId: string;
  sourceVersion: number;
  status: ReviewExecutionStatus;
  unexecutedCount: number;
  materialSnapshot: Array<{ materialId: string; version: number }>;
  results: ReviewCheckResult[];
  createdAt: string;
  completedAt: string;
  metadata?: {
    mode: "mock" | "live";
    provider: string;
    model: string;
    modelCalls: ModelCall[];
    backgroundSnapshot: ReviewTaskBackground;
    limitations: string[];
  };
  humanResolutions?: HumanResolution[];
  validity?: ResultValidity;
  invalidationReasons?: string[];
}

export interface HumanResolution {
  ruleId: string;
  decision: "confirmed" | "rejected" | "deferred";
  note: string;
  updatedAt: string;
}

export interface RemediationTask {
  id: string;
  taskId: string;
  executionId: string;
  ruleId: string;
  ruleCode: string;
  requirement: string;
  reason: string;
  recommendation: string;
  sourceQuote: string;
  materialIds: string[];
  status: "open" | "in_progress" | "done";
  createdAt: string;
  updatedAt: string;
}

export interface SourcePosition {
  sourceId: string;
  sourceVersion?: number;
  displayName?: string;
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
