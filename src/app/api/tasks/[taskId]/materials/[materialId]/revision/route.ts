import { readSmallJson } from "@/lib/server/request-json";
import { validImageCorners } from "@/lib/perspective";
import { requestIdentity } from "@/lib/server/access-config";
import { processMaterialImage } from "@/lib/server/material-image";
import { parseMaterial } from "@/lib/server/material-parser";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import { readStoredMaterial } from "@/lib/server/material-file";
import { parsePdfMaterial } from "@/lib/server/pdf-parser";
import type { MaterialContentSegment } from "@/domain/review";

export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("region"),
    version: z.number().int().positive(),
    segmentIndex: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(500),
    role: z.enum(["body", "header", "footer", "sidebar", "table"]),
    readingOrder: z.number().int().min(0).max(10_000),
    recognition: z.enum(["printed", "handwritten", "unknown"]),
    cell: z
      .object({
        tableId: z.string().trim().min(1).max(80),
        row: z.number().int().min(1).max(10_000),
        column: z.number().int().min(1).max(100),
        rowSpan: z.number().int().min(1).max(100),
        columnSpan: z.number().int().min(1).max(100),
        continuesFromPage: z.number().int().min(1).max(199).optional(),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("enhance"),
    version: z.number().int().positive(),
    note: z.string().trim().min(1).max(500),
    processing: z
      .object({
        rotateDegrees: z.number().min(-15).max(15),
        normalize: z.boolean(),
        sharpen: z.boolean(),
        corners: z
          .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict())
          .length(4)
          .refine(validImageCorners)
          .optional(),
      })
      .strict(),
  }),
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
  const input = inputSchema.safeParse(await readSmallJson(request, 200_000).catch(() => null));
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
  if (input.data.action === "enhance") {
    if (!["png", "jpg"].includes(material.extension))
      return NextResponse.json(
        { error: "增强候选目前限JPG/PNG；PDF请重传清晰页或单页重试。" },
        { status: 400 },
      );
    try {
      const enhanced = await processMaterialImage(
        await readStoredMaterial(taskId, file.storageKey),
        input.data.processing,
      );
      const parsed = await parseMaterial(enhanced, "enhanced.png");
      revised = { ...revised, ...parsed };
      // The original file and its hash/type remain unchanged; only parsing is versioned.
      revised.extension = material.extension;
      revised.mediaType = material.mediaType;
      note = input.data.note;
      revised.parseMessage =
        "已采用图像增强候选重新OCR；原件保留，所有区域需重新核对。" + parsed.parseMessage;
    } catch {
      return NextResponse.json({ error: "增强或重新识别失败，旧解析保留。" }, { status: 422 });
    }
  } else if (input.data.action === "region") {
    const regionInput = input.data;
    const segment = revised.segments.find((item) => item.segmentIndex === regionInput.segmentIndex);
    if (!segment?.region)
      return NextResponse.json({ error: "该片段没有可核对的图像区域。" }, { status: 400 });
    const cell = input.data.cell;
    if (input.data.role === "table" && !cell)
      return NextResponse.json({ error: "表格区域需填写单元格关系。" }, { status: 400 });
    if (
      cell &&
      (input.data.role !== "table" ||
        cell.column + cell.columnSpan > 101 ||
        (cell.continuesFromPage &&
          (cell.continuesFromPage >= segment.region.pageNumber ||
            !material.segments.some(
              (item) =>
                item.region?.pageNumber === cell.continuesFromPage &&
                item.region?.cell?.tableId === cell.tableId &&
                item.region?.status === "confirmed",
            ))))
    )
      return NextResponse.json(
        { error: "续表须关联本材料更早页已确认的同一表格；请核对行列关系。" },
        { status: 400 },
      );
    if (
      cell &&
      material.segments.some(
        (item) =>
          item.segmentIndex !== segment.segmentIndex &&
          item.region?.status === "confirmed" &&
          item.region?.cell?.tableId === cell.tableId &&
          (() => {
            const other = item.region.cell;
            return (
              cell.row < other.row + other.rowSpan &&
              other.row < cell.row + cell.rowSpan &&
              cell.column < other.column + other.columnSpan &&
              other.column < cell.column + cell.columnSpan
            );
          })(),
      )
    )
      return NextResponse.json(
        { error: "单元格与已确认关系重叠，请先核对合并或续表行号。" },
        { status: 409 },
      );
    if (
      material.segments.some(
        (item) =>
          item.segmentIndex !== segment.segmentIndex &&
          item.region?.status === "confirmed" &&
          item.region.pageNumber === segment.region!.pageNumber &&
          item.region.readingOrder === regionInput.readingOrder,
      )
    )
      return NextResponse.json(
        { error: "该页已有区域使用此阅读顺序，请使用独立顺序号。" },
        { status: 409 },
      );
    segment.region = {
      ...segment.region,
      role: input.data.role,
      readingOrder: input.data.readingOrder,
      recognition: input.data.recognition,
      cell,
      status: "confirmed",
      reviewedBy: requestIdentity(request),
      reviewedAt: new Date().toISOString(),
      note: input.data.note,
    };
    note = input.data.note;
    revised.parseMessage = "已确认所选区域的文字与结构；其他候选区域保持未确认。";
    revised.segments.sort(
      (first, second) =>
        (first.region?.pageNumber ?? 0) - (second.region?.pageNumber ?? 0) ||
        (first.region?.readingOrder ?? first.segmentIndex) -
          (second.region?.readingOrder ?? second.segmentIndex),
    );
  } else if (input.data.action === "correction") {
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
    if (segment.region)
      segment.region = {
        ...segment.region,
        status: "candidate",
        reviewedBy: undefined,
        reviewedAt: undefined,
        note: "文字已修订，请重新核对区域和结构。",
      };
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
      actorId: requestIdentity(request),
      imageProcessing:
        input.data.action === "enhance" ? input.data.processing : revised.revision?.imageProcessing,
      note,
      ...(input.data.action === "retry" ? { pageNumber: input.data.pageNumber } : {}),
    },
  });
  return NextResponse.json(
    { material: saved },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
