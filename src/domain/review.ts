import type { MaterialConsistencyCheck } from "@/lib/material-consistency";
import type { ModelCall } from "@/domain/model-call";
import type { MaterialClassification } from "@/lib/material-classification";

/** 判定、执行和结果有效性各自独立，不能把待复检当成新判定。 */
export type ReviewVerdict =
  "passed" | "failed" | "needs_confirmation" | "unable_to_check" | "not_applicable";

export type ExecutionStatus = "not_started" | "running" | "completed" | "cancelled" | "failed";

export type ResultValidity = "current" | "needs_recheck";

export type RequirementStrength = "required" | "recommended" | "optional";

export type CollaborationScope = "individual" | "team" | "unknown";

export interface FieldMapping {
  subject: string;
  canonicalField: string;
  materialId: string;
  materialVersion: number;
  segmentIndex: number;
  sourceField: string;
  rawValue: string;
  note: string;
  confirmedBy: string;
  confirmedAt: string;
}

export interface ReviewTaskBackground {
  fieldMappings?: FieldMapping[];
  conditionAnswers?: Array<{ condition: string; applies: boolean; note: string }>;
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

export interface MaterialPageCoverage {
  pageNumber: number;
  method: "text" | "ocr" | "none";
  status: "read" | "partial" | "failed" | "skipped";
  confidence?: number;
  message: string;
}

export interface MaterialRegion {
  pageNumber: number;
  box: { x: number; y: number; width: number; height: number };
  role: "body" | "header" | "footer" | "sidebar" | "table";
  readingOrder: number;
  status: "candidate" | "confirmed";
  recognition: "printed" | "handwritten" | "unknown";
  confidence?: number;
  cell?: {
    tableId: string;
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
    continuesFromPage?: number;
  };
  reviewedBy?: string;
  reviewedAt?: string;
  note?: string;
}

export interface MaterialContentSegment {
  region?: MaterialRegion;
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
  pageCoverage?: MaterialPageCoverage[];
  revision?: MaterialRevision;
  classification?: MaterialClassification;
  createdAt: string;
}

export interface MaterialRevision {
  kind:
    "correction" | "restore" | "retry" | "classification" | "select_version" | "region" | "enhance";
  baseVersion: number;
  actorId?: string;
  imageProcessing?: {
    rotateDegrees: number;
    normalize: boolean;
    sharpen: boolean;
    corners?: Array<{ x: number; y: number }>;
  };
  note: string;
  pageNumber?: number;
}

export interface MaterialVersionPreview {
  id: string;
  version: number;
  originalFileName: string;
  extension: string;
  parseStatus: MaterialParseStatus;
  parseMessage: string;
  pageCount: number | null;
  totalSegments: number;
  offset: number;
  segments: MaterialContentSegment[];
}

export type ReviewExecutionStatus = "running" | "completed" | "cancelled" | "failed";

export interface ReviewCheckEvidence {
  region?: MaterialRegion;
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
  dependencyKey?: string;
  comparisonKey?: string;
  checkedAt?: string;
  reusedFrom?: { executionId: string; checkedAt: string };
}

export interface RecheckPlanItem {
  ruleId: string;
  ruleCode: string;
  action: "check" | "reuse";
  reason: string;
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
    materialConsistency?: MaterialConsistencyCheck[];
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
  assignee?: string;
  assignmentHistory?: Array<{ assignee: string; note: string; at: string }>;
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

/** User-editable task background excludes server-authored mapping confirmations. */
export function editableTaskBackground(
  background: ReviewTaskBackground,
): Omit<ReviewTaskBackground, "fieldMappings"> {
  return {
    projectType: background.projectType,
    projectStage: background.projectStage,
    collaborationScope: background.collaborationScope,
    ...(background.conditionAnswers ? { conditionAnswers: background.conditionAnswers } : {}),
  };
}
