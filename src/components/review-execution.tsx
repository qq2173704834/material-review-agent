"use client";

import { MaterialConsistencyResults } from "@/components/material-consistency-results";
import { displayDateTime } from "@/lib/display-date";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTaskWorkflow } from "@/components/task-workspace";
import type { StartOptions } from "@/components/task-workspace";
import type { ReviewRuleSet, ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";
import { hasCurrentRuleSources, reviewRuleSetSchema } from "@/domain/review-rule";
import { applicableRule } from "@/lib/review-checks";
import { needsAttention } from "@/lib/task-flow";
import { reviewSummary } from "@/lib/review-summary";
import { compareExecutions } from "@/lib/review-history";
import { ExecutionPackage, ReportDownload } from "@/components/result-export";
import { EvidencePreview } from "@/components/evidence-preview";
import { SourceEvidencePreview } from "@/components/source-evidence-preview";
import { ReviewWorkbench } from "@/components/review-workbench";
import { RemediationAssignment } from "@/components/remediation-assignment";

import {
  getRequirementSourceSegmentId,
  type RemediationTask,
  type RequirementSourceVersion,
  type ReviewExecution,
  type ReviewTaskDetails,
  type ReviewVerdict,
  type RecheckPlanItem,
} from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface ReviewExecutionProps {
  taskForConfirmation?: ReviewTaskDetails;
  taskId: string;
  initialExecutions: ReviewExecution[];
  initialRemediationTasks: RemediationTask[];
  hasCurrentRuleSet: boolean;
  mode: "mock" | "live" | "invalid";
  materials: Array<{ id: string; version: number; originalFileName: string }>;
  sources: Array<Pick<RequirementSourceVersion, "id" | "version" | "displayName">>;
}

const verdictLabels: Record<ReviewVerdict, string> = {
  passed: "通过",
  failed: "未通过",
  needs_confirmation: "待确认",
  unable_to_check: "无法检查",
  not_applicable: "不适用",
};

const verdictStyles: Record<ReviewVerdict, string> = {
  passed: "text-emerald-800",
  failed: "text-red-800",
  needs_confirmation: "text-amber-800",
  unable_to_check: "text-gray-700",
  not_applicable: "text-muted-foreground",
};

const verdictOrder: ReviewVerdict[] = [
  "failed",
  "needs_confirmation",
  "unable_to_check",
  "passed",
  "not_applicable",
];

const methodLabels = {
  deterministic: "程序核验",
  model: "模型辅助",
  unavailable: "无法执行检查",
} as const;

export function ReviewExecutionPanel({
  taskForConfirmation,
  taskId,
  initialExecutions,
  initialRemediationTasks,
  hasCurrentRuleSet,
  mode: configuredMode,
  materials,
  sources,
}: ReviewExecutionProps): ReactElement {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const mode = workflow?.mode ?? configuredMode;
  const requestModeQuery = mode === "mock" ? "mode=mock" : "";
  const runLock = useRef(false);
  const approvals = useRef({ signature: "", allowPartial: false, skipClarification: false });
  const [executions, setExecutions] = useState(initialExecutions);
  const [remediationTasks, setRemediationTasks] = useState(initialRemediationTasks);
  const [error, setError] = useState("");
  const [recheckPlan, setRecheckPlan] = useState<RecheckPlanItem[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/tasks/${taskId}/checks?${requestModeQuery}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "plan" in payload &&
          Array.isArray(payload.plan)
        )
          setRecheckPlan(payload.plan as RecheckPlanItem[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [taskId, requestModeQuery]);
  const [isRunning, setIsRunning] = useState(false);
  const [previousExecutions, setPreviousExecutions] = useState(initialExecutions);
  if (initialExecutions !== previousExecutions) {
    setPreviousExecutions(initialExecutions);
    if (!isRunning) setExecutions(initialExecutions);
  }
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();
  const requestedExecutionId = searchParams.get("execution");
  const selectedExecution =
    executions.find((item) => item.id === requestedExecutionId) ?? executions[0];
  const selectedId = selectedExecution?.id ?? "";
  const requestedRuleId = searchParams.get("rule");
  const selectedRuleId = selectedExecution?.results.some(
    (result) => result.ruleId === requestedRuleId,
  )
    ? (requestedRuleId ?? "")
    : "";
  const [activeRuleCode, setActiveRuleCode] = useState("");
  const requestedVerdict = searchParams.get("verdict");
  const verdictFilter =
    requestedVerdict === "all"
      ? "all"
      : requestedVerdict === "attention"
        ? "attention"
        : (verdictOrder.find((verdict) => verdict === requestedVerdict) ??
          (workflow ? "attention" : "all"));
  const requestedStrength = searchParams.get("strength");
  const strengthFilter =
    ["required", "recommended", "optional", "unknown"].find(
      (strength) => strength === requestedStrength,
    ) ?? "all";
  const requestedMaterial = searchParams.get("material");
  const materialFilter =
    materials.find((material) => material.id === requestedMaterial)?.id ?? "all";
  const viewStateNotice =
    (requestedExecutionId && requestedExecutionId !== selectedId) ||
    (requestedRuleId && requestedRuleId !== selectedRuleId) ||
    (requestedMaterial && materialFilter === "all")
      ? "之前查看的位置已失效，已回到当前可用结果。"
      : "";
  function updateView(values: Record<string, string>): void {
    const params = new URLSearchParams(window.location.search);
    if (selectedId) params.set("execution", selectedId);
    for (const [key, value] of Object.entries(values)) {
      if (!value || (value === "all" && key !== "verdict")) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }
  const setSelectedId = (value: string): void => updateView({ execution: value, rule: "" });
  const setSelectedRuleId = (value: string): void => updateView({ rule: value });
  const setVerdictFilter = (value: string): void => updateView({ verdict: value });
  const setStrengthFilter = (value: string): void => updateView({ strength: value });
  const setMaterialFilter = (value: string): void => updateView({ material: value });
  const [resolutionDrafts, setResolutionDrafts] = useState<
    Record<string, { decision: string; note: string }>
  >({});
  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );
  const selectedIndex = selectedId
    ? executions.findIndex((execution) => execution.id === selectedId)
    : 0;
  const currentExecution = executions[selectedIndex];
  const comparison = currentExecution
    ? compareExecutions(currentExecution, executions[selectedIndex + 1])
    : null;
  const visibleResults = (currentExecution?.results ?? [])
    .filter((result) => {
      if (verdictFilter === "attention" && !needsAttention(result)) return false;
      if (
        verdictFilter !== "all" &&
        verdictFilter !== "attention" &&
        result.verdict !== verdictFilter
      )
        return false;
      if (strengthFilter !== "all" && result.strength !== strengthFilter) return false;
      if (
        materialFilter !== "all" &&
        !result.evidence.some((evidence) => evidence.materialId === materialFilter)
      )
        return false;
      return true;
    })
    .sort((left, right) => {
      const score = (result: ReviewExecution["results"][number]): number =>
        result.verdict === "failed" && result.strength === "required"
          ? 0
          : result.verdict === "needs_confirmation"
            ? 1
            : result.verdict === "unable_to_check"
              ? 2
              : 3;
      return score(left) - score(right);
    });

  function upsertExecution(execution: ReviewExecution): void {
    setExecutions((current) => {
      const existingIndex = current.findIndex((item) => item.id === execution.id);
      if (existingIndex < 0) return [execution, ...current];
      return current.map((item, index) => (index === existingIndex ? execution : item));
    });
  }

  async function saveHumanResolution(
    event: FormEvent<HTMLFormElement>,
    ruleId: string,
  ): Promise<void> {
    event.preventDefault();
    if (!currentExecution) return;
    const draft = resolutionDrafts[ruleId] ?? { decision: "deferred", note: "" };
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/checks/resolutions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId: currentExecution.id, ruleId, ...draft }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("resolution" in payload)
      ) {
        setError(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "人工意见未能保存。",
        );
        return;
      }
      upsertExecution({
        ...currentExecution,
        humanResolutions: [
          ...(currentExecution.humanResolutions ?? []).filter((item) => item.ruleId !== ruleId),
          payload.resolution as NonNullable<ReviewExecution["humanResolutions"]>[number],
        ],
      });
    } catch {
      setError("服务暂时不可用，输入和处理状态已保留，请重试。");
    }
  }

  async function createRemediationTask(executionId: string, ruleId: string): Promise<void> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/remediations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, ruleId }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("remediationTask" in payload)
      ) {
        setError(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "整改待办创建失败。",
        );
        return;
      }
      const todo = payload.remediationTask as RemediationTask;
      setRemediationTasks((items) =>
        items.some((item) => item.id === todo.id) ? items : [todo, ...items],
      );
    } catch {
      setError("服务暂时不可用，输入和处理状态已保留，请重试。");
    }
  }

  async function updateRemediationTask(
    id: string,
    status: RemediationTask["status"],
  ): Promise<void> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/remediations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("remediationTask" in payload)
      ) {
        setError("整改待办状态更新失败。");
        return;
      }
      const todo = payload.remediationTask as RemediationTask;
      setRemediationTasks((items) => items.map((item) => (item.id === id ? todo : item)));
    } catch {
      setError("服务暂时不可用，输入和处理状态已保留，请重试。");
    }
  }

  async function refreshExecutions(): Promise<ReviewExecution[]> {
    const response = await fetch(`/api/tasks/${taskId}/checks`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (
      response.ok &&
      typeof payload === "object" &&
      payload !== null &&
      "executions" in payload &&
      Array.isArray(payload.executions)
    ) {
      setExecutions(payload.executions as ReviewExecution[]);
      return payload.executions as ReviewExecution[];
    }
    return [];
  }

  async function cancelChecks(): Promise<void> {
    abortController.current?.abort();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const refreshed = await refreshExecutions().catch(() => []);
      if (refreshed[0]?.status !== "running") break;
    }
    setProgress(null);
    setIsRunning(false);
  }

  useEffect(() => workflow?.registerCancel(cancelChecks));
  useEffect(() => workflow?.registerStart((options = {}) => runChecks(options.forceFull, options)));

  function reportFailure(message: string): void {
    setError(message);
    workflow?.reportError(message);
  }

  async function runChecks(forceFull = false, options: StartOptions = {}): Promise<void> {
    if (runLock.current || workflow?.hasActivity()) return;
    runLock.current = true;
    workflow?.setActivity("review", "正在保存并准备审查");

    setError("");
    workflow?.reportError("");
    setIsRunning(true);
    setSelectedId("");
    setActiveRuleCode("");
    setProgress({ completed: 0, total: 0 });
    const controller = new AbortController();
    abortController.current = controller;
    try {
      if (workflow) {
        if (mode === "invalid" || (mode === "live" && !workflow.hasModelConfiguration))
          throw new Error("AI服务暂不可用，请稍后重试或联系管理员。输入和材料已保留。");
        await workflow.savePreparation();
        const taskResponse = await fetch(`/api/tasks/${taskId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const taskPayload = await taskResponse.json();
        if (!taskResponse.ok || !taskPayload.task)
          throw new Error("无法读取已保存的任务，请稍后重试。");
        const freshTask = taskPayload.task as ReviewTaskDetails;
        const rulesResponse = await fetch(`/api/tasks/${taskId}/rules`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const rulesPayload = await rulesResponse.json();
        if (!rulesResponse.ok || !Array.isArray(rulesPayload.ruleSets))
          throw new Error("无法读取审查要求，请重试。");
        let currentRules = rulesPayload.ruleSets
          .map((value: unknown) => reviewRuleSetSchema.parse(value))
          .find(
            (candidate: ReviewRuleSet) =>
              candidate.sourceVersion === freshTask.noticeSource.version &&
              hasCurrentRuleSources(candidate, [
                freshTask.noticeSource,
                ...freshTask.supplementalSources,
              ]),
          );
        if (!currentRules) {
          workflow.setActivity("review", "正在整理审查要求");
          const generatedResponse = await fetch(
            `/api/tasks/${taskId}/rules?prepare=1${requestModeQuery ? `&${requestModeQuery}` : ""}`,
            {
              method: "POST",
              signal: controller.signal,
            },
          );
          const generated = await generatedResponse.json();
          if (!generatedResponse.ok) {
            workflow.openTool("requirements");
            throw new Error(
              typeof generated.error === "string" ? generated.error : "审查要求未能整理，请重试。",
            );
          }
          currentRules = reviewRuleSetSchema.parse(generated.ruleSet);
        }
        const signature = `${mode}:${freshTask.latestUpdatedAt}:${currentRules.id}:${freshTask.materials.map((item) => `${item.id}:${item.version}`).join(",")}`;
        if (approvals.current.signature !== signature)
          approvals.current = { signature, allowPartial: false, skipClarification: false };
        approvals.current.allowPartial ||= Boolean(options.allowPartial);
        approvals.current.skipClarification ||= Boolean(options.skipClarification);
        const hasPartial =
          workflow.hasPreparationProblems() ||
          [...freshTask.materials, freshTask.noticeSource, ...freshTask.supplementalSources].some(
            (item) => item.parseStatus !== "text_extracted",
          );
        if (hasPartial && !approvals.current.allowPartial) {
          workflow.setGate("partial");
          workflow.navigate("review");
          return;
        }
        const needsClarification =
          currentRules.rules.some(
            (rule: ReviewRule) => applicableRule(rule, freshTask.background) === undefined,
          ) ||
          currentRules.warnings.some(
            (warning: RuleExtractionWarning) => warning.code === "conflicting_constraints",
          );
        if (needsClarification && !approvals.current.skipClarification) {
          workflow.setGate("clarification");
          workflow.navigate("review");
          workflow.openTool("clarification");
          return;
        }
        workflow.setGate(null);
        workflow.closeTool();
        workflow.navigate("review");
        workflow.setActivity("review", "正在检查材料");
      }
      const response = await fetch(
        `/api/tasks/${taskId}/checks${forceFull || requestModeQuery ? `?${[forceFull ? "full=1" : "", requestModeQuery].filter(Boolean).join("&")}` : ""}`,
        {
          method: "POST",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json();
        reportFailure(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "检查未能完成。",
        );
        return;
      }
      if (!response.body) throw new Error("检查服务没有返回执行流。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffered += decoder.decode(value, { stream: !done });
          const messages = buffered.split("\n\n");
          buffered = messages.pop() ?? "";
          for (const message of messages) {
            const data = message
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (!data) continue;
            const event: unknown = JSON.parse(data);
            if (typeof event !== "object" || event === null || !("type" in event)) continue;
            if (event.type === "started" && "execution" in event) {
              const execution = event.execution as ReviewExecution;
              upsertExecution(execution);
              workflow?.reportExecution(execution);
              setProgress({ completed: 0, total: execution.unexecutedCount });
            } else if (
              event.type === "checking" &&
              "ruleCode" in event &&
              typeof event.ruleCode === "string"
            ) {
              setActiveRuleCode(event.ruleCode);
            } else if (
              event.type === "result" &&
              "result" in event &&
              "completedCount" in event &&
              "totalCount" in event
            ) {
              setExecutions((current) => {
                const execution = current[0];
                if (!execution) return current;
                const updated = {
                  ...execution,
                  results: [
                    ...execution.results,
                    event.result as ReviewExecution["results"][number],
                  ],
                  unexecutedCount: Number(event.totalCount) - Number(event.completedCount),
                };
                return [updated, ...current.slice(1)];
              });
              setProgress({
                completed: Number(event.completedCount),
                total: Number(event.totalCount),
              });
            } else if (event.type === "completed" && "execution" in event) {
              upsertExecution(event.execution as ReviewExecution);
              workflow?.finish(event.execution as ReviewExecution);
              approvals.current = { signature: "", allowPartial: false, skipClarification: false };
              setProgress(null);
            } else if (
              event.type === "error" &&
              "message" in event &&
              typeof event.message === "string"
            ) {
              reportFailure(event.message);
            }
          }
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        reportFailure(
          caught instanceof Error && !(caught instanceof TypeError)
            ? caught.message
            : "暂时无法连接服务，请稍后重试，已保存内容仍保留。",
        );
      }
    } finally {
      runLock.current = false;
      workflow?.setActivity("review", null);
      abortController.current = null;
      setProgress(null);
      setIsRunning(false);
      setActiveRuleCode("");
      if (controller.signal.aborted) await refreshExecutions().catch(() => []);
      router.refresh();
    }
  }

  return (
    <section
      id="stage-review"
      aria-labelledby="execution-heading"
      className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="execution-heading" className="text-sm font-semibold">
            {workflow?.view === "results" ? "自查结果" : "检查进度"}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={cancelChecks}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              取消检查
            </button>
          ) : null}
          <button
            type="button"
            hidden={Boolean(workflow)}
            onClick={() => void runChecks()}
            disabled={!hasCurrentRuleSet || isRunning}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {isRunning
              ? "正在检查…"
              : currentExecution?.validity === "needs_recheck"
                ? "重新检查"
                : "运行检查"}
          </button>
          {executions.length ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-xs text-primary">
                更多检查选项
              </summary>
              <button
                type="button"
                onClick={() => void runChecks(true)}
                disabled={!hasCurrentRuleSet || isRunning}
                className="min-h-11 rounded border border-border px-3 text-xs disabled:opacity-40"
              >
                全量复检
              </button>
            </details>
          ) : null}
        </div>
      </div>
      {recheckPlan.length ? (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer">
            本次需要重新检查的内容：{recheckPlan.filter((item) => item.action === "check").length}{" "}
            项需检查，
            {recheckPlan.filter((item) => item.action === "reuse").length} 项可复用
          </summary>
          <ul className="mt-2 space-y-1">
            {recheckPlan.map((item) => (
              <li key={item.ruleId}>
                {item.ruleCode} · {item.action === "check" ? "重新检查" : "复用"} · {item.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!hasCurrentRuleSet ? (
        <p className="mt-4 text-sm text-muted-foreground">
          点击任务头部的主按钮，系统会按需整理审查要求并开始检查。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {workflow?.view === "review" && currentExecution && (
        <section
          aria-label="本次审查进度"
          className="mt-5 space-y-4 rounded-lg border bg-muted/30 p-4"
        >
          <p role="status" className="text-sm font-medium">
            {currentExecution.status === "running"
              ? `已完成 ${progress?.completed ?? currentExecution.results.length} / ${progress?.total || currentExecution.results.length + currentExecution.unexecutedCount} 项${activeRuleCode ? ` · 正在核查 ${activeRuleCode}` : ""}`
              : currentExecution.status === "cancelled"
                ? `已取消，${currentExecution.unexecutedCount} 项未执行`
                : currentExecution.status === "failed"
                  ? `检查中断，${currentExecution.unexecutedCount} 项未执行`
                  : currentExecution.validity === "needs_recheck"
                    ? "材料已更新，请点击上方“重新检查”。下方为上次检查记录。"
                    : "上次检查已完成；点击上方“重新检查”可再次检查当前材料。"}
          </p>
          <p className="text-xs leading-6 text-muted-foreground">
            已完成结果实时保存；取消后未执行项单独保留，不会当作通过。
          </p>
          <ol aria-label="最近记录的检查结果" className="space-y-2 text-xs leading-6">
            {currentExecution.results.slice(-5).map((result) => (
              <li key={result.ruleId}>
                {result.ruleCode} · {verdictLabels[result.verdict]} · {result.requirement}
              </li>
            ))}
          </ol>
          <button
            className="min-h-11 rounded-lg border bg-card px-4 text-sm text-primary"
            onClick={() => workflow.navigate("results")}
          >
            查看已记录结果与证据
          </button>
        </section>
      )}
      {!currentExecution ? (
        <p className="mt-5 text-sm text-muted-foreground">
          尚无检查结果。准备好要求与材料后，点击上方主按钮开始。
        </p>
      ) : (
        <div className="mt-5" hidden={workflow?.view === "review"}>
          {executions.length > 1 ? (
            <label className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              检查记录 · 选择历史时仅查看当时版本
              <select
                aria-label="选择检查记录"
                disabled={isRunning}
                value={currentExecution.id}
                onChange={(event) => setSelectedId(event.target.value)}
                className="max-w-full rounded-md border border-border bg-background p-2"
              >
                {executions.map((execution) => (
                  <option key={execution.id} value={execution.id}>
                    {displayDateTime(execution.createdAt)} · {execution.results.length} 项 ·{" "}
                    {execution.id !== executions[0]?.id ? "历史记录 · " : "最新记录 · "}
                    {execution.validity === "needs_recheck" ? "待复检" : "当时数据版本"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {currentExecution.validity === "needs_recheck" ? (
            <p
              role="status"
              className="mb-4 border-l-2 border-amber-500 pl-3 text-sm leading-6 text-amber-900"
            >
              待复检：{currentExecution.invalidationReasons?.join("；")}
              。下方保留原始结论，请重新检查当前材料。
            </p>
          ) : null}
          <MaterialConsistencyResults
            checks={currentExecution.metadata?.materialConsistency || []}
            task={taskForConfirmation}
          />
          <div className="mb-5 rounded-2xl bg-primary/5 p-5" aria-label="自查结论">
            <h3 className="text-lg font-semibold">{reviewSummary(currentExecution).title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {reviewSummary(currentExecution).description}
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <span className="text-red-800">需修改 {reviewSummary(currentExecution).failed}</span>
              <span className="text-amber-900">
                待确认 / 未完成 {reviewSummary(currentExecution).pending}
              </span>
              <span className="text-emerald-800">
                已通过 {reviewSummary(currentExecution).passed}
              </span>
            </div>
            {currentExecution.metadata?.mode === "mock" && (
              <p className="mt-2 text-xs">模拟演示，不代表真实内容核验。</p>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {currentExecution.status !== "running" ? (
              <div id="stage-report" className="flex flex-wrap gap-x-4 gap-y-2">
                <ReportDownload
                  href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}`}
                  label="导出 Markdown 报告"
                  fileName="材料预审报告.md"
                />
                <a
                  href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}&format=html`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
                >
                  报告预览 / 打印 PDF
                </a>
                <ReportDownload
                  href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}&type=remediation`}
                  label="导出整改清单"
                  fileName="整改清单.md"
                />
              </div>
            ) : null}
          </div>
          {comparison?.canCompare ? (
            <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs leading-6">
              与上次同规则检查比较：已解决 {comparison.resolved.length} · 仍存在{" "}
              {comparison.remaining.length} · 新增 {comparison.newIssues.length} · 变化待确认{" "}
              {comparison.unconfirmed.length}。只有未通过变为通过才计为已解决。
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              按判定筛选
              <select
                aria-label="按判定筛选"
                value={verdictFilter}
                onChange={(event) => setVerdictFilter(event.target.value as "all" | ReviewVerdict)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                <option value="attention">需处理的问题</option>
                <option value="all">全部判定</option>
                {verdictOrder.map((verdict) => (
                  <option key={verdict} value={verdict}>
                    {verdictLabels[verdict]}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
                更多筛选
              </summary>
              <div className="grid gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  按要求强度筛选
                  <select
                    aria-label="按要求强度筛选"
                    value={strengthFilter}
                    onChange={(event) => setStrengthFilter(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="all">全部强度</option>
                    <option value="required">必须</option>
                    <option value="recommended">建议</option>
                    <option value="optional">可选</option>
                    <option value="unknown">待确认强度</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  按材料筛选
                  <select
                    aria-label="按材料筛选"
                    value={materialFilter}
                    onChange={(event) => setMaterialFilter(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="all">全部材料</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.originalFileName} · v{material.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p aria-live="polite">
              当前显示 {visibleResults.length} 项，共 {currentExecution.results.length} 项检查结果
            </p>
            {verdictFilter !== "all" || strengthFilter !== "all" || materialFilter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  updateView({ verdict: "all", strength: "all", material: "all" });
                }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                清除筛选
              </button>
            ) : null}
          </div>
          {viewStateNotice ? (
            <p role="status" className="mt-2 text-xs text-amber-800">
              {viewStateNotice}
            </p>
          ) : null}
          <details
            className="py-3"
            open={Boolean(selectedRuleId) || searchParams.get("workspace") === "1"}
          >
            <summary className="cursor-pointer text-xs text-primary">高级查看</summary>
            <button
              className="min-h-11 rounded border border-border px-3 text-xs"
              onClick={() =>
                updateView({ workspace: searchParams.get("workspace") === "1" ? "" : "1" })
              }
            >
              {searchParams.get("workspace") === "1" ? "收起联动工作台" : "打开联动工作台"}
            </button>
            {(searchParams.get("workspace") === "1" || Boolean(workflow && selectedRuleId)) && (
              <ReviewWorkbench
                taskId={taskId}
                executionId={currentExecution.id}
                sourceVersion={currentExecution.sourceVersion}
                results={visibleResults}
                selectedRuleId={selectedRuleId}
                onSelect={setSelectedRuleId}
              />
            )}
          </details>
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {visibleResults.map((result, index) => {
              const source = sources.find(
                (candidate) =>
                  candidate.id === result.source.sourceId &&
                  (result.source.sourceVersion === undefined ||
                    candidate.version === result.source.sourceVersion),
              );
              const sourceSegmentId = source
                ? getRequirementSourceSegmentId(
                    source.id,
                    source.version,
                    result.source.paragraphIndex,
                  )
                : undefined;
              const sourceLabel = `来源 · ${result.source.displayName ?? source?.displayName ?? "要求来源"} v${result.source.sourceVersion ?? currentExecution.sourceVersion} / 段落 ${result.source.paragraphIndex + 1}`;

              return (
                <li
                  id={`execution-${currentExecution.id}-result-${result.ruleId}`}
                  key={result.ruleId}
                  className={`scroll-mt-6 py-4 ${selectedRuleId === result.ruleId ? "bg-muted/30" : ""}`}
                >
                  {(index === 0 || visibleResults[index - 1]?.verdict !== result.verdict) && (
                    <p className="mb-3 text-xs font-semibold text-muted-foreground">
                      {result.verdict === "failed"
                        ? "需要修改 / 可改进项"
                        : result.verdict === "passed"
                          ? "已通过"
                          : result.verdict === "not_applicable"
                            ? "不适用"
                            : "需要确认"}
                    </p>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">
                      <button
                        type="button"
                        aria-pressed={selectedRuleId === result.ruleId}
                        onClick={() => {
                          setSelectedRuleId(result.ruleId);
                        }}
                        className="text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {result.requirement}
                      </button>
                    </h3>
                    <span className={`text-xs font-semibold ${verdictStyles[result.verdict]}`}>
                      {verdictLabels[result.verdict]}
                      {result.strength === "recommended"
                        ? " · 建议项"
                        : result.strength === "optional"
                          ? " · 可选项"
                          : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.reason}</p>
                  {workflow && needsAttention(result) && (
                    <div
                      className="mt-3 flex flex-wrap gap-2"
                      aria-label={`${result.ruleCode} 问题处理`}
                    >
                      <button
                        className="min-h-11 rounded-lg border px-3 text-xs text-primary"
                        onClick={() =>
                          workflow.openTool(
                            "materials",
                            result.evidence[0]
                              ? `material-${result.evidence[0].materialId}`
                              : "material-files",
                          )
                        }
                      >
                        修改材料
                      </button>
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-xs text-primary">
                          更多操作
                        </summary>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="min-h-11 rounded-lg border px-3 text-xs text-primary"
                            onClick={() => workflow.openTool("clarification")}
                          >
                            补充条件背景
                          </button>
                          <button
                            className="min-h-11 rounded-lg border px-3 text-xs text-primary"
                            onClick={() =>
                              workflow.openTool("requirements", `rule-${result.ruleId}`)
                            }
                          >
                            更换材料 / 选择依据
                          </button>
                          {currentExecution.validity === "needs_recheck" && (
                            <button
                              className="min-h-11 rounded-lg border px-3 text-xs text-primary"
                              onClick={() => void runChecks()}
                            >
                              复查受影响项
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                  {result.recommendation ? (
                    <p className="mt-2 text-xs leading-5 text-primary">
                      建议：{result.recommendation}
                    </p>
                  ) : null}
                  {result.evidence[0] && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      材料依据：{result.evidence[0].quotedText}
                    </p>
                  )}
                  {result.coverage && !result.coverage.isComplete && (
                    <p className="mt-2 text-xs text-amber-900">部分内容未能完整检查，请核对。</p>
                  )}
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
                      查看依据
                    </summary>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        检查详情
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">编号：{result.ruleCode}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        检查方法：{result.method ? methodLabels[result.method] : "未记录"}
                      </p>
                      {result.reusedFrom ? (
                        <p className="mt-1 text-xs text-primary">
                          复用结果 · 原检查时间 {result.reusedFrom.checkedAt} · 原执行{" "}
                          {result.reusedFrom.executionId.slice(0, 8)}；本轮未重复调用工具或模型。
                        </p>
                      ) : result.checkedAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          本轮检查 · {result.checkedAt}
                        </p>
                      ) : null}
                    </details>
                    <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
                      {sourceSegmentId ? (
                        <a
                          href={`#${sourceSegmentId}`}
                          onClick={() => {
                            const target = document.getElementById(sourceSegmentId);
                            const details = target?.closest("details");
                            if (details) details.open = true;
                          }}
                          className="text-primary underline underline-offset-4"
                        >
                          {sourceLabel}
                        </a>
                      ) : (
                        <span>{sourceLabel} · 原文当前不可定位</span>
                      )}
                      ：{result.source.quotedText}
                      <SourceEvidencePreview
                        taskId={taskId}
                        executionId={currentExecution.id}
                        source={result.source}
                        sourceVersion={currentExecution.sourceVersion}
                      />
                    </blockquote>
                    {result.coverage ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        核查片段 {result.coverage.examinedSegments}/{result.coverage.totalSegments}{" "}
                        ·{" "}
                        {result.coverage.isComplete
                          ? "已解析文本完整纳入本项上下文"
                          : "片段覆盖或解析存在限制，请人工复核"}
                      </p>
                    ) : null}
                    {result.evidence.length ? (
                      <EvidencePreview taskId={taskId} evidence={result.evidence} />
                    ) : null}
                    {result.evidence.length ? (
                      <ul className="mt-3 space-y-2 text-xs leading-5">
                        {result.evidence.map((evidence, index) => (
                          <li
                            key={`${evidence.materialId}-${index}`}
                            className="break-words text-muted-foreground"
                          >
                            <EvidencePreview
                              taskId={taskId}
                              evidence={[evidence]}
                              triggerLabel="定位证据"
                              compact
                            />
                            ：{evidence.quotedText} · {evidence.location} · 材料 v
                            {evidence.materialVersion}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                  {currentExecution.status === "completed" &&
                  result.strength === "required" &&
                  result.verdict === "failed" ? (
                    remediationTasks.some(
                      (todo) =>
                        todo.executionId === currentExecution.id && todo.ruleId === result.ruleId,
                    ) ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void createRemediationTask(currentExecution.id, result.ruleId)
                        }
                        className="mt-3 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                      >
                        加入我的待办
                      </button>
                    )
                  ) : null}
                  {!isRunning &&
                  ["failed", "needs_confirmation", "unable_to_check"].includes(result.verdict) ? (
                    <details className="mt-3">
                      <summary className="min-h-11 cursor-pointer py-3 text-xs text-primary">
                        人工备注
                        {currentExecution.humanResolutions?.some(
                          (item) => item.ruleId === result.ruleId,
                        )
                          ? " · 已保存"
                          : ""}
                      </summary>
                      <form
                        onSubmit={(event) => void saveHumanResolution(event, result.ruleId)}
                        className="mt-4 border-l-2 border-border pl-3"
                      >
                        <p className="text-xs font-medium">人工备注（不改变检查结论）</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                          <select
                            aria-label={`${result.ruleCode} 人工复核意见`}
                            value={
                              resolutionDrafts[result.ruleId]?.decision ??
                              currentExecution.humanResolutions?.find(
                                (item) => item.ruleId === result.ruleId,
                              )?.decision ??
                              "deferred"
                            }
                            onChange={(event) =>
                              setResolutionDrafts((drafts) => ({
                                ...drafts,
                                [result.ruleId]: {
                                  ...(drafts[result.ruleId] ?? { note: "" }),
                                  decision: event.target.value,
                                },
                              }))
                            }
                            className="h-9 rounded-md border border-border bg-background px-2 text-xs"
                          >
                            <option value="confirmed">人工认为符合</option>
                            <option value="rejected">人工认为不符合</option>
                            <option value="deferred">暂不确认</option>
                          </select>
                          <input
                            aria-label={`${result.ruleCode} 复核依据`}
                            maxLength={2_000}
                            placeholder="填写复核依据"
                            value={
                              resolutionDrafts[result.ruleId]?.note ??
                              currentExecution.humanResolutions?.find(
                                (item) => item.ruleId === result.ruleId,
                              )?.note ??
                              ""
                            }
                            onChange={(event) =>
                              setResolutionDrafts((drafts) => ({
                                ...drafts,
                                [result.ruleId]: {
                                  ...(drafts[result.ruleId] ?? { decision: "deferred" }),
                                  note: event.target.value,
                                },
                              }))
                            }
                            className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
                          />
                          <button
                            type="submit"
                            className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                          >
                            保存意见
                          </button>
                        </div>
                        {currentExecution.humanResolutions?.find(
                          (item) => item.ruleId === result.ruleId,
                        ) ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            已保存人工意见：
                            {
                              (
                                {
                                  confirmed: "认为符合",
                                  rejected: "认为不符合",
                                  deferred: "暂不确认",
                                } as const
                              )[
                                currentExecution.humanResolutions.find(
                                  (item) => item.ruleId === result.ruleId,
                                )!.decision
                              ]
                            }{" "}
                            ·{" "}
                            {currentExecution.humanResolutions.find(
                              (item) => item.ruleId === result.ruleId,
                            )!.note || "未填写依据"}
                          </p>
                        ) : null}
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {currentExecution.status !== "running" && (
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
                更多导出选项
              </summary>
              <ReportDownload
                href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}&detail=full`}
                label="导出完整检查记录"
                fileName="完整检查记录.md"
              />
              <ExecutionPackage
                key={currentExecution.id}
                taskId={taskId}
                execution={currentExecution}
                materials={materials}
              />
            </details>
          )}
          {visibleResults.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">
              <span>
                {verdictFilter === "attention"
                  ? "已记录的检查结果中暂无需处理问题；可查看全部判定，未核验范围仍需单独确认。"
                  : "当前筛选没有匹配的检查项。"}
              </span>
              <button
                type="button"
                onClick={() => {
                  updateView({ verdict: "all", strength: "all", material: "all" });
                }}
                className="ml-2 font-medium text-primary underline underline-offset-4"
              >
                清除筛选
              </button>
            </p>
          ) : null}
          {executions.length > 1 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              已保留 {executions.length} 次检查快照。
            </p>
          ) : null}
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
              我的修改待办 · {remediationTasks.length}
            </summary>
            <section
              id="stage-remediation"
              aria-labelledby="remediation-heading"
              className="mt-8 border-t border-border pt-5"
            >
              <h3 id="remediation-heading" className="text-sm font-semibold">
                整改待办 · {remediationTasks.length}
              </h3>
              {remediationTasks.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">当前没有已创建的整改待办。</p>
              ) : null}
              {remediationTasks.length > 0 ? (
                <>
                  <ol className="mt-3 divide-y divide-border border-y border-border">
                    {remediationTasks.map((todo) => (
                      <li
                        key={todo.id}
                        className="flex flex-wrap items-start justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {todo.ruleCode} · {todo.requirement}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {todo.reason}
                          </p>
                          <RemediationAssignment
                            taskId={taskId}
                            todo={todo}
                            onUpdated={(updated) =>
                              setRemediationTasks((items) =>
                                items.map((item) => (item.id === updated.id ? updated : item)),
                              )
                            }
                          />
                          {todo.recommendation ? (
                            <p className="mt-1 text-xs text-primary">建议：{todo.recommendation}</p>
                          ) : null}
                          <a
                            className="mt-1 inline-block text-xs text-primary underline"
                            href={`/tasks/${taskId}#execution-${todo.executionId}-result-${todo.ruleId}`}
                          >
                            来源执行 {todo.executionId.slice(0, 8)} · {todo.materialIds.length}{" "}
                            份关联材料
                          </a>
                        </div>
                        <select
                          aria-label={`${todo.ruleCode} 整改待办状态`}
                          value={todo.status}
                          onChange={(event) =>
                            void updateRemediationTask(
                              todo.id,
                              event.target.value as RemediationTask["status"],
                            )
                          }
                          className="h-9 rounded-md border border-border bg-background px-2 text-xs"
                        >
                          <option value="open">待处理</option>
                          <option value="in_progress">处理中</option>
                          <option value="done">已处理</option>
                        </select>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs text-muted-foreground">
                    待办状态只记录人工处理进度，不改变检查结论；完成后需重新检查确认。
                  </p>
                </>
              ) : null}
            </section>
          </details>
        </div>
      )}
    </section>
  );
}
