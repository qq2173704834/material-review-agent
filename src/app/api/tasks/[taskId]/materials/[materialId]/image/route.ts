import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import { readStoredMaterial } from "@/lib/server/material-file";
import { renderMaterialImage } from "@/lib/server/material-image";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string; materialId: string }> },
): Promise<Response> {
  const { taskId, materialId } = await context.params;
  const url = new URL(request.url);
  const input = z
    .object({
      taskId: z.string().uuid(),
      materialId: z.string().uuid(),
      version: z.coerce.number().int().positive(),
      page: z.coerce.number().int().min(1).max(200),
      rotate: z.coerce.number().min(-15).max(15),
    })
    .safeParse({
      taskId,
      materialId,
      version: url.searchParams.get("version"),
      page: url.searchParams.get("page") ?? 1,
      rotate: url.searchParams.get("rotate") ?? 0,
    });
  if (!input.success) return NextResponse.json({ error: "页图参数无效。" }, { status: 400 });
  const store = getReviewStore();
  const material = store
    .listMaterials(taskId, true)
    .find((item) => item.id === materialId && item.version === input.data.version);
  const file = store.getMaterialFile(taskId, materialId, input.data.version);
  if (!material || !file) return NextResponse.json({ error: "材料版本不存在。" }, { status: 404 });
  try {
    const processing =
      url.searchParams.get("preview") === "1"
        ? {
            rotateDegrees: input.data.rotate,
            normalize: url.searchParams.get("normalize") === "1",
            sharpen: url.searchParams.get("sharpen") === "1",
            corners: url.searchParams.has("corners")
              ? z
                  .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
                  .length(4)
                  .parse(JSON.parse(url.searchParams.get("corners")!))
              : undefined,
          }
        : url.searchParams.get("original") === "1"
          ? undefined
          : material.revision?.imageProcessing;
    const image = await renderMaterialImage(
      await readStoredMaterial(taskId, file.storageKey),
      material.extension,
      input.data.page,
      processing,
    );
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "页图渲染失败、超时或繁忙，请核对页码和文件后重试。" },
      { status: 422 },
    );
  }
}
