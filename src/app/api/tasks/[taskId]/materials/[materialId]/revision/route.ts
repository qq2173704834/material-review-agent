import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import { readStoredMaterial } from "@/lib/server/material-file";
import { parsePdfMaterial } from "@/lib/server/pdf-parser";
import type { MaterialContentSegment } from "@/domain/review";

export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("classification"),
    version: z.number().int().positive(),
    label: z.string().trim().min(1).max(80),
    note: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("correction"),
    version: z.number().int().positive(),
    segmentIndex: z.number().int().nonnegative(),
    text: z.string().min(1).max(40_000),
    note: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("restore"), version: z.number().int().positive() }),
  z.object({
    action: z.literal("select_version"),
    version: z.number().int().positive(),
    selectedVersion: z.number().int().positive(),
    note: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("retry"),
    version: z.number().int().positive(),
    pageNumber: z.number().int().min(1).max(200),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string; materialId: string }> },
): Promise<Response> {
  const { taskId, materialId } = await context.params;
  if (
    !z.string().uuid().safeParse(taskId).success ||
    !z.string().uuid().safeParse(materialId).success
  )
    return NextResponse.json({ error: "任务或材料编号无效。" }, { status: 400 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "修订内容无效；请填写文字与修改依据。" }, { status: 400 });
  const store = getReviewStore();
  const material = store.listMaterials(taskId).find((item) => item.id === materialId);
  if (!material) return NextResponse.json({ error: "没有找到该材料。" }, { status: 404 });
  if (material.version !== input.data.version)
    return NextResponse.json({ error: "材料版本已更新，请刷新后重新核对。" }, { status: 409 });
  let file = store.getMaterialFile(taskId, materialId, material.version);
  if (!file) return NextResponse.json({ error: "原件记录不可用。" }, { status: 404 });
  let revised = { ...material, segments: material.segments.map((segment) => ({ ...segment })) };
  let note = "恢复本原件首次解析的文字与覆盖状态";
  if (input.data.action === "correction") {
    const segmentIndex = input.data.segmentIndex;
    const segment = revised.segments.find((item) => item.segmentIndex === segmentIndex);
    if (!segment)
      return NextResponse.json(
        { error: "片段不存在，请先重试失败页或重新上传。" },
        { status: 400 },
      );
    if (segment.text === input.data.text)
      return NextResponse.json({ error: "文字没有变化。" }, { status: 400 });
    segment.text = input.data.text;
    segment.location = segment.location.replace(/ · 人工修订$/, "") + " · 人工修订";
    note = input.data.note;
    revised.parserName = material.parserName.replace(/\+manual$/, "") + "+manual";
    revised.parseMessage = "人工修订解析文字；原件未改动，原有未读取范围仍需核对。依据：" + note;
  } else if (input.data.action === "classification") {
    note = input.data.note;
    revised.classification = {
      label: input.data.label,
      method: "manual",
      quote: note,
      location: "人工分类依据",
    };
    revised.parseMessage =
      `人工分类为“${input.data.label}”；分类不代替内容审查。` + material.parseMessage;
  } else if (input.data.action === "select_version") {
    const selectedVersion = input.data.selectedVersion;
    const original = store
      .listMaterials(taskId, true)
      .find((item) => item.id === materialId && item.version === selectedVersion);
    const selectedFile = store.getMaterialFile(taskId, materialId, selectedVersion);
    if (!original || !selectedFile)
      return NextResponse.json({ error: "所选版本不属于此材料。" }, { status: 404 });
    if (original.version === material.version)
      return NextResponse.json({ error: "已是当前有效版本。" }, { status: 409 });
    revised = { ...original, segments: original.segments.map((segment) => ({ ...segment })) };
    file = selectedFile;
    note = `采用历史v${original.version}作为本次有效内容：${input.data.note}`;
    revised.parseMessage = note + "。" + original.parseMessage;
  } else if (input.data.action === "restore") {
    const original = store
      .listMaterials(taskId, true)
      .filter((item) => item.id === materialId && item.sha256 === material.sha256 && !item.revision)
      .sort((a, b) => a.version - b.version)[0];
    if (!original)
      return NextResponse.json({ error: "没有可恢复的原始解析版本。" }, { status: 409 });
    revised = { ...original, segments: original.segments.map((segment) => ({ ...segment })) };
    revised.parseMessage = `已恢复原始解析 v${original.version}。` + original.parseMessage;
  } else {
    if (
      material.extension !== "pdf" ||
      !material.pageCount ||
      input.data.pageNumber > material.pageCount
    )
      return NextResponse.json(
        { error: "仅支持重试 PDF 内实际存在的前 200 页。" },
        { status: 400 },
      );
    try {
      const pageNumber = input.data.pageNumber;
      const parsed = await parsePdfMaterial(
        await readStoredMaterial(taskId, file.storageKey),
        pageNumber,
      );
      if (!parsed.segments.length)
        return NextResponse.json(
          { error: "本页仍未识别到文字，已保留原有成功页。请更换清晰原件。" },
          { status: 422 },
        );
      const getPage = (segment: MaterialContentSegment): number =>
        Number(segment.location.match(/^第 (\d+) 页/)?.[1]);
      revised.segments = [
        ...revised.segments.filter((segment) => getPage(segment) !== pageNumber),
        ...parsed.segments,
      ].sort((a, b) => getPage(a) - getPage(b));
      revised.pageCoverage = [
        ...(material.pageCoverage ?? []).filter((page) => page.pageNumber !== pageNumber),
        ...(parsed.pageCoverage ?? []),
      ].sort((a, b) => a.pageNumber - b.pageNumber);
      revised.parseStatus =
        revised.pageCoverage.length === material.pageCount &&
        revised.pageCoverage.every((page) => page.status === "read")
          ? "text_extracted"
          : "partial";
      note = `仅重新识别第 ${pageNumber} 页；其他页面保留上一版本。`;
      revised.parseMessage =
        note +
        (revised.parseStatus === "partial"
          ? "仍有未完整读取页面，请查看逐页范围。"
          : "请核对 OCR 文字。");
    } catch {
      return NextResponse.json({ error: "单页重试失败，已有解析未改变。" }, { status: 422 });
    }
  }
  if (
    store.listMaterials(taskId).find((item) => item.id === materialId)?.version !== material.version
  )
    return NextResponse.json({ error: "处理期间材料已更新，请刷新后重试。" }, { status: 409 });
  let text = "";
  revised.segments = revised.segments.map((segment, segmentIndex) => {
    if (text) text += "\n";
    const startOffset = text.length;
    text += segment.text;
    return { ...segment, segmentIndex, startOffset, endOffset: text.length };
  });
  if (text.length > 1_000_000)
    return NextResponse.json({ error: "修订后文本超过处理上限。" }, { status: 413 });
  const saved = store.saveMaterialVersion({
    ...revised,
    taskId,
    storageKey: file.storageKey,
    version: material.version + 1,
    extractedText: text,
    createdAt: new Date().toISOString(),
    revision: {
      kind: input.data.action,
      baseVersion: material.version,
      note,
      ...(input.data.action === "retry" ? { pageNumber: input.data.pageNumber } : {}),
    },
  });
  return NextResponse.json(
    { material: saved },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
