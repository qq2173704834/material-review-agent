"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { applicableRule } from "@/lib/review-checks";
import { useTaskActivity, useTaskWorkflow } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

import type { ReviewRuleSet } from "@/domain/review-rule";
import type { ReviewTaskDetails } from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface ClarificationPanelProps {
  task: ReviewTaskDetails;
  currentRuleSet?: ReviewRuleSet;
}

export function ClarificationPanel({
  task,
  currentRuleSet,
}: ClarificationPanelProps): ReactElement | null {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const [dismissed, setDismissed] = useState(false);
  const [scope, setScope] = useState(task.background.collaborationScope);
  const [projectStage, setProjectStage] = useState(task.background.projectStage);
  const [projectType, setProjectType] = useState(task.background.projectType);
  const [conditionAnswers, setConditionAnswers] = useState(task.background.conditionAnswers ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useTaskActivity("clarification-save", saving ? "正在保存补充信息" : null);
  const clearUnsaved = useUnsavedChanges(
    !dismissed &&
      (scope !== task.background.collaborationScope ||
        projectStage !== task.background.projectStage ||
        projectType !== task.background.projectType ||
        JSON.stringify(conditionAnswers) !==
          JSON.stringify(task.background.conditionAnswers ?? [])),
  );
  if (!currentRuleSet || (dismissed && !workflow)) return null;

  const scopeRules = currentRuleSet.rules.filter(
    (rule) =>
      rule.applicabilityScope !== "unknown" && task.background.collaborationScope === "unknown",
  );
  const stageRules = currentRuleSet.rules.filter(
    (rule) =>
      !task.background.projectStage &&
      /阶段|初赛|预赛|复赛|半决赛|决赛|申报|结项/.test(rule.applicabilityCondition),
  );
  const typeRules = currentRuleSet.rules.filter(
    (rule) => !task.background.projectType && /类别|类型|领域/.test(rule.applicabilityCondition),
  );
  const unresolved = [
    ...new Set(
      currentRuleSet.rules
        .filter(
          (rule) =>
            rule.applicabilityCondition && applicableRule(rule, task.background) === undefined,
        )
        .map((rule) => rule.applicabilityCondition),
    ),
  ];
  const conflicts = currentRuleSet.warnings.filter(
    (warning) => warning.code === "conflicting_constraints",
  );
  const relatedRules = currentRuleSet.rules.filter(
    (rule) =>
      scopeRules.includes(rule) ||
      stageRules.includes(rule) ||
      typeRules.includes(rule) ||
      unresolved.includes(rule.applicabilityCondition),
  );
  if (!relatedRules.length && !conflicts.length) return null;

  async function saveAnswers(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: task.name,
          description: task.description,
          noticeText: task.noticeSource.originalText,
          background: {
            ...task.background,
            collaborationScope: scope,
            projectStage,
            projectType,
            conditionAnswers,
          },
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "补充信息未能保存。",
        );
        return;
      }
      clearUnsaved();
      workflow?.setGate(null);
      workflow?.closeTool();
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="clarification-heading"
      className="mt-8 max-w-4xl border-y border-amber-300 bg-amber-50/60 py-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <h2 id="clarification-heading" className="text-sm font-semibold">
            需要补充的信息
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            这些信息可能改变适用范围；暂不回答时，相关检查会保留待确认。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (workflow) workflow.closeTool();
            else setDismissed(true);
          }}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          暂时跳过
        </button>
      </div>
      {relatedRules.length > 0 && (
        <details className="mt-4 rounded-lg border border-amber-200 p-3" open>
          <summary className="cursor-pointer text-xs font-medium">
            相关要求原文（{relatedRules.length}）
          </summary>
          <ul className="mt-2 space-y-3 text-xs leading-6">
            {relatedRules.map((rule) => (
              <li key={rule.id}>
                <p>
                  {rule.code} · {rule.description}
                </p>
                <blockquote className="border-l-2 border-amber-400 pl-3">
                  {rule.source.quotedText}
                </blockquote>
                <p className="text-muted-foreground">
                  {rule.source.displayName ?? "通知原文"} · v{rule.source.sourceVersion} · 段落{" "}
                  {rule.source.paragraphIndex + 1}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {conflicts.length > 0 && (
        <section
          aria-label="需要选择依据的来源冲突"
          className="mt-4 space-y-3 rounded-lg border border-amber-300 p-3 text-xs leading-6"
        >
          <p className="font-medium">
            以下要求互相冲突，请核对双方原文；未选择时相关项保留待确认。
          </p>
          {conflicts.map((warning, index) => (
            <div key={index}>
              <p>{warning.message}</p>
              {(warning.sources ?? (warning.source ? [warning.source] : [])).map(
                (source, sourceIndex) => (
                  <blockquote key={sourceIndex} className="my-2 border-l-2 border-amber-400 pl-3">
                    {source.quotedText}
                    <footer>
                      {source.displayName ?? "通知原文"} · v{source.sourceVersion} · 段落{" "}
                      {source.paragraphIndex + 1}
                    </footer>
                  </blockquote>
                ),
              )}
            </div>
          ))}
          {workflow && (
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3 text-primary"
              onClick={() => workflow.openTool("requirements")}
            >
              查看冲突并选择采用依据
            </button>
          )}
        </section>
      )}
      {relatedRules.length > 0 && (
        <form onSubmit={saveAnswers} className="mt-4 space-y-4 px-1">
          {scopeRules.length ? (
            <label className="block text-xs font-medium">
              本项目是个人还是团队参与？影响 {scopeRules.map((rule) => rule.code).join("、")}
              <select
                aria-label="补充参与范围"
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="unknown">暂不确定</option>
                <option value="individual">个人项目</option>
                <option value="team">团队项目</option>
              </select>
            </label>
          ) : null}
          {stageRules.length ? (
            <label className="block text-xs font-medium">
              当前项目所处阶段是什么？影响 {stageRules.map((rule) => rule.code).join("、")}
              <input
                aria-label="补充项目阶段"
                maxLength={80}
                value={projectStage}
                onChange={(event) => setProjectStage(event.target.value)}
                placeholder="例如：初赛、复赛、申报、结项"
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </label>
          ) : null}
          {typeRules.length ? (
            <label className="block text-xs font-medium">
              项目类型或领域是什么？影响 {typeRules.map((rule) => rule.code).join("、")}
              <input
                aria-label="补充项目类型"
                maxLength={80}
                value={projectType}
                onChange={(event) => setProjectType(event.target.value)}
                placeholder="填写项目类型或领域"
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </label>
          ) : null}
          {unresolved.map((condition) => (
            <label className="block text-xs font-medium" key={condition}>
              是否满足条件：{condition}？影响{" "}
              {currentRuleSet.rules
                .filter((rule) => rule.applicabilityCondition === condition)
                .map((rule) => rule.code)
                .join("、")}
              <select
                aria-label={"确认条件：" + condition}
                className="mt-1 h-10 w-full rounded-md border px-3"
                value={String(
                  conditionAnswers.find((answer) => answer.condition === condition)?.applies ??
                    "unknown",
                )}
                onChange={(event) =>
                  setConditionAnswers((previous) => [
                    ...previous.filter((answer) => answer.condition !== condition),
                    ...(event.target.value === "unknown"
                      ? []
                      : [
                          {
                            condition,
                            applies: event.target.value === "true",
                            note: "用户在澄清面板确认完整适用条件",
                          },
                        ]),
                  ])
                }
              >
                <option value="unknown">暂不确定，保留待确认</option>
                <option value="true">是，整个条件成立</option>
                <option value="false">否，整个条件不成立</option>
              </select>
            </label>
          ))}
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "正在保存…" : "保存补充信息"}
          </button>
        </form>
      )}
    </section>
  );
}
