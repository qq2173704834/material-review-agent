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
}

export interface RequirementSourceVersion {
  id: string;
  version: number;
  inputType: "text";
  displayName: string;
  originalText: string;
  parseStatus: "text_extracted";
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
