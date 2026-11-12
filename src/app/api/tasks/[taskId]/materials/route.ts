import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";
import { parseMaterial } from "@/lib/server/material-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_FILE_COUNT = 10;
const MAXIMUM_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAXIMUM_BATCH_SIZE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_MULTIPART_REQUEST_BYTES = MAXIMUM_BATCH_SIZE_BYTES + 2 * 1024 * 1024;

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_MULTIPART_REQUEST_BYTES) {
    return NextResponse.json({ error: "上传请求超过 52 MiB 上限。" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "上传请求无法读取。" }, { status: 400 });
  }
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length || files.length > MAXIMUM_FILE_COUNT) {
    return NextResponse.json(
      { error: `每批需选择 1 至 ${MAXIMUM_FILE_COUNT} 个文件。` },
      { status: 400 },
    );
  }
  if (
    files.some((file) => file.size <= 0 || file.size > MAXIMUM_FILE_SIZE_BYTES) ||
    files.reduce((total, file) => total + file.size, 0) > MAXIMUM_BATCH_SIZE_BYTES
  ) {
    return NextResponse.json(
      { error: "文件不能为空；单个文件上限 20 MiB，整批上限 50 MiB。" },
      { status: 413 },
    );
  }

  const baseDirectory = resolve(
    process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
  );
  const storageDirectory = resolve(baseDirectory, "materials", taskId);
  const results = [];
  for (const file of files) {
    const originalFileName =
      Array.from(file.name, (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return character === "/" || character === "\\" || codePoint < 32 ? "_" : character;
      })
        .join("")
        .slice(0, 180) || "unnamed-file";
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const previous = store
      .listMaterials(taskId)
      .find((material) => material.originalFileName === originalFileName);
    const version = (previous?.version ?? 0) + 1;
    const key = `${id}-v${version}`;
    let parsed;
    try {
      parsed = await parseMaterial(buffer, originalFileName);
    } catch (error) {
      const parseMessage = error instanceof Error ? error.message : "文件解析失败。";
      parsed = {
        mediaType: "application/octet-stream",
        extension: originalFileName.split(".").pop()?.toLowerCase() ?? "",
        parseStatus: "failed" as const,
        parserName: "signature-validator",
        extractedText: "",
        segments: [],
        pageCount: null,
        sheetNames: [],
        parseMessage,
      };
    }
    await mkdir(storageDirectory, { recursive: true });
    const storageKey = `materials/${taskId}/${key}`;
    await writeFile(resolve(storageDirectory, key), buffer, { flag: "wx", mode: 0o600 });
    let saved;
    try {
      saved = store.saveMaterialVersion({
        id: previous?.id ?? id,
        taskId,
        version,
        originalFileName,
        mediaType: parsed.mediaType,
        extension: parsed.extension,
        fileSizeBytes: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        storageKey,
        parseStatus: parsed.parseStatus,
        parserName: parsed.parserName,
        extractedText: parsed.extractedText,
        segments: parsed.segments,
        pageCount: parsed.pageCount,
        sheetNames: parsed.sheetNames,
        parseMessage: parsed.parseMessage,
        createdAt: new Date().toISOString(),
      });
    } catch {
      await rm(resolve(storageDirectory, key), { force: true }).catch(() => undefined);
      return NextResponse.json({ error: "材料元数据保存失败，本次上传未完成。" }, { status: 500 });
    }
    results.push({
      id: saved.id,
      version: saved.version,
      originalFileName,
      parseStatus: saved.parseStatus,
      parseMessage: saved.parseMessage,
    });
  }
  return NextResponse.json(
    { materials: results },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
