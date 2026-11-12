import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { executeDeterministicChecks } from "@/lib/review-checks";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  return NextResponse.json(
    { executions: store.listReviewExecutions(taskId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  try {
    const store = getReviewStore();
    const task = store.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    const ruleSet = store
      .listRuleSets(taskId)
      .find((candidate) => candidate.sourceVersion === task.noticeSource.version);
    if (!ruleSet) {
      return NextResponse.json({ error: "请先根据当前通知生成规则草稿。" }, { status: 409 });
    }
    const createdAt = new Date().toISOString();
    const execution = executeDeterministicChecks(
      ruleSet,
      task.materials,
      task.background,
      createdAt,
      randomUUID(),
    );
    store.saveReviewExecution(execution);
    return NextResponse.json(
      { execution },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "检查未能保存，请稍后重试。" }, { status: 500 });
  }
}
