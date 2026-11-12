import { NextResponse } from "next/server";
import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string; executionId: string }> },
): Promise<Response> {
  const { taskId, executionId } = await context.params;
  const query = new URL(request.url).searchParams;
  const sourceId = query.get("sourceId");
  const version = Number(query.get("version"));
  const offset = Number(query.get("offset") ?? "0");
  if (
    ![taskId, executionId, sourceId].every((id) => reviewTaskIdSchema.safeParse(id).success) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return NextResponse.json({ error: "来源定位参数无效。" }, { status: 400 });
  const source = getReviewStore().getExecutionSource(
    taskId,
    executionId,
    sourceId!,
    version,
    offset,
  );
  if (!source)
    return NextResponse.json(
      { error: "本次执行的原文快照不可用；请查看保存的引用。" },
      { status: 404 },
    );
  return NextResponse.json({ source }, { headers: { "Cache-Control": "no-store" } });
}
