import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { parseMaterial } from "@/lib/server/material-parser";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

const MAXIMUM_SOURCE_BYTES = 20 * 1024 * 1024;
const MAXIMUM_SOURCE_COUNT = 10;

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const store = getReviewStore();
  const task = store.getTask(taskId);
  if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  if (task.supplementalSources.length >= MAXIMUM_SOURCE_COUNT)
    return NextResponse.json(
      { error: `每个任务最多添加 ${MAXIMUM_SOURCE_COUNT} 个补充来源。` },
      { status: 413 },
    );

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "无法读取补充来源文件。" }, { status: 400 });
  }
  const sourceFile = formData.get("sourceFile");
  if (!(sourceFile instanceof File) || sourceFile.size <= 0)
    return NextResponse.json({ error: "请选择一个非空 PDF、DOCX 或 TXT 文件。" }, { status: 400 });
  if (sourceFile.size > MAXIMUM_SOURCE_BYTES)
    return NextResponse.json({ error: "补充来源文件不能超过 20 MiB。" }, { status: 413 });
  const lowerFileName = sourceFile.name.toLowerCase();
  if (!(
    lowerFileName.endsWith(".pdf") ||
    lowerFileName.endsWith(".docx") ||
    lowerFileName.endsWith(".txt")
  ))
    return NextResponse.json({ error: "补充来源仅支持 PDF、DOCX 和 TXT。" }, { status: 415 });
  try {
    const parsed = await parseMaterial(
      Buffer.from(await sourceFile.arrayBuffer()),
      sourceFile.name,
    );
    if (!parsed.extractedText.trim())
      return NextResponse.json(
        { error: parsed.parseMessage || "文件未提取到可用文字，未添加来源。" },
        { status: 422 },
      );
    const source = store.createSupplementSource({
      taskId,
      displayName: sourceFile.name,
      text: parsed.extractedText,
      parseStatus: parsed.parseStatus,
      segments: parsed.segments.map((segment) => ({
        paragraphIndex: segment.segmentIndex,
        text: segment.text,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        location: segment.location,
      })),
    });
    if (!source) return NextResponse.json({ error: "任务已不存在。" }, { status: 404 });
    return NextResponse.json({ source }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "补充来源解析失败。" },
      { status: 422 },
    );
  }
}
