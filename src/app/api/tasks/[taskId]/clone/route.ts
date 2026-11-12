import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }

  try {
    const store = getReviewStore();
    const sourceTask = store.getTask(taskId);
    if (!sourceTask) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    const clone = store.createTask({
      name: `${sourceTask.name}（副本）`.slice(0, 120),
      description: sourceTask.description,
      background: sourceTask.background,
      noticeText: sourceTask.noticeSource.originalText,
    });
    return NextResponse.json(
      { task: clone },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "任务复制失败，请稍后重试。" }, { status: 500 });
  }
}
