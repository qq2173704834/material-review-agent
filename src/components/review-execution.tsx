"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compareExecutions } from "@/lib/review-history";

import {
  getRequirementSourceSegmentId,
  type RemediationTask,
  type RequirementSourceVersion,
  type ReviewExecution,
  type ReviewVerdict,
} from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface ReviewExecutionProps {
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
  taskId,
  initialExecutions,
  initialRemediationTasks,
  hasCurrentRuleSet,
  mode,
  materials,
  sources,
}: ReviewExecutionProps): ReactElement {
  const router = useRouter();
  const [executions, setExecutions] = useState(initialExecutions);
  const [remediationTasks, setRemediationTasks] = useState(initialRemediationTasks);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [activeRuleCode, setActiveRuleCode] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<"all" | ReviewVerdict>("all");
  const [strengthFilter, setStrengthFilter] = useState("all");
  const [materialFilter, setMaterialFilter] = useState("all");
  const hasSyncedViewState = useRef(false);
  const [resolutionDrafts, setResolutionDrafts] = useState<
    Record<string, { decision: string; note: string }>
  >({});
  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    function restoreViewState(): void {
      const params = new URLSearchParams(window.location.search);
      const executionId = params.get("execution");
      const execution = executions.find((item) => item.id === executionId);
      const ruleId = params.get("rule");
      const verdict = params.get("verdict");
      const strength = params.get("strength");
      const materialId = params.get("material");

      setSelectedId(execution?.id ?? "");
      setSelectedRuleId(
        execution?.results.some((result) => result.ruleId === ruleId) ? (ruleId ?? "") : "",
      );
      setVerdictFilter(
        verdict === "passed" ||
          verdict === "failed" ||
          verdict === "needs_confirmation" ||
          verdict === "unable_to_check" ||
          verdict === "not_applicable"
          ? verdict
          : "all",
      );
      setStrengthFilter(
        strength === "required" ||
          strength === "recommended" ||
          strength === "optional" ||
          strength === "unknown"
          ? strength
          : "all",
      );
      setMaterialFilter(
        materials.some((material) => material.id === materialId) ? materialId! : "all",
      );
    }

    restoreViewState();
    window.addEventListener("popstate", restoreViewState);
    return () => window.removeEventListener("popstate", restoreViewState);
  }, [executions, materials]);
  useEffect(() => {
    if (!hasSyncedViewState.current) {
      hasSyncedViewState.current = true;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const nextValues: Array<[string, string]> = [
      ["execution", selectedId],
      ["rule", selectedRuleId],
      ["verdict", verdictFilter],
      ["strength", strengthFilter],
      ["material", materialFilter],
    ];
    for (const [key, value] of nextValues) {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [selectedId, selectedRuleId, verdictFilter, strengthFilter, materialFilter]);
  const selectedIndex = selectedId
    ? executions.findIndex((execution) => execution.id === selectedId)
    : 0;
  const currentExecution = executions[selectedIndex];
  const comparison = currentExecution
    ? compareExecutions(currentExecution, executions[selectedIndex + 1])
    : null;
  const counts = new Map<ReviewVerdict, number>();
  currentExecution?.results.forEach((result) => {
    counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
  });
  const visibleResults = (currentExecution?.results ?? []).filter((result) => {
    if (verdictFilter !== "all" && result.verdict !== verdictFilter) return false;
    if (strengthFilter !== "all" && result.strength !== strengthFilter) return false;
    if (
      materialFilter !== "all" &&
      !result.evidence.some((evidence) => evidence.materialId === materialFilter)
    )
      return false;
    return true;
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
  }

  async function createRemediationTask(executionId: string, ruleId: string): Promise<void> {
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
  }

  async function updateRemediationTask(
    id: string,
    status: RemediationTask["status"],
  ): Promise<void> {
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

  async function runChecks(): Promise<void> {
    setError("");
    setIsRunning(true);
    setSelectedId("");
    setActiveRuleCode("");
    setProgress({ completed: 0, total: 0 });
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const response = await fetch(`/api/tasks/${taskId}/checks`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        setError(
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
              setProgress(null);
            } else if (
              event.type === "error" &&
              "message" in event &&
              typeof event.message === "string"
            ) {
              setError(event.message);
            }
          }
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("暂时无法连接本地服务，请稍后重试。");
      }
    } finally {
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
      aria-labelledby="execution-heading"
      className="mt-12 max-w-4xl border-t border-border pt-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="execution-heading" className="text-sm font-semibold">
            {mode === "live" ? "材料审查" : "确定性检查"}
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {mode === "live"
              ? "规格由程序核验，内容由真实模型结合材料证据审查；片段将发送到你配置的模型服务。"
              : "本地规格工具；模拟模式不进行真实模型语义审查，未核验的规则不会自动判为通过。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={runChecks}
            disabled={!hasCurrentRuleSet || isRunning}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {isRunning
              ? "正在检查…"
              : currentExecution?.validity === "needs_recheck"
                ? "重新检查"
                : "运行检查"}
          </button>
        </div>
      </div>
      {!hasCurrentRuleSet ? (
        <p className="mt-4 text-sm text-muted-foreground">请先为当前通知生成规则草稿。</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!currentExecution ? (
        <p className="mt-5 text-sm text-muted-foreground">尚无检查结果。</p>
      ) : (
        <div className="mt-5">
          {executions.length > 1 ? (
            <label className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              执行历史
              <select
                aria-label="选择检查快照"
                disabled={isRunning}
                value={currentExecution.id}
                onChange={(event) => setSelectedId(event.target.value)}
                className="max-w-full rounded-md border border-border bg-background p-2"
              >
                {executions.map((execution) => (
                  <option key={execution.id} value={execution.id}>
                    {new Date(execution.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {execution.results.length} 项 ·{" "}
                    {execution.validity === "needs_recheck" ? "待复检" : "当前版本"}
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
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>{currentExecution.results.length} 项规则</span>
            {currentExecution.status === "running" && progress ? (
              <span aria-live="polite">
                已完成 {progress.completed} / {progress.total} 项
                {activeRuleCode ? ` · 正在核查 ${activeRuleCode}` : ""}
              </span>
            ) : null}
            {currentExecution.status === "cancelled" ? (
              <span>已取消，{currentExecution.unexecutedCount} 项未执行</span>
            ) : null}
            {currentExecution.status === "failed" ? (
              <span className="text-red-700">
                检查中断，{currentExecution.unexecutedCount} 项未执行
              </span>
            ) : null}
            {verdictOrder.map((verdict) =>
              (counts.get(verdict) ?? 0) > 0 ? (
                <span key={verdict} className={verdictStyles[verdict]}>
                  {verdictLabels[verdict]} {counts.get(verdict)}
                </span>
              ) : null,
            )}
            <span>通知 v{currentExecution.sourceVersion}</span>
            <time dateTime={currentExecution.completedAt || currentExecution.createdAt}>
              {new Date(currentExecution.completedAt || currentExecution.createdAt).toLocaleString(
                "zh-CN",
              )}
            </time>
            {currentExecution.status !== "running" ? (
              <>
                <a
                  href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  导出 Markdown 报告
                </a>
                <a
                  href={`/api/tasks/${taskId}/report?executionId=${currentExecution.id}&type=remediation`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  导出整改清单
                </a>
              </>
            ) : null}
          </div>
          {comparison?.canCompare ? (
            <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs leading-6">
              与上次同规则检查比较：已解决 {comparison.resolved.length} · 仍存在{" "}
              {comparison.remaining.length} · 新增 {comparison.newIssues.length} · 变化待确认{" "}
              {comparison.unconfirmed.length}。只有未通过变为通过才计为已解决。
            </p>
          ) : null}
          {currentExecution.metadata ? (
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              {currentExecution.metadata.mode === "live"
                ? `真实模型 · ${currentExecution.metadata.provider} / ${currentExecution.metadata.model}`
                : "本地模拟模式"}{" "}
              · 模型步骤 {currentExecution.metadata.modelCalls.length} · 输入{" "}
              {currentExecution.metadata.modelCalls.reduce(
                (total, call) => total + (call.inputTokens ?? 0),
                0,
              )}{" "}
              / 输出{" "}
              {currentExecution.metadata.modelCalls.reduce(
                (total, call) => total + (call.outputTokens ?? 0),
                0,
              )}{" "}
              token（仅已报告用量）
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-muted-foreground">
              按判定筛选
              <select
                aria-label="按判定筛选"
                value={verdictFilter}
                onChange={(event) => setVerdictFilter(event.target.value as "all" | ReviewVerdict)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                <option value="all">全部判定</option>
                {verdictOrder.map((verdict) => (
                  <option key={verdict} value={verdict}>
                    {verdictLabels[verdict]}
                  </option>
                ))}
              </select>
            </label>
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
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {visibleResults.map((result) => {
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
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">
                      <button
                        type="button"
                        aria-pressed={selectedRuleId === result.ruleId}
                        onClick={() => setSelectedRuleId(result.ruleId)}
                        className="text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {result.ruleCode} · {result.requirement}
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    检查方法：{result.method ? methodLabels[result.method] : "未记录"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.reason}</p>
                  {result.recommendation ? (
                    <p className="mt-2 text-xs leading-5 text-primary">
                      建议：{result.recommendation}
                    </p>
                  ) : null}
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
                  </blockquote>
                  {result.coverage ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      核查片段 {result.coverage.examinedSegments}/{result.coverage.totalSegments} ·{" "}
                      {result.coverage.isComplete
                        ? "已解析文本完整纳入本项上下文"
                        : "片段覆盖或解析存在限制，请人工复核"}
                    </p>
                  ) : null}
                  {result.evidence.length ? (
                    <ul className="mt-3 space-y-2 text-xs leading-5">
                      {result.evidence.map((evidence, index) => (
                        <li
                          key={`${evidence.materialId}-${index}`}
                          className="break-words text-muted-foreground"
                        >
                          {evidence.segmentIndex !== undefined &&
                          materials.some(
                            (material) =>
                              material.id === evidence.materialId &&
                              material.version === evidence.materialVersion,
                          ) ? (
                            <a
                              href={`#material-${evidence.materialId}-segment-${evidence.segmentIndex}`}
                              onClick={() => {
                                const element = document.getElementById(
                                  `material-${evidence.materialId}-segment-${evidence.segmentIndex}`,
                                );
                                const details = element?.closest("details");
                                if (details) details.open = true;
                              }}
                              className="text-primary underline underline-offset-4"
                            >
                              定位证据
                            </a>
                          ) : (
                            "证据"
                          )}
                          ：{evidence.quotedText} · {evidence.location} · 材料 v
                          {evidence.materialVersion}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
                        创建整改待办
                      </button>
                    )
                  ) : null}
                  {!isRunning &&
                  ["needs_confirmation", "unable_to_check"].includes(result.verdict) ? (
                    <form
                      onSubmit={(event) => void saveHumanResolution(event, result.ruleId)}
                      className="mt-4 border-l-2 border-border pl-3"
                    >
                      <p className="text-xs font-medium">
                        人工复核意见（独立记录，不改变系统判定）
                      </p>
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
                  ) : null}
                </li>
              );
            })}
          </ol>
          {visibleResults.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">当前筛选没有匹配的检查项。</p>
          ) : null}
          {executions.length > 1 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              已保留 {executions.length} 次检查快照。
            </p>
          ) : null}
          {remediationTasks.length ? (
            <section
              aria-labelledby="remediation-heading"
              className="mt-8 border-t border-border pt-5"
            >
              <h3 id="remediation-heading" className="text-sm font-semibold">
                整改待办 · {remediationTasks.length}
              </h3>
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
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{todo.reason}</p>
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
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
