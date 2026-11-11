"use client";

import { useState } from "react";

import type { ReviewRuleSet } from "@/domain/review-rule";
import type { ReactElement } from "react";

interface RuleReviewProps {
  taskId: string;
  currentNoticeVersion: number;
  initialRuleSets: ReviewRuleSet[];
}

const strengthLabels = {
  required: "必须",
  recommended: "建议",
  optional: "可选",
  unknown: "待确认强度",
} as const;

const checkabilityLabels = {
  deterministic: "可用确定性工具检查",
  assisted: "需要材料证据",
  unable_to_check: "当前无法检查",
} as const;

export function RuleReview({
  taskId,
  currentNoticeVersion,
  initialRuleSets,
}: RuleReviewProps): ReactElement {
  const [ruleSets, setRuleSets] = useState(initialRuleSets);
  const [error, setError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const currentRuleSet = ruleSets[0];
  const hasCurrentRuleSet = currentRuleSet?.sourceVersion === currentNoticeVersion;

  async function extractRules(): Promise<void> {
    setError("");
    setIsExtracting(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/rules`, { method: "POST" });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ruleSet" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "暂时无法生成规则草稿。",
        );
        return;
      }
      setRuleSets((existingRuleSets) => [result.ruleSet as ReviewRuleSet, ...existingRuleSets]);
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <section
      aria-labelledby="rules-heading"
      className="mt-12 max-w-4xl border-t border-border pt-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="rules-heading" className="text-sm font-semibold">
            动态规则草稿
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            当前使用可重复的本地模拟提取。草稿须逐条对照通知确认，不代表真实模型输出或已完成材料审查。
          </p>
        </div>
        <button
          type="button"
          onClick={extractRules}
          disabled={isExtracting}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {isExtracting ? "正在整理…" : hasCurrentRuleSet ? "重新生成草稿" : "从通知生成草稿"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!currentRuleSet ? (
        <p className="mt-5 text-sm text-muted-foreground">尚未生成规则草稿。</p>
      ) : null}
      {currentRuleSet ? (
        <div className="mt-6 space-y-5">
          {!hasCurrentRuleSet ? (
            <p className="border-l-2 border-amber-500 pl-3 text-sm leading-6 text-amber-900">
              当前显示的是通知 v{currentRuleSet.sourceVersion} 的规则草稿；任务通知已更新为 v
              {currentNoticeVersion}，请重新生成后再使用。
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>通知 v{currentRuleSet.sourceVersion}</span>
            <span>模拟模式</span>
            <span>{currentRuleSet.rules.length} 条草稿</span>
            <time dateTime={currentRuleSet.createdAt}>
              {new Date(currentRuleSet.createdAt).toLocaleString("zh-CN")}
            </time>
          </div>
          {currentRuleSet.rules.length === 0 ? (
            <p className="border-l-2 border-amber-500 pl-3 text-sm leading-6">
              {currentRuleSet.warnings[0]?.message ?? "未识别到规则草稿。"}
            </p>
          ) : null}
          <ol className="divide-y divide-border border-y border-border">
            {currentRuleSet.rules.map((rule) => (
              <li key={rule.id} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {rule.code} · {rule.description}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {rule.target} · {strengthLabels[rule.strength]} ·{" "}
                      {checkabilityLabels[rule.checkability]}
                    </p>
                  </div>
                </div>
                {rule.parameters.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    识别参数：{rule.parameters.join("、")}
                  </p>
                ) : null}
                {rule.applicabilityCondition ? (
                  <p className="mt-2 text-xs text-amber-800">
                    适用条件：{rule.applicabilityCondition}
                  </p>
                ) : null}
                {rule.uncertainty ? (
                  <p className="mt-2 text-xs leading-5 text-amber-800">{rule.uncertainty}</p>
                ) : null}
                <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-xs leading-6 text-muted-foreground">
                  <span className="font-mono">
                    通知 v{rule.source.sourceVersion} · 段落 {rule.source.paragraphIndex + 1} · 字符{" "}
                    {rule.source.startOffset}–{rule.source.endOffset}
                  </span>
                  <span className="mt-1 block break-words text-foreground">
                    {rule.source.quotedText}
                  </span>
                </blockquote>
              </li>
            ))}
          </ol>
          {currentRuleSet.warnings.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                查看 {currentRuleSet.warnings.length} 条需要人工留意的信息
              </summary>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-800">
                {currentRuleSet.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {ruleSets.length > 1 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            查看 {ruleSets.length - 1} 个历史提取版本
          </summary>
          <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
            {ruleSets.slice(1).map((ruleSet) => (
              <li key={ruleSet.id}>
                通知 v{ruleSet.sourceVersion} · {ruleSet.rules.length} 条规则 ·{" "}
                {new Date(ruleSet.createdAt).toLocaleString("zh-CN")}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
