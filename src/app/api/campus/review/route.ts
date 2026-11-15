import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { campusDb, campusState, campusNotices } from "@/lib/server/campus-store";
import { getReviewStore } from "@/lib/server/review-store";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({ id: z.string().max(100), digest: z.string().max(64) })
      .strict()
      .parse(await readSmallJson(request));
    const state = campusState(user.id),
      notice = campusNotices(state.preferences.schoolId).find((notice) => notice.id === input.id);
    if (!notice || notice.withdrawn || notice.digest !== input.digest)
      throw new Error("通知已更新或不属于当前学校，请刷新核对。");
    if (!/(?:提交|上传|报送|提供)[^。\n]{0,60}(?:申请表|证明|报告|附件|材料)/u.test(notice.text))
      throw new Error("该通知没有识别到明确材料要求，请先核对原文。");
    const db = campusDb(),
      store = getReviewStore();
    db.exec(
      "CREATE TABLE IF NOT EXISTS campus_review_links(user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, notice_id TEXT NOT NULL,digest TEXT NOT NULL,task_id TEXT NOT NULL,PRIMARY KEY(user_id,notice_id,digest))",
    );
    const taskId = db.transaction(() => {
      const existing = db
        .prepare<[string, string, string], { task_id: string }>(
          "SELECT task_id FROM campus_review_links WHERE user_id=? AND notice_id=? AND digest=?",
        )
        .get(user.id, notice.id, notice.digest);
      if (existing && store.canAccessTask(existing.task_id, user.id)) return existing.task_id;
      const task = store.createTask({
        ownerId: user.id,
        name: notice.title.slice(0, 100),
        description: `校园通知：${notice.url}\n通知标识：${notice.id}\n原文校验：${notice.digest}`,
        noticeText: notice.text,
        sourceType: "webpage",
        sourceUrl: notice.url,
        sourceFetchedAt: notice.updatedAt,
        sourceTitle: notice.title,
        background: {
          projectType: "校园材料自查",
          projectStage: "提交前",
          collaborationScope: "unknown",
        },
      });
      db.prepare(
        "INSERT INTO campus_review_links(user_id,notice_id,digest,task_id) VALUES (?,?,?,?) ON CONFLICT(user_id,notice_id,digest) DO UPDATE SET task_id=excluded.task_id",
      ).run(user.id, notice.id, notice.digest, task.id);
      return task.id;
    })();
    return NextResponse.json({ taskId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "暂时无法建立自查任务。" },
      { status: 400 },
    );
  }
}
