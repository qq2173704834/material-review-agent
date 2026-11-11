import { NextResponse } from "next/server";

import { reviewTaskInputSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    return NextResponse.json(
      { tasks: getReviewStore().listTasks() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取本地审查任务。" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
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
    const task = getReviewStore().createTask(parsedInput.data);
    return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "任务未能保存到本地，请稍后重试。" }, { status: 500 });
  }
}
