import { NextResponse } from "next/server";
import { z } from "zod";
import { MAXIMUM_NOTICE_CHARACTERS } from "@/domain/review-task";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string; sourceId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { taskId, sourceId } = await context.params;
  if (![taskId, sourceId].every((id) => reviewTaskIdSchema.safeParse(id).success))
    return NextResponse.json({ error: "任务或来源编号无效。" }, { status: 400 });
  const input = z
    .object({
      version: z.number().int().positive(),
      text: z.string().trim().min(1).max(MAXIMUM_NOTICE_CHARACTERS),
      note: z.string().trim().min(1).max(500),
      confirmedComplete: z.boolean(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "请填写来源正文、修订依据和完整性确认。" }, { status: 400 });
  const store = getReviewStore();
  const source = store.getTask(taskId)?.supplementalSources.find((item) => item.id === sourceId);
  if (!source) return NextResponse.json({ error: "没有找到该补充来源。" }, { status: 404 });
  if (source.version !== input.data.version)
    return NextResponse.json({ error: "来源已更新，请刷新后重试。" }, { status: 409 });
  if (store.listReviewExecutions(taskId).some((execution) => execution.status === "running"))
    return NextResponse.json({ error: "请先完成或取消正在执行的检查。" }, { status: 409 });
  const saved = store.reviseSupplementSource(
    taskId,
    sourceId,
    input.data.version,
    input.data.text,
    input.data.note,
    input.data.confirmedComplete,
  );
  return NextResponse.json(
    { source: saved },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
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
