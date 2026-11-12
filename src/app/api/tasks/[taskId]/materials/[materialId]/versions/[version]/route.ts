import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string; materialId: string; version: string }> },
): Promise<Response> {
  const { taskId, materialId, version } = await context.params;
  const params = new URL(request.url).searchParams;
  const offset = Number(params.get("offset") ?? "0");
  if (
    !reviewTaskIdSchema.safeParse(taskId).success ||
    !reviewTaskIdSchema.safeParse(materialId).success ||
    !/^[1-9]\d{0,8}$/.test(version) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return NextResponse.json({ error: "材料版本或片段位置无效。" }, { status: 400 });
  }
  const store = getReviewStore();
  if (params.get("file") === "1") {
    const file = store.getMaterialFile(taskId, materialId, Number(version));
    if (!file) return NextResponse.json({ error: "该任务中没有此材料版本。" }, { status: 404 });
    try {
      const root = resolve(
        process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
      );
      const expectedDirectory = await realpath(resolve(root, "materials", taskId));
      const path = await realpath(resolve(root, file.storageKey));
      if (!path.startsWith(expectedDirectory + sep)) throw new Error("Invalid storage location");
      const content = await readFile(path);
      const inline = ["application/pdf", "image/png", "image/jpeg"].includes(file.mediaType);
      return new Response(content, {
        headers: {
          "Content-Type": inline ? file.mediaType : "application/octet-stream",
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalFileName)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      return NextResponse.json(
        { error: "原件不可用，仍可查看已保存的解析片段和证据。" },
        { status: 404 },
      );
    }
  }
  const preview = store.getMaterialVersionPreview(taskId, materialId, Number(version), offset);
  if (!preview) return NextResponse.json({ error: "该任务中没有此材料版本。" }, { status: 404 });
  return NextResponse.json({ preview }, { headers: { "Cache-Control": "no-store" } });
}
