import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolutionSchema = z.object({
  executionId: reviewTaskIdSchema,
  ruleId: reviewTaskIdSchema,
  decision: z.enum(["confirmed", "rejected", "deferred"]),
  note: z.string().trim().max(2_000).default(""),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }
  const parsed = resolutionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "人工意见字段无效。" }, { status: 400 });
  if (parsed.data.decision !== "deferred" && !parsed.data.note)
    return NextResponse.json({ error: "确认或不同意时请填写复核依据。" }, { status: 400 });
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  const resolution = store.saveHumanResolution({
    taskId,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  });
  if (!resolution)
    return NextResponse.json(
      { error: "检查记录不存在、仍在执行，或找不到对应的检查项。" },
      { status: 409 },
    );
  return NextResponse.json({ resolution }, { headers: { "Cache-Control": "no-store" } });
}
