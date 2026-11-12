import { z } from "zod";
import { modelCallSchema } from "@/domain/model-call";

import type { CollaborationScope } from "@/domain/review";

export const ruleStrengthSchema = z.enum(["required", "recommended", "optional", "unknown"]);
export const ruleCheckabilitySchema = z.enum(["deterministic", "assisted", "unable_to_check"]);
export const ruleGenerationMethodSchema = z.enum(["mock", "live", "manual"]);

export const ruleSourcePositionSchema = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().positive(),
  paragraphIndex: z.number().int().nonnegative(),
  quotedText: z.string().min(1).max(20_000),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
});

export const reviewRuleSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(/^R-\d{3}$/),
  description: z.string().min(1).max(2_000),
  target: z.string().min(1).max(200),
  strength: ruleStrengthSchema,
  applicabilityScope: z.enum(["individual", "team", "unknown"]),
  applicabilityCondition: z.string().max(500),
  parameters: z.array(z.string().min(1).max(200)).max(20),
  materialIds: z.array(z.string().uuid()).max(50).default([]),
  checkability: ruleCheckabilitySchema,
  generationMethod: ruleGenerationMethodSchema,
  uncertainty: z.string().max(1_000),
  source: ruleSourcePositionSchema,
});

export const ruleExtractionWarningSchema = z.object({
  code: z.enum([
    "unknown_strength",
    "unknown_scope",
    "content_requires_evidence",
    "unsupported_input",
    "conflicting_constraints",
    "attachment_dependency",
  ]),
  message: z.string().min(1).max(500),
  source: ruleSourcePositionSchema.optional(),
});

export const reviewRuleSetSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().positive(),
  mode: z.enum(["mock", "live"]),
  provider: z.string().max(120),
  model: z.string().max(120),
  status: z.enum(["completed", "failed"]),
  createdAt: z.string().datetime(),
  modelCalls: z.array(modelCallSchema).max(10).default([]),
  rules: z.array(reviewRuleSchema).max(500),
  warnings: z.array(ruleExtractionWarningSchema).max(500),
});

export type RuleStrength = z.infer<typeof ruleStrengthSchema>;
export type RuleCheckability = z.infer<typeof ruleCheckabilitySchema>;
export type RuleGenerationMethod = z.infer<typeof ruleGenerationMethodSchema>;
export type RuleSourcePosition = z.infer<typeof ruleSourcePositionSchema>;
export type ReviewRule = z.infer<typeof reviewRuleSchema>;
export type RuleExtractionWarning = z.infer<typeof ruleExtractionWarningSchema>;
export type ReviewRuleSet = z.infer<typeof reviewRuleSetSchema>;

export interface ReviewRuleSetSummary extends Omit<ReviewRuleSet, "rules"> {
  ruleCount: number;
}

export interface RuleExtractionInput {
  taskId: string;
  sourceId: string;
  sourceVersion: number;
  noticeText: string;
}

export type RuleCollaborationScope = CollaborationScope;
