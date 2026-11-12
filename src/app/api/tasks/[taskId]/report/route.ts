import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { annotateExecutions } from "@/lib/review-history";
import { createRemediationReport, createReviewReport } from "@/lib/review-report";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const executionId = new URL(request.url).searchParams.get("executionId");
  const reportType = new URL(request.url).searchParams.get("type");
  if (reportType && reportType !== "remediation")
    return NextResponse.json({ error: "报告类型无效。" }, { status: 400 });
  if (executionId && !reviewTaskIdSchema.safeParse(executionId).success)
    return NextResponse.json({ error: "执行编号无效。" }, { status: 400 });
  const store = getReviewStore();
  const task = store.getTask(taskId);
  if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  const ruleSets = store.listRuleSets(taskId);
  const executions = annotateExecutions(task, ruleSets, store.listReviewExecutions(taskId));
  const index = executionId ? executions.findIndex((execution) => execution.id === executionId) : 0;
  const execution = executions[index];
  if (!execution) return NextResponse.json({ error: "尚无可导出的检查记录。" }, { status: 404 });
  if (execution.status === "running")
    return NextResponse.json({ error: "请等待检查结束或取消后再导出报告。" }, { status: 409 });
  const ruleSet = ruleSets.find((candidate) => candidate.id === execution.ruleSetId);
  if (!ruleSet) return NextResponse.json({ error: "没有找到对应的规则快照。" }, { status: 409 });
  const body =
    reportType === "remediation"
      ? createRemediationReport(task, execution)
      : createReviewReport(task, execution, ruleSet, executions[index + 1]);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${reportType === "remediation" ? "remediation" : "review"}-${taskId}.md"`,
    },
  });
}
