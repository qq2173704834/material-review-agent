import type { ReviewExecution, ReviewTaskDetails } from "@/domain/review";

export type TaskView = "prepare" | "review" | "results";
export type TaskTool = "sources" | "materials" | "requirements" | "clarification" | "history";

export function needsAttention(result: ReviewExecution["results"][number]): boolean {
  return (
    (result.verdict === "failed" && result.strength === "required") ||
    result.verdict === "needs_confirmation" ||
    result.verdict === "unable_to_check"
  );
}

export function nextTaskAction(
  task: Pick<ReviewTaskDetails, "noticeSource" | "supplementalSources" | "materials">,
  execution?: ReviewExecution,
): { label: string; view: TaskView; kind: "prepare" | "start" | "results" } {
  if (execution?.status === "running")
    return { label: "查看审查进度", view: "review", kind: "results" };
  if (
    ![task.noticeSource, ...task.supplementalSources].some((source) => source.originalText.trim())
  )
    return { label: "添加审查要求", view: "prepare", kind: "prepare" };
  if (execution?.validity === "needs_recheck")
    return { label: "复查受影响项", view: "review", kind: "start" };
  if (execution && ["failed", "cancelled"].includes(execution.status))
    return { label: "重试审查", view: "review", kind: "start" };
  if (!execution)
    return {
      label: task.materials.length ? "开始审查" : "检查缺交项",
      view: "prepare",
      kind: "start",
    };
  return {
    label:
      execution.results.some(needsAttention) || execution.unexecutedCount
        ? "查看待处理问题"
        : "查看报告",
    view: "results",
    kind: "results",
  };
}
