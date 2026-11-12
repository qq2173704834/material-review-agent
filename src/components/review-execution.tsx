"use client";

import { useState } from "react";

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
  const currentExecution = executions[0];
  const counts = new Map<ReviewVerdict, number>();
  currentExecution?.results.forEach((result) => {
    counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
  });

  async function runChecks(): Promise<void> {
    setError("");
    setIsRunning(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/checks`, { method: "POST" });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("execution" in payload)
      ) {
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
      setExecutions((current) => [payload.execution as ReviewExecution, ...current]);
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsRunning(false);
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
        <button
          type="button"
          onClick={runChecks}
          disabled={!hasCurrentRuleSet || isRunning}
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {isRunning ? "正在检查…" : "运行检查"}
        </button>
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
