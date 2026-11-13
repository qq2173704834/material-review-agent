import { readSmallJson } from "@/lib/server/request-json";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewStore } from "@/lib/server/review-store";
import { requestIdentity } from "@/lib/server/access-config";
import { fieldCandidates } from "@/lib/field-alignment";

export const runtime = "nodejs";
const schema = z
  .object({
    expected: z.string().max(400_000),
    mappings: z
      .array(
        z
          .object({
            subject: z.string().trim().min(1).max(80),
            canonicalField: z.string().trim().min(1).max(40),
            materialId: z.string().uuid(),
            materialVersion: z.number().int().positive(),
            segmentIndex: z.number().int().nonnegative(),
            sourceField: z.string().trim().min(1).max(40),
            rawValue: z.string().trim().min(1).max(200),
            note: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success)
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  const input = schema.safeParse(await readSmallJson(request, 3_000_000).catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "映射格式无效，请填写主体、标准字段和确认依据。" },
      { status: 400 },
    );
  const store = getReviewStore(),
    task = store.getTask(taskId);
  if (!task) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  const actor = requestIdentity(request);
  if (!actor) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  const candidates = fieldCandidates(task.materials);
  const seen = new Set<string>();
  for (const mapping of input.data.mappings) {
    const key = JSON.stringify([mapping.subject, mapping.canonicalField, mapping.materialId]);
    if (
      seen.has(key) ||
      !candidates.some(
        (candidate) =>
          candidate.materialId === mapping.materialId &&
          candidate.materialVersion === mapping.materialVersion &&
          candidate.segmentIndex === mapping.segmentIndex &&
          candidate.sourceField === mapping.sourceField &&
          candidate.rawValue === mapping.rawValue,
      )
    )
      return NextResponse.json(
        { error: "原文已变化、映射重复或证据不属于本任务，请刷新核对。" },
        { status: 409 },
      );
    seen.add(key);
  }
  const previous = task.background.fieldMappings ?? [];
  const mappings = input.data.mappings.map(
    (mapping) =>
      previous.find((item) => {
        const { confirmedBy: previousActor, confirmedAt: previousTime, ...old } = item;
        void previousActor;
        void previousTime;
        return JSON.stringify(old) === JSON.stringify(mapping);
      }) ?? { ...mapping, confirmedBy: actor, confirmedAt: new Date().toISOString() },
  );
  if (!store.saveFieldMappings(taskId, input.data.expected, mappings))
    return NextResponse.json({ error: "映射已被修改，请刷新后重试。" }, { status: 409 });
  return NextResponse.json(
    { task: store.getTask(taskId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
