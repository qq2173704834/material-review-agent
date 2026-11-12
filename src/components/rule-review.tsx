"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ReviewRule, ReviewRuleSet } from "@/domain/review-rule";
import type { FormEvent, ReactElement } from "react";

interface RuleReviewProps {
  taskId: string;
  currentNoticeVersion: number;
  initialRuleSets: ReviewRuleSet[];
  mode: "mock" | "live" | "invalid";
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
  mode,
}: RuleReviewProps): ReactElement {
  const router = useRouter();
  const [ruleSets, setRuleSets] = useState(initialRuleSets);
  const [error, setError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [editingRule, setEditingRule] = useState<ReviewRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsExtracting(false);
    }
  }

  async function saveRuleEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingRule || !currentRuleSet) return;
    setError("");
    setIsSaving(true);
    try {
      const updatedRules = currentRuleSet.rules.map((rule) =>
        rule.id === editingRule.id ? editingRule : rule,
      );
      const response = await fetch(`/api/tasks/${taskId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: updatedRules }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ruleSet" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "规则修改保存失败。",
        );
        return;
      }
      setRuleSets((existing) => [result.ruleSet as ReviewRuleSet, ...existing]);
      setEditingRule(null);
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function deactivateRule(ruleId: string): Promise<void> {
    if (!currentRuleSet || isSaving) return;
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: currentRuleSet.rules.filter((rule) => rule.id !== ruleId) }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ruleSet" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "规则停用失败。",
        );
        return;
      }
      setRuleSets((existing) => [result.ruleSet as ReviewRuleSet, ...existing]);
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsSaving(false);
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
            {mode === "live"
              ? "将当前通知发送到配置的真实模型，拆分要求并核对原文引用；草稿仍需关注条件与歧义。"
              : "当前使用可重复的本地模拟提取，不代表真实模型输出或已完成材料审查。"}
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
            <span>
              {currentRuleSet.mode === "live"
                ? `真实模型 · ${currentRuleSet.provider} / ${currentRuleSet.model}`
                : "模拟模式"}
            </span>
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
                  {hasCurrentRuleSet ? (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => setEditingRule(rule)}
                      >
                        人工纠正
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        className="text-xs font-medium text-destructive underline-offset-4 hover:underline disabled:opacity-50"
                        onClick={() => void deactivateRule(rule.id)}
                      >
                        停用规则
                      </button>
                    </div>
                  ) : null}
                </div>
                {editingRule?.id === rule.id ? (
                  <form
                    onSubmit={saveRuleEdit}
                    className="mt-4 space-y-3 border-l-2 border-primary/40 pl-4"
                  >
                    <label className="block text-xs font-medium">
                      要求描述
                      <textarea
                        className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
                        maxLength={2000}
                        required
                        value={editingRule.description}
                        onChange={(event) =>
                          setEditingRule({ ...editingRule, description: event.target.value })
                        }
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-medium">
                        目标材料
                        <input
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                          maxLength={200}
                          required
                          value={editingRule.target}
                          onChange={(event) =>
                            setEditingRule({ ...editingRule, target: event.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs font-medium">
                        要求强度
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                          value={editingRule.strength}
                          onChange={(event) =>
                            setEditingRule({
                              ...editingRule,
                              strength: event.target.value as ReviewRule["strength"],
                            })
                          }
                        >
                          <option value="required">必须</option>
                          <option value="recommended">建议</option>
                          <option value="optional">可选</option>
                          <option value="unknown">待确认</option>
                        </select>
                      </label>
                    </div>
                    <label className="block text-xs font-medium">
                      适用条件
                      <input
                        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        maxLength={500}
                        value={editingRule.applicabilityCondition}
                        onChange={(event) =>
                          setEditingRule({
                            ...editingRule,
                            applicabilityCondition: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      识别参数（每行一项）
                      <textarea
                        className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
                        maxLength={4_000}
                        value={editingRule.parameters.join("\n")}
                        onChange={(event) =>
                          setEditingRule({
                            ...editingRule,
                            parameters: event.target.value
                              .split("\n")
                              .map((parameter) => parameter.trim())
                              .filter(Boolean)
                              .slice(0, 20),
                          })
                        }
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {isSaving ? "保存中…" : "保存为新版本"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingRule(null)}
                        className="rounded-md border border-border px-3 py-2 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : null}
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
