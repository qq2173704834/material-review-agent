import { requestIdentity } from "@/lib/server/access-config";
import { NextResponse } from "next/server";
import { z } from "zod";

import { MAXIMUM_NOTICE_CHARACTERS, reviewTaskInputSchema } from "@/domain/review-task";
import { parseMaterial } from "@/lib/server/material-parser";
import { MultipartSizeLimitError, readLimitedFormData } from "@/lib/server/limited-form-data";
import { getReviewStore } from "@/lib/server/review-store";
import { fetchPublicWebpage } from "@/lib/server/webpage-fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  try {
    return NextResponse.json(
      {
        tasks: getReviewStore()
          .listTasks()
          .filter((task) =>
            getReviewStore().canAccessTask(task.id, requestIdentity(request) ?? ""),
          ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取本地审查任务。" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await readLimitedFormData(request, 20 * 1024 * 1024);
    } catch (error) {
      if (error instanceof MultipartSizeLimitError)
        return NextResponse.json({ error: error.message }, { status: 413 });
      return NextResponse.json({ error: "无法读取上传的要求文件。" }, { status: 400 });
    }
    const sourceFile = formData.get("sourceFile");
    if (!(sourceFile instanceof File) || sourceFile.size <= 0)
      return NextResponse.json(
        { error: "请选择一个非空 PDF、DOCX 或 TXT 文件。" },
        { status: 400 },
      );
    if (sourceFile.size > 20 * 1024 * 1024)
      return NextResponse.json({ error: "要求文件不能超过 20 MiB。" }, { status: 413 });
    const backgroundValue = formData.get("background");
    let background: unknown;
    try {
      background = JSON.parse(String(backgroundValue ?? ""));
    } catch {
      return NextResponse.json({ error: "项目背景格式无效。" }, { status: 400 });
    }
    const parsedMetadata = reviewTaskInputSchema.omit({ noticeText: true }).safeParse({
      name: formData.get("name") ?? "",
      description: formData.get("description") ?? "",
      background,
    });
    if (!parsedMetadata.success)
      return NextResponse.json(
        { error: parsedMetadata.error.issues[0]?.message ?? "任务信息不符合要求。" },
        { status: 400 },
      );
    const lowerFileName = sourceFile.name.toLowerCase();
    if (!(
      lowerFileName.endsWith(".pdf") ||
      lowerFileName.endsWith(".docx") ||
      lowerFileName.endsWith(".txt")
    ))
      return NextResponse.json({ error: "要求文件仅支持 PDF、DOCX 和 TXT。" }, { status: 415 });
    try {
      const parsed = await parseMaterial(
        Buffer.from(await sourceFile.arrayBuffer()),
        sourceFile.name,
      );
      if (parsed.extractedText.length > MAXIMUM_NOTICE_CHARACTERS)
        return NextResponse.json(
          {
            error: `提取正文超过 ${MAXIMUM_NOTICE_CHARACTERS.toLocaleString()} 字符上限，请拆分要求或粘贴必要片段。`,
          },
          { status: 422 },
        );
      if (!parsed.extractedText.trim())
        return NextResponse.json(
          { error: parsed.parseMessage || "文件未提取到可用文字，请改为粘贴要求原文。" },
          { status: 422 },
        );
      const task = getReviewStore().createTask({
        ownerId: requestIdentity(request),
        ...parsedMetadata.data,
        noticeText: parsed.extractedText,
        sourceType: "file",
        sourceTitle: sourceFile.name,
        sourceParseStatus: parsed.parseStatus,
        sourceSegments: parsed.segments.map((segment) => ({
          paragraphIndex: segment.segmentIndex,
          text: segment.text,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          location: segment.location,
        })),
      });
      return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "要求文件解析失败，请改为粘贴原文。" },
        { status: 422 },
      );
    }
  }

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
        ownerId: requestIdentity(request),
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
    const task = getReviewStore().createTask({
      ...parsedInput.data,
      ownerId: requestIdentity(request),
    });
    return NextResponse.json({ task }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "任务未能保存到本地，请稍后重试。" }, { status: 500 });
  }
}
