import { requestIdentity } from "@/lib/server/access-config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoCases } from "@/lib/demo-cases";
import { parseMaterial } from "@/lib/server/material-parser";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
const schema = z.object({
  domain: z.enum(["competition", "grant"]),
  taskId: z.string().uuid().optional(),
});
export async function POST(request: Request): Promise<Response> {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "演示参数无效。" }, { status: 400 });
  const { domain, taskId } = input.data;
  const demo = demoCases[domain];
  const marker = `[合成演示:${domain}]`;
  const store = getReviewStore();
  if (taskId && !store.canAccessTask(taskId, requestIdentity(request) ?? ""))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  const existing = taskId ? store.getTask(taskId) : undefined;
  if (taskId && (!existing || !existing.description.startsWith(marker)))
    return NextResponse.json({ error: "只能向对应演示任务载入修订版。" }, { status: 422 });
  if (
    taskId &&
    store.listReviewExecutions(taskId).some((execution) => execution.status === "running")
  )
    return NextResponse.json({ error: "请先结束本次检查。" }, { status: 409 });
  let createdTaskId: string | undefined;
  const root = resolve(
    process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
  );
  try {
    const task =
      existing ??
      store.createTask({
        ownerId: requestIdentity(request),
        name: `${demo.name}（合成数据）`,
        description: `${marker} 独立演示任务；初始包含缺失材料、名称不一致和空标题。按当前配置生成规则并运行，结果为实际执行结果，不是预置成绩。可载入修订版后复检；重新创建案例得到独立初始任务。`,
        noticeText: demo.notice,
        background: { collaborationScope: "individual", projectStage: "", projectType: "" },
      });
    if (!existing) createdTaskId = task.id;
    const directory = resolve(root, "materials", task.id);
    await mkdir(directory, { recursive: true });
    for (const [name, text] of Object.entries(existing ? demo.revised : demo.initial)) {
      const buffer = Buffer.from(text);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const previous = store
        .listMaterials(task.id)
        .find((material) => material.originalFileName === name);
      if (previous?.sha256 === sha256) continue;
      const parsed = await parseMaterial(buffer, name);
      const storageKey = `materials/${task.id}/${randomUUID()}`;
      await writeFile(resolve(root, storageKey), buffer, { flag: "wx" });
      try {
        store.saveMaterialVersion({
          ...parsed,
          id: previous?.id ?? randomUUID(),
          taskId: task.id,
          version: (previous?.version ?? 0) + 1,
          originalFileName: name,
          fileSizeBytes: buffer.byteLength,
          sha256,
          storageKey,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        await rm(resolve(root, storageKey), { force: true });
        throw error;
      }
    }
    return NextResponse.json({ taskId: task.id }, { status: 201 });
  } catch {
    if (createdTaskId) {
      await rm(resolve(root, "materials", createdTaskId), { recursive: true, force: true });
      store.deleteTask(createdTaskId);
    }
    return NextResponse.json(
      { error: "演示材料未能全部保存，请重试；已保存材料不会重复创建版本。" },
      { status: 500 },
    );
  }
}
