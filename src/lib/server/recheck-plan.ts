import "server-only";
import { createHash } from "node:crypto";
import { getAiMode, getModelConfiguration } from "./model-client";
import type { ReviewRuleSet } from "@/domain/review-rule";
import type {
  ReviewTaskDetails,
  ReviewExecution,
  ReviewCheckResult,
  RecheckPlanItem,
} from "@/domain/review";

// 提示词、检索、匹配、工具或依赖语义改变时更新此标识，使旧结果的依赖键失效。
const REVIEW_PIPELINE_REVISION = "2026-11-15-10";

export interface PlannedCheck extends RecheckPlanItem {
  dependencyKey: string;
  reusableResult?: ReviewCheckResult;
}

/**
 * 为当前规则生成逐项复检计划，按输入与执行配置的依赖键判断能否复用上次结果。
 * forceFull 强制重跑；本函数只计算计划，不执行检查或写入结果。
 */
export function createRecheckPlan(
  task: ReviewTaskDetails,
  ruleSet: ReviewRuleSet,
  previous?: ReviewExecution,
  forceFull = false,
  requestedMode?: "mock" | "live",
): PlannedCheck[] {
  const mode = requestedMode ?? getAiMode();
  const configuration = mode === "live" ? getModelConfiguration() : null;
  // 来源与材料先按 ID 排序，使集合的遍历顺序不影响依赖键。
  const sources = [task.noticeSource, ...task.supplementalSources]
    .map(({ id, version }) => ({ id, version }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return ruleSet.rules.map((rule) => {
    // 未指定目标材料时依赖整个材料清单，新增候选材料也会触发重新检查。
    const dependencies = (
      rule.materialIds.length
        ? task.materials.filter((material) => rule.materialIds.includes(material.id))
        : task.materials
    )
      .map((material) => ({
        id: material.id,
        version: material.version,
        sha256: material.sha256,
        parser: material.parserName,
        status: material.parseStatus,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const warnings = ruleSet.warnings
      .filter((warning) => warning.relatedRuleIds?.includes(rule.id))
      .map((warning) => ({
        code: warning.code,
        message: warning.message,
        source: warning.source,
        sources: warning.sources,
      }));
    const semanticRule = {
      description: rule.description,
      target: rule.target,
      strength: rule.strength,
      applicabilityScope: rule.applicabilityScope,
      applicabilityCondition: rule.applicabilityCondition,
      parameters: rule.parameters,
      materialIds: [...rule.materialIds].sort(),
      checkability: rule.checkability,
      uncertainty: rule.uncertainty,
      source: rule.source,
    };
    const dependencyKey = createHash("sha256")
      .update(
        JSON.stringify({
          pipeline: REVIEW_PIPELINE_REVISION,
          mode,
          configuration: configuration
            ? {
                provider: configuration.provider,
                model: configuration.model,
                endpoint: configuration.baseUrl,
                timeoutMs: configuration.timeoutMs,
                maxCalls: configuration.maxCallsPerReview,
              }
            : null,
          rule: semanticRule,
          warnings,
          sources,
          background: task.background,
          dependencies,
        }),
      )
      .digest("hex");
    const before =
      previous?.results.find((result) => result.dependencyKey === dependencyKey) ??
      previous?.results.find((result) => result.ruleId === rule.id);
    // 仅复用已完成执行中的确定结论；模型结果还需具备完整的检索覆盖记录。
    const isReusable =
      !forceFull &&
      previous?.status === "completed" &&
      before?.dependencyKey === dependencyKey &&
      ["passed", "failed", "not_applicable"].includes(before.verdict) &&
      (before.method === "deterministic" ||
        (before.method === "model" && before.coverage?.isComplete === true));
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      dependencyKey,
      action: isReusable ? "reuse" : "check",
      reason: forceFull
        ? "用户选择全量复检"
        : !before?.dependencyKey
          ? "没有可比较的依赖记录，需要检查"
          : before.dependencyKey !== dependencyKey
            ? "规则、来源、背景、材料或执行配置发生变化"
            : !isReusable
              ? "上次检查未完成、证据覆盖不足或结论不确定，需要重新检查"
              : "依赖及执行配置一致，复用已有有效结果",
      reusableResult:
        isReusable && before && previous
          ? {
              ...before,
              ruleId: rule.id,
              ruleCode: rule.code,
              source: rule.source,
              // 连续复用时保留最初的执行出处，避免把复用轮次当作重新检查。
              reusedFrom: before.reusedFrom ?? {
                executionId: previous.id,
                checkedAt: before.checkedAt ?? previous.completedAt,
              },
            }
          : undefined,
    };
  });
}
