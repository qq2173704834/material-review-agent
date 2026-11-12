import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewTaskInputSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";
import { fetchPublicWebpage } from "@/lib/server/webpage-fetcher";

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

  if (
    typeof body === "object" &&
    body !== null &&
    "sourceType" in body &&
    body.sourceType === "webpage"
  ) {
    const webpageInputSchema = reviewTaskInputSchema
      .omit({ noticeText: true })
      .extend({ sourceType: z.literal("webpage"), sourceUrl: z.string().trim().min(1).max(2048) })
      .strict();
    const parsedWebpage = webpageInputSchema.safeParse(body);
    if (!parsedWebpage.success)
      return NextResponse.json(
        { error: parsedWebpage.error.issues[0]?.message ?? "网页来源信息不符合要求。" },
        { status: 400 },
      );
    try {
      const webpage = await fetchPublicWebpage(parsedWebpage.data.sourceUrl);
      const task = getReviewStore().createTask({
        ...parsedWebpage.data,
        noticeText: webpage.text,
        sourceType: "webpage",
        sourceUrl: webpage.url,
        sourceFetchedAt: webpage.fetchedAt,
        sourceTitle: webpage.title,
      });
      return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法读取该公开网页。请改为粘贴原文。" },
        { status: 422 },
      );
    }
  }

  const parsedInput = reviewTaskInputSchema.safeParse(body);
  if (!parsedInput.success)
    return NextResponse.json(
      { error: parsedInput.error.issues[0]?.message ?? "任务信息不符合要求。" },
      { status: 400 },
    );

  try {
    const task = getReviewStore().createTask(parsedInput.data);
    return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "任务未能保存到本地，请稍后重试。" }, { status: 500 });
  }
}
