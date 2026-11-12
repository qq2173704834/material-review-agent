import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { reviewRuleSchema } from "@/domain/review-rule";
import { generateModelJson, ModelServiceError } from "@/lib/server/model-client";

import type { RequirementSourceVersion } from "@/domain/review";
import type { ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";
import type { ModelCall } from "@/domain/model-call";

const extractedRulesSchema = z.object({
  rules: z
    .array(
      reviewRuleSchema
        .omit({
          id: true,
          code: true,
          generationMethod: true,
          source: true,
        })
        .extend({
          paragraphIndex: z.number().int().nonnegative(),
          quotedText: z.string().min(1).max(20000),
        }),
    )
    .max(100),
});

export async function extractLiveRules(
  sources: RequirementSourceVersion[],
  signal: AbortSignal,
): Promise<{ rules: ReviewRule[]; warnings: RuleExtractionWarning[]; modelCalls: ModelCall[] }> {
  if (sources.reduce((total, source) => total + source.originalText.length, 0) > 40000)
    throw new ModelServiceError(
      "input_limit",
      "本轮真实规则提取支持最多 40,000 字符的全部来源，请拆分来源后再提取。",
      413,
    );
  const rules: ReviewRule[] = [];
  const warnings: RuleExtractionWarning[] = [];
  const modelCalls: ModelCall[] = [];
  for (const source of sources) {
    const generated = await generateModelJson({
      schema: extractedRulesSchema,
      operation: "rule_extraction",
      signal,
      maxOutputTokens: 12000,
      system: `你是通用材料预审规则提取器。仅提取当前给出的来源中实际存在的要求，不补充常识规则。
每条规则只含一个独立约束：格式、单文件大小、数量、PDF总页数、存在性、内容要求分别拆开；共享条件不能丢失。
required=必须，recommended=建议，optional=可选，不明确用unknown并填写uncertainty。
applicabilityScope仅在明确个人/团队适用时设置，个人陈述等材料名称不代表适用范围；其他条件填写applicabilityCondition且保留不确定性。
target用具体材料名称；只有明确适用于全部上传材料时使用“全部材料”，不把一份材料的规格套到所有文件。
纯文件属性可用deterministic，内容与完整性用assisted，无法检查用unable_to_check。
paragraphIndex须是提供的段落编号；quotedText须为该段落中逐字连续的原文，必须包含强度、条件和参数依据，不能改写。
输出JSON结构：${JSON.stringify(z.toJSONSchema(extractedRulesSchema))}`,
      prompt: JSON.stringify({
        sourceName: source.displayName,
        noticeParagraphs: source.segments.map(({ paragraphIndex, text }) => ({
          paragraphIndex,
          text,
        })),
      }),
    });
    modelCalls.push(generated.call);
    for (const draft of generated.value.rules) {
      const segment = source.segments.find(
        (candidate) => candidate.paragraphIndex === draft.paragraphIndex,
      );
      const localOffset = segment?.text.indexOf(draft.quotedText) ?? -1;
      if (!segment || localOffset < 0)
        throw new ModelServiceError(
          "invalid_citation",
          `模型引用无法逐字定位到来源“${source.displayName}”，未保存规则，请重新提取。`,
          422,
          generated.call,
        );
      const startOffset = segment.startOffset + localOffset;
      const rule = reviewRuleSchema.parse({
        id: randomUUID(),
        code: `R-${String(rules.length + 1).padStart(3, "0")}`,
        description: draft.description,
        target: draft.target,
        strength: draft.strength,
        applicabilityScope: draft.applicabilityScope,
        applicabilityCondition: draft.applicabilityCondition,
        parameters: draft.parameters,
        checkability: draft.checkability,
        generationMethod: "live",
        uncertainty: draft.uncertainty,
        source: {
          sourceId: source.id,
          sourceVersion: source.version,
          displayName: source.displayName,
          paragraphIndex: draft.paragraphIndex,
          quotedText: draft.quotedText,
          startOffset,
          endOffset: startOffset + draft.quotedText.length,
        },
      });
      rules.push(rule);
      if (rule.uncertainty)
        warnings.push({
          code: "unknown_scope",
          message: rule.uncertainty.slice(0, 500),
          source: rule.source,
        });
    }
  }
  if (!rules.length)
    warnings.push({
      code: "unsupported_input",
      message: "模型没有从已提供来源提取到规则；这不代表来源没有要求，请核对原文。",
    });
  return { rules, warnings, modelCalls };
}
