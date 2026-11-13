import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import {
  backgroundSuggestions,
  sensitiveMaterialWarnings,
  similarMaterials,
} from "@/lib/material-insights";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const task = getReviewStore().getTask(taskId);
  if (!task) return NextResponse.json({ error: "没有找到任务。" }, { status: 404 });
  return NextResponse.json(
    {
      background: backgroundSuggestions(task.materials),
      sensitive: sensitiveMaterialWarnings(task.materials),
      similar: similarMaterials(task.materials),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
