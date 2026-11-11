import { NextResponse } from "next/server";

import { reviewTaskIdSchema, reviewTaskInputSchema } from "@/domain/review-task";
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

  try {
    const task = getReviewStore().getTask(taskId);
    return task
      ? NextResponse.json({ task }, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "无法读取该审查任务。" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const parsedInput = reviewTaskInputSchema.safeParse(body);
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: parsedInput.error.issues[0]?.message ?? "任务信息不符合要求。" },
      { status: 400 },
    );
  }

  try {
    const task = getReviewStore().updateTask({ taskId, ...parsedInput.data });
    return task
      ? NextResponse.json({ task }, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "任务未能保存到本地，请稍后重试。" }, { status: 500 });
  }
}
