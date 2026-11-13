import { NextResponse } from "next/server";
import { z } from "zod";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { getReviewStore } from "@/lib/server/review-store";
import { readStoredMaterial } from "@/lib/server/material-file";

export const runtime = "nodejs";
const schema = z.object({
  materials: z
    .array(
      z.object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(180),
      }),
    )
    .min(1)
    .max(50),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const store = getReviewStore();
  if (!store.getTask(taskId)) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "请选择1至50份材料及输出名称。" }, { status: 400 });
  const names = new Set<string>();
  const manifest = [];
  const zip = new JSZip();
  let total = 0;
  for (const item of input.data.materials) {
    if (
      /[\\/:*?"<>|\p{Cc}]/u.test(item.name) ||
      /^\.|[. ]$/.test(item.name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.name) ||
      names.has(item.name.toLocaleLowerCase())
    )
      return NextResponse.json(
        { error: "输出名称包含非法路径、保留名称或重复项。" },
        { status: 400 },
      );
    names.add(item.name.toLocaleLowerCase());
    const material = store
      .listMaterials(taskId, true)
      .find((file) => file.id === item.id && file.version === item.version);
    const stored = store.getMaterialFile(taskId, item.id, item.version);
    if (!material || !stored)
      return NextResponse.json({ error: "材料版本不属于当前任务。" }, { status: 404 });
    total += material.fileSizeBytes;
    if (total > 100 * 1024 * 1024)
      return NextResponse.json({ error: "提交包原件总量最多100MiB。" }, { status: 413 });
    const bytes = await readStoredMaterial(taskId, stored.storageKey);
    zip.file(`materials/${item.name}`, bytes);
    manifest.push({
      id: item.id,
      version: item.version,
      originalName: material.originalFileName,
      packageName: item.name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      parseStatus: material.parseStatus,
    });
  }
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        taskId,
        createdAt: new Date().toISOString(),
        notice: "仅整理原件副本，不表示材料审查通过。",
        materials: manifest,
      },
      null,
      2,
    ),
  );
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="submission-materials.zip"',
      "Cache-Control": "no-store",
    },
  });
}
