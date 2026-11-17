import type { ReviewExecution } from "@/domain/review";

/** The same conclusion is used by the result screen and downloadable reports. */
export function reviewSummary(execution: ReviewExecution): {
  title: string;
  description: string;
  failed: number;
  pending: number;
  passed: number;
} {
  const checks = [...execution.results, ...(execution.metadata?.materialConsistency ?? [])];
  const failed = checks.filter(
    (item) => item.verdict === "failed" && (!("strength" in item) || item.strength === "required"),
  ).length;
  const pending =
    checks.filter(
      (item) =>
        ["needs_confirmation", "unable_to_check"].includes(item.verdict) ||
        (item.verdict === "failed" && "strength" in item && item.strength === "unknown"),
    ).length + execution.unexecutedCount;
  const passed = checks.filter((item) => item.verdict === "passed").length;
  const title =
    execution.validity === "needs_recheck"
      ? "材料或要求已更新，需要重新检查"
      : execution.status === "running"
        ? "正在检查材料"
        : execution.status !== "completed"
          ? "检查尚未完成"
          : failed
            ? "有材料需要修改"
            : pending
              ? "还有内容需要确认"
              : execution.metadata?.mode !== "live"
                ? "模拟检查已完成"
                : !checks.length
                  ? "尚无可用检查结论"
                  : "本次自查未发现必须项问题";
  const description =
    execution.validity === "needs_recheck"
      ? "下方保留上次结果，请重新检查当前材料。"
      : execution.status !== "completed"
        ? "查看已完成项目，继续检查其余内容。"
        : failed
          ? "按问题建议修改材料，然后重新检查。"
          : pending
            ? "请补充信息或核对未能检查的内容。"
            : execution.metadata?.mode !== "live"
              ? "文件规格检查已完成，可查看每项结论与依据。"
              : "本次检查已完成，可查看每项结论与依据。";
  return { title, description, failed, pending, passed };
}
