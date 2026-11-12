import { NextResponse } from "next/server";

import { MAXIMUM_NOTICE_CHARACTERS, reviewTaskIdSchema } from "@/domain/review-task";
import { parseMaterial } from "@/lib/server/material-parser";
import { fetchPublicWebpage } from "@/lib/server/webpage-fetcher";
import { getReviewStore } from "@/lib/server/review-store";
import { MultipartSizeLimitError, readLimitedFormData } from "@/lib/server/limited-form-data";

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

  if (request.headers.get("content-type")?.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "网页来源内容不是有效的 JSON。" }, { status: 400 });
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("sourceUrl" in body) ||
      typeof body.sourceUrl !== "string" ||
      body.sourceUrl.trim().length === 0 ||
      body.sourceUrl.length > 2048
    )
      return NextResponse.json({ error: "请填写有效的公开网页 URL。" }, { status: 400 });
    try {
      const webpage = await fetchPublicWebpage(body.sourceUrl);
      if (webpage.text.length > MAXIMUM_NOTICE_CHARACTERS)
        return NextResponse.json(
          {
            error: `提取正文超过 ${MAXIMUM_NOTICE_CHARACTERS.toLocaleString()} 字符上限，请拆分来源。`,
          },
          { status: 422 },
        );
      const segments = [...webpage.text.matchAll(/[^\r\n]+/g)].map((match, paragraphIndex) => ({
        paragraphIndex,
        text: match[0],
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        location: `网页段落 ${paragraphIndex + 1}`,
      }));
      const source = store.createSupplementSource({
        taskId,
        sourceType: "webpage",
        displayName: `${webpage.title || "公开网页"} · ${webpage.url}`,
        sourceUrl: webpage.url,
        sourceFetchedAt: webpage.fetchedAt,
        text: webpage.text,
        parseStatus: "text_extracted",
        segments,
      });
      if (!source) return NextResponse.json({ error: "任务已不存在。" }, { status: 404 });
      return NextResponse.json(
        { source },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法读取该公开网页。请改为粘贴原文。" },
        { status: 422 },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await readLimitedFormData(request, MAXIMUM_SOURCE_BYTES);
  } catch (error) {
    if (error instanceof MultipartSizeLimitError)
      return NextResponse.json({ error: error.message }, { status: 413 });
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
    if (parsed.extractedText.length > MAXIMUM_NOTICE_CHARACTERS)
      return NextResponse.json(
        {
          error: `提取正文超过 ${MAXIMUM_NOTICE_CHARACTERS.toLocaleString()} 字符上限，请拆分来源。`,
        },
        { status: 422 },
      );
    if (!parsed.extractedText.trim())
      return NextResponse.json(
        { error: parsed.parseMessage || "文件未提取到可用文字，未添加来源。" },
        { status: 422 },
      );
    const source = store.createSupplementSource({
      taskId,
      displayName: sourceFile.name,
      sourceType: "file",
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
