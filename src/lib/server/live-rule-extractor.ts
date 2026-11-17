import { relationWarnings } from "@/lib/relation-candidates";
import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { reviewRuleSchema } from "@/domain/review-rule";
import { generateModelJson, ModelServiceError } from "@/lib/server/model-client";

import type { RequirementSourceVersion } from "@/domain/review";
import type { ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";
import type { ModelCall } from "@/domain/model-call";

const relationCitationSchema = z.object({
  sourceId: z.string().uuid(),
  paragraphIndex: z.number().int().nonnegative(),
  quotedText: z.string().min(1).max(2000),
});
const extractedRulesSchema = z.object({
  relations: z
    .array(
      z.object({
        first: relationCitationSchema,
        second: relationCitationSchema,
        kind: z.enum(["exception", "alternative", "replacement", "implicit_conflict"]),
        reason: z.string().min(1).max(350),
      }),
    )
    .max(30)
    .optional(),
  rules: z
    .array(
      reviewRuleSchema
        .omit({
          id: true,
          code: true,
          generationMethod: true,
          source: true,
          additionalSources: true,
          numericConstraints: true,
        })
        .extend({
          paragraphIndex: z.number().int().nonnegative(),
          quotedText: z.string().min(1).max(20000),
        }),
    )
    .max(100),
});

/**
 * 按来源顺序提取规则，并将每条引用定位回对应版本的原文。
 * 后续来源可看到已提取条款；关系候选在规则生成后另行校验双方引用。
 */
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
可额外返回relations候选，用于例外、A或B替代组合、局部更正和隐含矛盾；全部是待人工核对，不裁决来源权威或按发布时间覆盖。每个候选必须引用两个不同已提取条款内的逐字原文与真实sourceId/paragraphIndex；没有充分双方引用则不提出。地区/考期/阶段/岗位/科目不同不作矛盾，共享条件必须放入applicabilityCondition，可用“地区：浙江；阶段：报名”的显式格式。
每条规则只含一个独立约束：格式、单文件大小、数量、PDF总页数、存在性、内容要求分别拆开；共享条件不能丢失。
二选一/至少一项的替代组合必须保留为一个完整关系，不拆成两条必交；组合的候选名称和满足方式写入description与parameters。原创性、美观等缺乏客观标准的要求标为assisted并说明评价限制，不伪造客观合规结论。
required=必须，recommended=建议，optional=可选，不明确用unknown并填写uncertainty。
applicabilityScope仅在明确个人/团队适用时设置，个人陈述等材料名称不代表适用范围；其他条件填写applicabilityCondition且保留不确定性。
没有额外适用条件时，applicabilityCondition必须严格填写空字符串""，不得填“适用于所有材料”“不区分个人团队”“无条件”等说明。材料目标只放在target里。
uncertainty仅记录要求本身的歧义或信息缺失。需要语义检查、需人工阅读、尚未上传材料不是要求歧义；要求明确时uncertainty必须为""，并用checkability=assisted表达语义检查方式。
来源没有要求的格式、大小、页数、命名等属性，不是缺失信息，不得据此填写uncertainty或增加规则。例如“提交项目说明或演示说明，二选一”本身明确：保留一个替代关系，uncertainty=""，不要求来源补充格式或大小。只有影响该项已有要求判定的未知条件或矛盾才记录为歧义。
target用具体材料名称；只有明确适用于全部上传材料时使用“全部材料”，不把一份材料的规格套到所有文件。
纯文件属性可用deterministic，内容与完整性用assisted，无法检查用unable_to_check。
paragraphIndex须是提供的段落编号；quotedText须为该段落中逐字连续的原文，必须包含强度、条件和参数依据，不能改写。
仅返回业务对象{"rules":[具体规则对象]}。下面是用于校验的 JSON Schema，不是输出内容，禁止复述 Schema 或输出第二个 JSON：
<validation_schema>${JSON.stringify(z.toJSONSchema(extractedRulesSchema))}</validation_schema>`,
      prompt: JSON.stringify({
        sourceId: source.id,
        sourceName: source.displayName,
        previousRules: rules.map((rule) => ({
          description: rule.description,
          source: rule.source,
        })),
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
      // 模型只提供段落编号与引文；全文偏移由原段落起点和逐字匹配位置计算。
      const localOffset = segment?.text.indexOf(draft.quotedText) ?? -1;
      if (!segment || localOffset < 0)
        throw new ModelServiceError(
          "invalid_citation",
          `模型引用无法逐字定位到来源“${source.displayName}”，未保存规则，请重新提取。`,
          422,
          generated.call,
        );
      const startOffset = segment.startOffset + localOffset;
      // 标识、展示编号和来源版本由服务端赋值，使规则始终关联本轮输入来源。
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
    try {
      warnings.push(...relationWarnings(generated.value.relations ?? [], sources, rules));
    } catch {
      throw new ModelServiceError(
        "invalid_citation",
        "模型关系候选缺少可定位的双方条款，未保存本次规则。",
        422,
        generated.call,
      );
    }
  }
  if (!rules.length)
    warnings.push({
      code: "unsupported_input",
      message: "暂未提取到检查要求，请查看原文并补充需要检查的内容。",
    });
  return { rules, warnings, modelCalls };
}
