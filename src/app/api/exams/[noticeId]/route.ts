import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { favorite, notice, noticeHistory } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
import { readSmallJson } from "@/lib/server/request-json";
import { getReviewStore } from "@/lib/server/review-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ noticeId: string }> },
): Promise<NextResponse> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const { noticeId } = await context.params;
  try {
    const input = z
      .object({
        action: z.enum(["favorite", "unfavorite", "seen", "task", "adopt"]),
        stage: z.string().trim().min(1).max(80).optional(),
        target: z.string().trim().max(200).optional(),
        taskId: z.string().uuid().optional(),
        attachments: z.array(z.url()).max(20).optional(),
      })
      .strict()
      .parse(await readSmallJson(request));
    if (["favorite", "unfavorite", "seen"].includes(input.action)) {
      favorite(account.id, noticeId, input.action !== "unfavorite", input.action === "seen");
      return NextResponse.json({ ok: true });
    }
    const item = notice(noticeId);
    if (!item)
      return NextResponse.json({ error: "公告已撤回或不存在，请查阅官方来源。" }, { status: 404 });
    const db = platformDb();
    const store = getReviewStore();
    if (input.action === "task") {
      if (!input.stage) throw new Error("请选择本次预审阶段，具体岗位或科目不明确时请填写待确认。");
      const existing = db
        .prepare<[string, string, string, string], { task_id: string }>(
          "SELECT task_id FROM exam_task_links WHERE user_id=? AND notice_id=? AND stage=? AND target=?",
        )
        .get(account.id, noticeId, input.stage, input.target ?? "");
      if (existing && store.getTask(existing.task_id))
        return NextResponse.json({ taskId: existing.task_id, reused: true });
      if (existing) db.prepare("DELETE FROM exam_task_links WHERE task_id=?").run(existing.task_id);
      const task = store.createTask({
        ownerId: account.id,
        name: item.content.title.slice(0, 100),
        description: `${item.content.edition} · ${item.content.region} · 公告v${item.version} · 对象：${input.target || "待确认"}`,
        noticeText: item.content.text,
        sourceType: "webpage",
        sourceTitle: `${item.content.title} · ${item.content.edition} · ${item.content.region} · ${input.stage} · 公告v${item.version} · 对象：${input.target || "待确认"}`,
        sourceUrl: item.canonical_url,
        background: {
          projectType: "报考材料",
          projectStage: input.stage,
          collaborationScope: "individual",
        },
      });
      try {
        db.prepare(
          "INSERT INTO exam_task_links(user_id,notice_id,task_id,notice_version,stage,target) VALUES (?,?,?,?,?,?)",
        ).run(account.id, noticeId, task.id, item.version, input.stage, input.target ?? "");
      } catch (error) {
        store.deleteTask(task.id);
        throw error;
      }
      return NextResponse.json(
        {
          taskId: task.id,
          message:
            "已保存公告正文快照。附件仍为官方链接，请逐份确认并导入；未读取附件不计入审查依据。",
        },
        { status: 201 },
      );
    }
    if (input.action === "adopt") {
      const link = db
        .prepare<[string, string, string], { notice_version: number }>(
          "SELECT notice_version FROM exam_task_links WHERE user_id=? AND notice_id=? AND task_id=?",
        )
        .get(account.id, noticeId, input.taskId ?? "");
      if (!link || store.taskOwner(input.taskId!) !== account.id)
        throw new Error("只能为自己拥有的关联任务采用新版。");
      if (item.version === link.notice_version) return NextResponse.json({ ok: true });
      const old = noticeHistory(noticeId).find((v) => v.version === link.notice_version);
      if (!old) throw new Error("原始版本无法读取，请先核对记录。");
      store.createSupplementSource({
        taskId: input.taskId!,
        sourceType: "webpage",
        sourceUrl: item.canonical_url,
        displayName: `公告更正 · v${item.version}（请核对新旧差异）`,
        text: item.content.text,
        segments: [
          {
            paragraphIndex: 0,
            text: item.content.text,
            startOffset: 0,
            endOffset: item.content.text.length,
          },
        ],
        parseStatus: "text_extracted",
      });
      db.prepare("UPDATE exam_task_links SET notice_version=? WHERE task_id=? AND user_id=?").run(
        item.version,
        input.taskId,
        account.id,
      );
      return NextResponse.json({
        ok: true,
        message: "新版已作为补充来源保存；旧来源与执行保留，请重新提取并核对规则后复检。",
      });
    }
    throw new Error("无效操作。");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作未完成。" },
      { status: 400 },
    );
  }
}
