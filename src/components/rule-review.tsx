"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTaskActivity, useTaskWorkflow } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

import type { ReviewRule, ReviewRuleSet } from "@/domain/review-rule";
import { hasCurrentRuleSources } from "@/domain/review-rule";
import { describeBound } from "@/lib/numeric-constraints";
import type { RequirementSourceVersion } from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface RuleReviewProps {
  taskId: string;
  currentNoticeVersion: number;
  sources: RequirementSourceVersion[];
  materials: Array<{ id: string; version: number; originalFileName: string }>;
  candidates?: Record<string, Array<{ materialId: string; quote: string; location: string }>>;
  applicability?: Record<string, boolean | undefined>;
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
  sources,
  materials,
  candidates = {},
  applicability = {},
  initialRuleSets,
  mode,
}: RuleReviewProps): ReactElement {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const [ruleSets, setRuleSets] = useState(initialRuleSets);
  const [error, setError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [editingRule, setEditingRule] = useState<ReviewRule | null>(null);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const clearUnsaved = useUnsavedChanges(isDirty && (!!editingRule || isAddingRule));
  useTaskActivity(
    "requirements-editor",
    isExtracting
      ? "正在整理审查要求"
      : isSaving
        ? "正在保存审查要求"
        : isDirty && (editingRule || isAddingRule)
          ? "请先保存或取消正在编辑的审查要求"
          : null,
  );
  const latestRuleSet = ruleSets[0];
  const currentRuleSet = ruleSets.find(
    (ruleSet) =>
      ruleSet.sourceVersion === currentNoticeVersion && hasCurrentRuleSources(ruleSet, sources),
  );
  const displayedRuleSet = currentRuleSet ?? latestRuleSet;
  const hasCurrentRuleSet = Boolean(currentRuleSet);
  const materialRequirementGroups = new Map<
    string,
    { rules: ReviewRule[]; materialIds: Set<string> }
  >();
  displayedRuleSet?.rules.forEach((rule) => {
    const group = materialRequirementGroups.get(rule.target) ?? {
      rules: [],
      materialIds: new Set<string>(),
    };
    group.rules.push(rule);
    rule.materialIds.forEach((materialId) => group.materialIds.add(materialId));
    materialRequirementGroups.set(rule.target, group);
  });

  async function extractRules(): Promise<void> {
    if (isExtracting) return;
    if (
      displayedRuleSet?.rules.some((rule) => rule.generationMethod === "manual") &&
      !window.confirm(
        "当前审查要求包含人工调整。重新整理将建立新版本并替换当前编辑结果，历史仍保留。请先核对来源变化，确定要重新整理吗？",
      )
    )
      return;
    setError("");
    setIsExtracting(true);
    try {
      const response = await fetch(
        `/api/tasks/${taskId}/rules${workflow?.mode === "mock" ? "?mode=mock" : ""}`,
        { method: "POST" },
      );
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
      setError("暂时无法连接服务，请稍后重试。");
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
      clearUnsaved();
      setIsDirty(false);
      router.refresh();
    } catch {
      setError("暂时无法连接服务，请稍后重试。");
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
      setError("暂时无法连接服务，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function adoptConflictBasis(ruleId: string): Promise<void> {
    if (!currentRuleSet || isSaving) return;
    const relatedRuleIds = new Set(
      currentRuleSet.warnings
        .filter(
          (warning) =>
            warning.code === "conflicting_constraints" && warning.relatedRuleIds?.includes(ruleId),
        )
        .flatMap((warning) => warning.relatedRuleIds ?? []),
    );
    const selectedRule = currentRuleSet.rules.find((rule) => rule.id === ruleId);
    if (!selectedRule || relatedRuleIds.size < 2) return;
    const removedRules = currentRuleSet.rules.filter(
      (rule) => relatedRuleIds.has(rule.id) && rule.id !== ruleId,
    );
    if (
      !window.confirm(
        `采用 ${selectedRule.code} 的来源依据，并停用 ${removedRules.map((rule) => rule.code).join("、")}？原规则仍保留在历史版本中。`,
      )
    )
      return;
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: currentRuleSet.rules.filter(
            (rule) => !relatedRuleIds.has(rule.id) || rule.id === ruleId,
          ),
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ruleSet" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "冲突依据未能保存。",
        );
        return;
      }
      setRuleSets((existing) => [result.ruleSet as ReviewRuleSet, ...existing]);
      router.refresh();
    } catch {
      setError("暂时无法连接服务，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function addManualRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!currentRuleSet || !hasCurrentRuleSet || isSaving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const description = String(form.get("description") ?? "").trim();
    const target = String(form.get("target") ?? "").trim();
    const sourceId = String(form.get("sourceId") ?? "");
    const source = sources.find((candidate) => candidate.id === sourceId);
    const quotedText = String(form.get("quotedText") ?? "").trim();
    const startOffset = source?.originalText.indexOf(quotedText) ?? -1;
    const segment = source?.segments.find(
      (item) =>
        startOffset >= item.startOffset && startOffset + quotedText.length <= item.endOffset,
    );
    if (!description || !target || !quotedText || startOffset < 0 || !segment || !source) {
      setError("请填写要求、目标材料，并引用所选来源中的完整原文片段。");
      return;
    }
    const rule: ReviewRule = {
      id: crypto.randomUUID(),
      code: "R-999",
      description,
      target,
      strength: String(form.get("strength")) as ReviewRule["strength"],
      applicabilityScope: "unknown",
      applicabilityCondition: "",
      parameters: [],
      materialIds: [],
      checkability: String(form.get("checkability")) as ReviewRule["checkability"],
      generationMethod: "manual",
      uncertainty: "",
      source: {
        sourceId: source.id,
        sourceVersion: source.version,
        displayName: source.displayName,
        paragraphIndex: segment.paragraphIndex,
        quotedText,
        startOffset,
        endOffset: startOffset + quotedText.length,
      },
    };
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: [...currentRuleSet.rules, rule] }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ruleSet" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "人工新增规则保存失败。",
        );
        return;
      }
      setRuleSets((existing) => [result.ruleSet as ReviewRuleSet, ...existing]);
      setIsAddingRule(false);
      clearUnsaved();
      setIsDirty(false);
      formElement.reset();
      router.refresh();
    } catch {
      setError("暂时无法连接服务，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="rules-heading"
      className="mt-12 max-w-4xl border-t border-border pt-7"
    >
      {!hasCurrentRuleSet && displayedRuleSet && (
        <p role="alert" className="mb-4 text-sm text-amber-900">
          来源已更新：当前来源 v{currentNoticeVersion}，旧要求基于 v{displayedRuleSet.sourceVersion}
          ，包含{" "}
          {displayedRuleSet.rules.filter((rule) => rule.generationMethod === "manual").length}{" "}
          项人工调整。请核对来源后明确选择重新整理，旧检查记录不会被改写。
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="rules-heading" className="text-sm font-semibold">
            审查要求
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
          {isExtracting ? "正在整理…" : hasCurrentRuleSet ? "重新整理审查要求" : "整理审查要求"}
        </button>
        {hasCurrentRuleSet ? (
          <button
            type="button"
            onClick={() => setIsAddingRule((visible) => !visible)}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
          >
            {isAddingRule ? "取消新增" : "新增人工规则"}
          </button>
        ) : null}
      </div>
      {isAddingRule && currentRuleSet ? (
        <form
          onSubmit={addManualRule}
          onChangeCapture={() => setIsDirty(true)}
          className="mt-5 space-y-3 border-l-2 border-primary/40 pl-4"
        >
          <label className="block text-xs font-medium">
            要求描述
            <textarea
              name="description"
              required
              maxLength={2_000}
              className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">
              目标材料
              <input
                name="target"
                required
                maxLength={200}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium">
              要求强度
              <select
                name="strength"
                defaultValue="unknown"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="required">必须</option>
                <option value="recommended">建议</option>
                <option value="optional">可选</option>
                <option value="unknown">待确认</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium">
            检查方式
            <select
              name="checkability"
              defaultValue="assisted"
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="deterministic">确定性规格</option>
              <option value="assisted">需要材料证据</option>
              <option value="unable_to_check">当前无法检查</option>
            </select>
          </label>
          <label className="block text-xs font-medium">
            要求来源
            <select
              name="sourceId"
              defaultValue={sources[0]?.id ?? ""}
              required
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium">
            来源原文引用
            <textarea
              name="quotedText"
              required
              maxLength={20_000}
              className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? "保存中…" : "保存为新规则版本"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!displayedRuleSet ? (
        <p className="mt-5 text-sm text-muted-foreground">尚未生成规则草稿。</p>
      ) : null}
      {displayedRuleSet ? (
        <div className="mt-6 space-y-5">
          {!hasCurrentRuleSet ? (
            <p className="border-l-2 border-amber-500 pl-3 text-sm leading-6 text-amber-900">
              当前来源集合与最近规则草稿不一致，请重新生成后再使用。规则生成会读取主通知及所有已添加的补充来源。
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>通知 v{displayedRuleSet.sourceVersion}</span>
            <span>
              {displayedRuleSet.mode === "live"
                ? `真实模型 · ${displayedRuleSet.provider} / ${displayedRuleSet.model}`
                : "模拟模式"}
            </span>
            <span>
              {displayedRuleSet.rules.length} 条草稿 · {displayedRuleSet.sourceVersions.length}{" "}
              个来源
            </span>
            <time dateTime={displayedRuleSet.createdAt}>
              {new Date(displayedRuleSet.createdAt).toLocaleString("zh-CN")}
            </time>
          </div>
          {displayedRuleSet.rules.length === 0 ? (
            <p className="border-l-2 border-amber-500 pl-3 text-sm leading-6">
              {displayedRuleSet.warnings[0]?.message ?? "未识别到规则草稿。"}
            </p>
          ) : null}
          {displayedRuleSet.rules.length > 0 ? (
            <section aria-label="材料要求与关联概览" className="mb-5 border-y border-border py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold">材料要求与关联概览</h3>
                <p className="text-xs text-muted-foreground">
                  {materialRequirementGroups.size} 个提交对象 ·{" "}
                  {displayedRuleSet.rules.filter((rule) => rule.materialIds.length > 0).length}{" "}
                  条规则已人工关联
                </p>
              </div>
              <ul className="mt-3 divide-y divide-border">
                {Array.from(materialRequirementGroups, ([target, group]) => {
                  const linkedMaterials = materials.filter((material) =>
                    group.materialIds.has(material.id),
                  );
                  const unassignedRules = group.rules.filter((rule) => !rule.materialIds.length);
                  const contentCandidates = candidates[target] ?? [];
                  const groupState = group.rules.every((rule) => applicability[rule.id] === false)
                    ? "不适用"
                    : group.rules.some(
                          (rule) =>
                            rule.applicabilityCondition && applicability[rule.id] === undefined,
                        )
                      ? "适用条件待确认"
                      : linkedMaterials.length
                        ? "已人工匹配"
                        : contentCandidates.length
                          ? "候选待核对"
                          : group.rules.every((rule) => rule.strength === "optional")
                            ? "未提供（选交）"
                            : "未确认匹配";

                  return (
                    <li key={target} className="py-3">
                      <p className="break-words text-xs font-medium">{target}</p>
                      <p className="mt-1 text-xs">匹配状态：{groupState}（独立于审查判定）</p>
                      {contentCandidates.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {contentCandidates.map((candidate) => (
                            <li key={candidate.materialId}>
                              内容候选：
                              {
                                materials.find((material) => material.id === candidate.materialId)
                                  ?.originalFileName
                              }{" "}
                              · {candidate.location} · {candidate.quote}。请核对后在规则中保存关联。
                            </li>
                          ))}
                        </ul>
                      )}
                      {group.rules.some((rule) =>
                        /二选一|至少一项|任意一项|或/.test(rule.description),
                      ) && (
                        <p className="mt-1 text-xs text-amber-800">
                          组合要求需按来源整体判断；关联多份文件不等于组合条件已满足。
                        </p>
                      )}
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {group.rules.map((rule) => rule.code).join("、")} ·{" "}
                        {group.rules.map((rule) => strengthLabels[rule.strength]).join("、")}
                        {group.rules.some((rule) => rule.applicabilityCondition)
                          ? " · 条件：" +
                            group.rules
                              .map((rule) => rule.applicabilityCondition)
                              .filter(Boolean)
                              .join("；")
                          : ""}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5">
                        {linkedMaterials.length
                          ? "人工关联：" +
                            linkedMaterials
                              .map(
                                (material) => material.originalFileName + " v" + material.version,
                              )
                              .join("、")
                          : "未人工关联材料"}
                        {unassignedRules.length
                          ? " · " +
                            unassignedRules.map((rule) => rule.code).join("、") +
                            " 由系统检索，尚未人工确认"
                          : ""}
                      </p>
                      {hasCurrentRuleSet ? (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                          {group.rules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              onClick={() => {
                                setEditingRule(rule);
                                document
                                  .getElementById("rule-" + rule.id)
                                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }}
                              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                            >
                              编辑 {rule.code} 关联
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {materials.length ? (
                <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">
                  未被规则人工关联的文件：
                  {materials
                    .filter(
                      (material) =>
                        !displayedRuleSet.rules.some((rule) =>
                          rule.materialIds.includes(material.id),
                        ),
                    )
                    .map((material) => material.originalFileName + " v" + material.version)
                    .join("、") || "无"}
                </p>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">尚未上传材料。</p>
              )}
            </section>
          ) : null}
          <ol className="divide-y divide-border border-y border-border">
            {displayedRuleSet.rules.map((rule) => (
              <li id={"rule-" + rule.id} key={rule.id} className="scroll-mt-6 py-5">
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
                    onChangeCapture={() => setIsDirty(true)}
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
                        placeholder="可填写：地区：浙江；考期：2026；阶段：报名；岗位：A；科目：英语。未知条件保持待确认。"
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
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-medium">
                        指定关联材料（留空时由系统匹配）
                      </legend>
                      {materials.length ? (
                        materials.map((material) => (
                          <label key={material.id} className="flex items-start gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={editingRule.materialIds.includes(material.id)}
                              onChange={(event) =>
                                setEditingRule({
                                  ...editingRule,
                                  materialIds: event.target.checked
                                    ? [...editingRule.materialIds, material.id]
                                    : editingRule.materialIds.filter((id) => id !== material.id),
                                })
                              }
                            />
                            <span>
                              {material.originalFileName} · v{material.version}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          请先上传材料，再编辑规则匹配。
                        </p>
                      )}
                    </fieldset>
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
                {rule.numericConstraints?.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    结构化数值约束：{rule.numericConstraints.map(describeBound).join("；")}
                  </p>
                ) : null}
                {rule.additionalSources?.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-primary">
                      等价要求的其他来源（{rule.additionalSources.length}）
                    </summary>
                    {rule.additionalSources.map((source, index) => (
                      <blockquote key={index} className="mt-2 border-l-2 pl-3 text-xs">
                        {source.displayName} v{source.sourceVersion} · 段落{" "}
                        {source.paragraphIndex + 1}：{source.quotedText}
                      </blockquote>
                    ))}
                  </details>
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
                    {rule.source.displayName ?? "主通知"} v{rule.source.sourceVersion} ·{" "}
                    {sources
                      .find((source) => source.id === rule.source.sourceId)
                      ?.segments.find(
                        (segment) => segment.paragraphIndex === rule.source.paragraphIndex,
                      )?.location ?? `段落 ${rule.source.paragraphIndex + 1}`}{" "}
                    · 字符 {rule.source.startOffset}–{rule.source.endOffset}
                  </span>
                  <span className="mt-1 block break-words text-foreground">
                    {rule.source.quotedText}
                  </span>
                </blockquote>
              </li>
            ))}
          </ol>
          {displayedRuleSet.warnings.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                查看 {displayedRuleSet.warnings.length} 条需要人工留意的信息
              </summary>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-800">
                {displayedRuleSet.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`} className="border-l-2 border-amber-300 pl-3">
                    <p>{warning.message}</p>
                    {warning.sources?.map((source, sourceIndex) => (
                      <p key={`${source.sourceId}-${sourceIndex}`} className="mt-1 text-foreground">
                        {source.displayName ?? "要求来源"} · {source.quotedText}
                      </p>
                    ))}
                    {hasCurrentRuleSet && warning.relatedRuleIds?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {warning.relatedRuleIds.map((ruleId) => {
                          const rule = displayedRuleSet.rules.find(
                            (candidate) => candidate.id === ruleId,
                          );
                          return rule ? (
                            <button
                              key={rule.id}
                              type="button"
                              disabled={isSaving}
                              onClick={() => void adoptConflictBasis(rule.id)}
                              className="text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                            >
                              采用 {rule.code} 并停用冲突项
                            </button>
                          ) : null;
                        })}
                      </div>
                    ) : null}
                  </li>
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
