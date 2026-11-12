"use client";

import { useRef, useState } from "react";

import type { ReviewExecution, ReviewVerdict } from "@/domain/review";
import type { ReactElement } from "react";

interface ReviewExecutionProps {
  taskId: string;
  initialExecutions: ReviewExecution[];
  hasCurrentRuleSet: boolean;
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

export function ReviewExecutionPanel({
  taskId,
  initialExecutions,
  hasCurrentRuleSet,
}: ReviewExecutionProps): ReactElement {
  const [executions, setExecutions] = useState(initialExecutions);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const currentExecution = executions[0];
  const counts = new Map<ReviewVerdict, number>();
  currentExecution?.results.forEach((result) => {
    counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
  });

  function upsertExecution(execution: ReviewExecution): void {
    setExecutions((current) => {
      const existingIndex = current.findIndex((item) => item.id === execution.id);
      if (existingIndex < 0) return [execution, ...current];
      return current.map((item, index) => (index === existingIndex ? execution : item));
    });
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
      if (controller.signal.aborted) await refreshExecutions().catch(() => []);
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
            确定性检查
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            本地规格工具；语义内容、命名模式及未解析的规则不会自动判为通过。
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
            {isRunning ? "正在检查…" : "运行检查"}
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
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>{currentExecution.results.length} 项规则</span>
            {currentExecution.status === "running" && progress ? (
              <span aria-live="polite">
                已完成 {progress.completed} / {progress.total} 项
              </span>
            ) : null}
            {currentExecution.status === "cancelled" ? (
              <span>已取消，{currentExecution.unexecutedCount} 项未执行</span>
            ) : null}
            {verdictOrder.map((verdict) =>
              (counts.get(verdict) ?? 0) > 0 ? (
                <span key={verdict} className={verdictStyles[verdict]}>
                  {verdictLabels[verdict]} {counts.get(verdict)}
                </span>
              ) : null,
            )}
            <span>通知 v{currentExecution.sourceVersion}</span>
            <time dateTime={currentExecution.completedAt}>
              {new Date(currentExecution.completedAt).toLocaleString("zh-CN")}
            </time>
          </div>
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {currentExecution.results.map((result) => (
              <li key={result.ruleId} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {result.ruleCode} · {result.requirement}
                  </h3>
                  <span className={`text-xs font-semibold ${verdictStyles[result.verdict]}`}>
                    {verdictLabels[result.verdict]}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.reason}</p>
                {result.recommendation ? (
                  <p className="mt-2 text-xs leading-5 text-primary">
                    建议：{result.recommendation}
                  </p>
                ) : null}
                <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
                  来源：{result.source.quotedText}
                </blockquote>
                {result.evidence.length ? (
                  <ul className="mt-3 space-y-2 text-xs leading-5">
                    {result.evidence.map((evidence, index) => (
                      <li
                        key={`${evidence.materialId}-${index}`}
                        className="break-words text-muted-foreground"
                      >
                        证据：{evidence.quotedText} · {evidence.location} · 材料 v
                        {evidence.materialVersion}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          {executions.length > 1 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              已保留 {executions.length} 次检查快照。
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
