import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import { fetchPublicWebpage, fetchPublicResource } from "@/lib/server/webpage-fetcher";
import { parseMaterial } from "@/lib/server/material-parser";
import { MAXIMUM_NOTICE_CHARACTERS } from "@/domain/review-task";

export const runtime = "nodejs";
type Context = { params: Promise<{ taskId: string; sourceId: string }> };

async function handle(
  request: Request,
  context: Context,
  shouldImport: boolean,
): Promise<Response> {
  const { taskId, sourceId } = await context.params;
  if (![taskId, sourceId].every((id) => z.string().uuid().safeParse(id).success))
    return NextResponse.json({ error: "任务或来源编号无效。" }, { status: 400 });
  const store = getReviewStore();
  const task = store.getTask(taskId);
  const source =
    task && [task.noticeSource, ...task.supplementalSources].find((item) => item.id === sourceId);
  if (!source) return NextResponse.json({ error: "没有找到该来源。" }, { status: 404 });
  if (source.inputType !== "webpage" || !source.sourceUrl)
    return NextResponse.json(
      { error: "该来源不是公开网页；可直接上传附件文件。" },
      { status: 400 },
    );
  try {
    const webpage = await fetchPublicWebpage(source.sourceUrl);
    if (!shouldImport)
      return NextResponse.json(
        { attachments: webpage.attachments, fetchedAt: webpage.fetchedAt },
        { headers: { "Cache-Control": "no-store" } },
      );
    const input = z
      .object({ url: z.string().url().max(2048) })
      .safeParse(await request.json().catch(() => null));
    const attachment = input.success
      ? webpage.attachments.find((item) => item.url === input.data.url)
      : undefined;
    if (!attachment)
      return NextResponse.json({ error: "该 URL 不是此来源网页的直接关联附件。" }, { status: 422 });
    const existing = task.supplementalSources.find((item) => item.sourceUrl === attachment.url);
    if (existing) return NextResponse.json({ source: existing, reused: true });
    if (task.supplementalSources.length >= 10)
      return NextResponse.json({ error: "补充来源已达到 10 个上限。" }, { status: 413 });
    const resource = await fetchPublicResource(attachment.url);
    const fileName = decodeURIComponent(
      new URL(attachment.url).pathname.split("/").pop() ?? "附件",
    );
    const parsed = await parseMaterial(Buffer.from(resource.bytes), fileName);
    if (!parsed.extractedText.trim() || parsed.extractedText.length > MAXIMUM_NOTICE_CHARACTERS)
      return NextResponse.json(
        { error: "附件未提取到可用文本或文本超限，请下载核对并拆分上传。" },
        { status: 422 },
      );
    const current = store.getTask(taskId);
    if (!current) return NextResponse.json({ error: "任务已删除。" }, { status: 404 });
    const duplicate = current.supplementalSources.find((item) => item.sourceUrl === attachment.url);
    if (duplicate) return NextResponse.json({ source: duplicate, reused: true });
    if (current.supplementalSources.length >= 10)
      return NextResponse.json({ error: "补充来源已达到上限。" }, { status: 409 });
    const saved = store.createSupplementSource({
      taskId,
      sourceType: "file",
      displayName: `${attachment.name}（关联来源：${source.displayName.slice(0, 150)}）`.slice(
        0,
        500,
      ),
      sourceUrl: attachment.url,
      sourceFetchedAt: new Date().toISOString(),
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
    return NextResponse.json({ source: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "附件获取失败，请改为上传文件。" },
      { status: 422 },
    );
  }
}
export async function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context, false);
}
export async function POST(request: Request, context: Context): Promise<Response> {
  return handle(request, context, true);
}
