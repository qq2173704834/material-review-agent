"use client";
import { useState } from "react";
import { EvidencePane } from "./evidence-preview";
import { SourceEvidencePreview } from "./source-evidence-preview";
import { ResultQuestion } from "./result-question";
import type { ReviewCheckResult } from "@/domain/review";
import type { ReactElement } from "react";

const verdicts = {
  passed: "通过",
  failed: "未通过",
  needs_confirmation: "待确认",
  unable_to_check: "无法检查",
  not_applicable: "不适用",
};
export function ReviewWorkbench({
  taskId,
  executionId,
  sourceVersion,
  results,
  selectedRuleId,
  onSelect,
}: {
  taskId: string;
  executionId: string;
  sourceVersion: number;
  results: ReviewCheckResult[];
  selectedRuleId: string;
  onSelect: (ruleId: string) => void;
}): ReactElement {
  const [tab, setTab] = useState("evidence");
  const selected =
    results.find((result) => result.ruleId === selectedRuleId) ??
    results.find((result) => result.strength === "required" && result.verdict === "failed") ??
    results.find((result) => ["needs_confirmation", "unable_to_check"].includes(result.verdict)) ??
    results[0];
  const tabs = [
    { id: "rules", label: "规则导航" },
    { id: "evidence", label: "原文证据" },
    { id: "result", label: "结论与处理" },
  ];
  if (!selected) return <p className="py-3 text-sm">当前筛选没有可展示的检查项，请清除筛选。</p>;
  return (
    <section
      aria-label="联动审查工作台"
      className="my-4 rounded-lg border border-border bg-card p-3"
    >
      <div role="tablist" aria-label="工作台视图" className="mb-3 flex gap-2 lg:hidden">
        {tabs.map((item) => (
          <button
            role="tab"
            aria-selected={tab === item.id}
            key={item.id}
            onClick={() => setTab(item.id)}
            className="min-h-11 rounded border px-3 text-xs"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(160px,0.7fr)_minmax(0,1.6fr)_minmax(220px,1fr)]">
        <nav
          aria-label="工作台规则导航"
          className={`${tab === "rules" ? "block" : "hidden"} min-w-0 lg:block`}
        >
          <p className="mb-2 text-xs font-semibold">当前执行 · {executionId.slice(0, 8)}</p>
          <ul className="max-h-[70vh] space-y-2 overflow-auto">
            {results.map((result) => (
              <li key={result.ruleId}>
                <button
                  aria-pressed={selected.ruleId === result.ruleId}
                  onClick={() => {
                    onSelect(result.ruleId);
                    setTab("evidence");
                  }}
                  className={`min-h-11 w-full break-words rounded border p-2 text-left text-xs ${selected.ruleId === result.ruleId ? "border-primary bg-muted" : "border-border"}`}
                >
                  选择 {result.ruleCode} · {verdicts[result.verdict]}
                  <span className="mt-1 block">{result.requirement}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div
          aria-label="工作台原文证据"
          className={`${tab === "evidence" ? "block" : "hidden"} min-w-0 space-y-3 lg:block`}
        >
          <p className="text-xs font-semibold">{selected.ruleCode} 的来源与材料快照</p>
          <blockquote className="break-words border-l-2 border-primary pl-3 text-xs leading-6">
            {selected.source.quotedText}
            <SourceEvidencePreview
              taskId={taskId}
              executionId={executionId}
              source={selected.source}
              sourceVersion={sourceVersion}
            />
          </blockquote>
          {selected.evidence.length ? (
            selected.evidence
              .slice(0, 2)
              .map((evidence, index) => (
                <EvidencePane
                  key={`${selected.ruleId}-${evidence.materialId}-${evidence.materialVersion}-${index}`}
                  taskId={taskId}
                  evidence={evidence}
                />
              ))
          ) : (
            <p className="text-xs text-muted-foreground">
              此项没有可定位的材料证据；请根据右侧说明补充或确认。
            </p>
          )}
          {selected.evidence.length > 2 && (
            <p className="text-xs">
              工作台先展示前两处证据，完整证据可在下方该检查项的对照预览中查看。
            </p>
          )}
        </div>
        <aside
          aria-label="工作台结论与处理"
          className={`${tab === "result" ? "block" : "hidden"} min-w-0 lg:block`}
        >
          <p className="text-sm font-semibold">
            {selected.ruleCode} · {verdicts[selected.verdict]}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
            {selected.reason}
          </p>
          <p className="mt-2 break-words text-xs leading-6">{selected.recommendation}</p>
          <p className="mt-2 text-xs">
            {selected.method === "model"
              ? "模型辅助"
              : selected.method === "deterministic"
                ? "程序核验"
                : "未完成核验"}
            {selected.coverage
              ? ` · 片段 ${selected.coverage.examinedSegments}/${selected.coverage.totalSegments} · ${selected.coverage.isComplete ? "完整纳入上下文" : "存在未核验范围"}`
              : ""}
          </p>
          <ResultQuestion taskId={taskId} executionId={executionId} ruleId={selected.ruleId} />
          <div className="mt-4 flex flex-col gap-2 text-xs">
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href="#task-info-heading"
            >
              补充条件背景
            </a>
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href="#stage-prepare"
            >
              纠正规则 / 调整材料匹配
            </a>
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href="#materials-heading"
            >
              替换或修订材料
            </a>
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href={`#execution-${executionId}-result-${selected.ruleId}`}
            >
              查看完整结果 / 人工意见 / 整改待办
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}
