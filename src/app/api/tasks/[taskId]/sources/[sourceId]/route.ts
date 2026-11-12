import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string; sourceId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { taskId, sourceId } = await context.params;
  if (
    !reviewTaskIdSchema.safeParse(taskId).success ||
    !reviewTaskIdSchema.safeParse(sourceId).success
  )
    return NextResponse.json({ error: "任务或来源编号无效。" }, { status: 400 });
  if (!getReviewStore().deleteSupplementSource(taskId, sourceId))
    return NextResponse.json({ error: "没有找到该任务下可删除的补充来源。" }, { status: 404 });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
