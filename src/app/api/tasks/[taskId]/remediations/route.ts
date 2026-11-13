import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ executionId: reviewTaskIdSchema, ruleId: reviewTaskIdSchema });
const updateSchema = z
  .object({
    id: reviewTaskIdSchema,
    status: z.enum(["open", "in_progress", "done"]).optional(),
    assignee: z.string().trim().max(80).optional(),
    note: z.string().trim().max(500).default(""),
  })
  .refine((value) => value.status !== undefined || value.assignee !== undefined);

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  return NextResponse.json(
    { remediationTasks: store.listRemediationTasks(taskId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "待办来源无效。" }, { status: 400 });
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  const todo = store.createRemediationTask(
    taskId,
    parsed.data.executionId,
    parsed.data.ruleId,
    new Date().toISOString(),
  );
  if (!todo)
    return NextResponse.json(
      { error: "只有已完成检查中的必须项失败可以创建整改待办。" },
      { status: 409 },
    );
  return NextResponse.json({ remediationTask: todo }, { status: 201 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "待办状态无效。" }, { status: 400 });
  if (parsed.data.assignee !== undefined) {
    const todo = getReviewStore().assignRemediation(
      taskId,
      parsed.data.id,
      parsed.data.assignee,
      parsed.data.note,
    );
    if (!todo) return NextResponse.json({ error: "没有找到该整改待办。" }, { status: 404 });
    if (parsed.data.status === undefined) return NextResponse.json({ remediationTask: todo });
  }
  const todo = getReviewStore().updateRemediationStatus(
    taskId,
    parsed.data.id,
    parsed.data.status!,
    new Date().toISOString(),
  );
  if (!todo) return NextResponse.json({ error: "没有找到该整改待办。" }, { status: 404 });
  return NextResponse.json({ remediationTask: todo });
}
