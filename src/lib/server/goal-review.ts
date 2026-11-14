import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { platformDb } from "./platform-db";
import { studentGoal } from "./student-goals";
import { notice, matchesExamCategory } from "./exam-store";
import { getReviewStore } from "./review-store";
import { runReviewChecks } from "./review-runner";
import { hasCurrentRuleSources } from "@/domain/review-rule";
const state = globalThis as typeof globalThis & {
  __goalReviewControllers?: Map<string, AbortController>;
  __goalReviewTicking?: boolean;
};
const controllers = (state.__goalReviewControllers ??= new Map<string, AbortController>());
export function configureGoalReview(
  userId: string,
  goalId: string,
  stage: string,
  auto: boolean,
): string {
  const goal = studentGoal(userId, goalId),
    db = platformDb(),
    store = getReviewStore();
  if (!goal || !goal.noticeId || goal.state !== "active")
    throw new Error("请选择有效的活动目标和公告。");
  const item = notice(goal.noticeId);
  if (!item || item.version !== goal.noticeVersion)
    throw new Error("公告已变化或撤回，请先核对关联版本。");
  const existing = db
    .prepare<[string, string, string, string], { task_id: string; notice_version: number }>(
      "SELECT task_id,notice_version FROM exam_task_links WHERE user_id=? AND notice_id=? AND stage=? AND target=?",
    )
    .get(userId, item.id, stage, goal.subject);
  let taskId =
    existing && store.taskOwner(existing.task_id) === userId ? existing.task_id : undefined;
  if (existing && taskId && existing.notice_version !== item.version)
    throw new Error("已有任务仍采用旧版本，请先明确采用新公告并重新核对规则。");
  if (!taskId) {
    const task = store.createTask({
      ownerId: userId,
      name: item.content.title.slice(0, 100),
      description: `${goal.edition} · ${goal.region} · ${goal.subject || "科目待确认"}`,
      noticeText: item.content.text,
      sourceType: "webpage",
      sourceTitle: `${item.content.title} · 公告v${item.version}`,
      sourceUrl: item.canonical_url,
      background: {
        projectType: "报考材料",
        projectStage: stage,
        collaborationScope: "individual",
      },
    });
    taskId = task.id;
    try {
      db.prepare(
        "INSERT INTO exam_task_links(user_id,notice_id,task_id,notice_version,stage,target) VALUES (?,?,?,?,?,?)",
      ).run(userId, item.id, taskId, item.version, stage, goal.subject);
    } catch (error) {
      store.deleteTask(taskId);
      throw error;
    }
  }
  db.prepare("UPDATE student_goals SET task_id=?,auto_review=? WHERE id=? AND user_id=?").run(
    taskId,
    auto ? 1 : 0,
    goalId,
    userId,
  );
  return taskId;
}
export function adoptGoalNotice(userId: string, goalId: string): void {
  const goal = studentGoal(userId, goalId),
    db = platformDb(),
    store = getReviewStore();
  if (!goal?.noticeId) throw new Error("目标没有关联公告。");
  const current = notice(goal.noticeId);
  if (!current) throw new Error("公告已撤回。");
  if (
    !matchesExamCategory(current.content, goal.category) ||
    (current.content.region !== "全国" && current.content.region !== goal.region) ||
    (goal.edition !== "待确认考期" && current.content.edition !== goal.edition)
  )
    throw new Error("新版适用考试、地区或考期已变化，请先编辑目标重新核对，不能直接采用。");
  if (current.version === goal.noticeVersion) return;
  if (goal.taskId) {
    if (store.taskOwner(goal.taskId) !== userId) throw new Error("任务归属无效。");
    store.createSupplementSource({
      taskId: goal.taskId,
      sourceType: "webpage",
      sourceUrl: current.canonical_url,
      displayName: `目标明确采用公告v${current.version}，请重新核对规则`,
      text: current.content.text,
      segments: [
        {
          paragraphIndex: 0,
          text: current.content.text,
          startOffset: 0,
          endOffset: current.content.text.length,
        },
      ],
      parseStatus: "text_extracted",
    });
    db.prepare("UPDATE exam_task_links SET notice_version=? WHERE task_id=? AND user_id=?").run(
      current.version,
      goal.taskId,
      userId,
    );
  }
  db.prepare("UPDATE student_goals SET notice_version=? WHERE id=? AND user_id=?").run(
    current.version,
    goalId,
    userId,
  );
}
export function pauseGoalReview(userId: string, goalId: string): void {
  const db = platformDb();
  db.prepare("UPDATE student_goals SET auto_review=0 WHERE id=? AND user_id=?").run(goalId, userId);
  const jobs = db
    .prepare<[string, string], { id: string }>(
      "SELECT id FROM portal_jobs WHERE user_id=? AND goal_id=? AND status='running'",
    )
    .all(userId, goalId);
  for (const job of jobs) controllers.get(job.id)?.abort();
}
export async function goalReviewTick(userId?: string, goalId?: string): Promise<void> {
  if (state.__goalReviewTicking) return;
  state.__goalReviewTicking = true;
  const db = platformDb(),
    store = getReviewStore();
  try {
    db.prepare(
      "UPDATE portal_jobs SET status='failed',reason='服务中断，未自动重试；请核对已有执行后手动复检。',completed_at=? WHERE status='running' AND created_at<?",
    ).run(new Date().toISOString(), new Date(Date.now() - 300000).toISOString());
    const goals = db
      .prepare<[], { id: string; user_id: string; task_id: string }>(
        "SELECT id,user_id,task_id FROM student_goals WHERE state='active' AND auto_review=1 AND task_id IS NOT NULL ORDER BY updated_at LIMIT 100",
      )
      .all()
      .filter((row) => (!userId || row.user_id === userId) && (!goalId || row.id === goalId));
    for (const row of goals) {
      const goal = studentGoal(row.user_id, row.id),
        task = store.getTask(row.task_id);
      if (!goal || !task || store.taskOwner(task.id) !== row.user_id || !goal.noticeId) continue;
      const source = notice(goal.noticeId);
      if (!source || source.version !== goal.noticeVersion) continue;
      const rules = store
        .listRuleSets(task.id)
        .find((candidate) =>
          hasCurrentRuleSources(candidate, [task.noticeSource, ...task.supplementalSources]),
        );
      if (!rules || !task.materials.length || goal.edition === "待确认考期") continue;
      if (
        source.content.attachments.some(
          (attachment) =>
            !task.supplementalSources.some(
              (source) =>
                source.sourceUrl === attachment.url && source.parseStatus === "text_extracted",
            ),
        )
      )
        continue;
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ rules, materials: task.materials, background: task.background }))
        .digest("hex");
      if (
        db
          .prepare("SELECT 1 FROM portal_jobs WHERE goal_id=? AND fingerprint=?")
          .get(goal.id, fingerprint)
      )
        continue;
      const recent = db
        .prepare<[string, string], { count: number }>(
          "SELECT COUNT(*) count FROM portal_jobs WHERE user_id=? AND created_at>?",
        )
        .get(row.user_id, new Date(Date.now() - 86400000).toISOString());
      if ((recent?.count ?? 0) >= 5) continue;
      const id = randomUUID(),
        controller = new AbortController();
      controllers.set(id, controller);
      const reserved = db
        .prepare(
          "INSERT OR IGNORE INTO portal_jobs(id,user_id,goal_id,task_id,fingerprint,status,reason,created_at) VALUES (?,?,?,?,?,'running','已授权目标的规则或材料版本变化',?)",
        )
        .run(id, row.user_id, goal.id, task.id, fingerprint, new Date().toISOString());
      if (!reserved.changes) {
        controllers.delete(id);
        continue;
      }
      try {
        const response = await runReviewChecks(
          new Request("http://internal/checks", { method: "POST", signal: controller.signal }),
          { params: Promise.resolve({ taskId: task.id }) },
        );
        if (!response.ok) throw new Error("未执行：规则未就绪或任务已有检查，请手动核对后重试。");
        await response.text();
        const execution = store.listReviewExecutions(task.id)[0];
        db.prepare(
          "UPDATE portal_jobs SET status=?,reason=?,execution_id=?,completed_at=? WHERE id=?",
        ).run(
          execution?.status ?? "failed",
          execution?.status === "completed"
            ? "自动预审已执行，结论与证据请到任务核对。"
            : "执行中断或取消，请核对已保存结果。",
          execution?.id ?? null,
          new Date().toISOString(),
          id,
        );
      } catch (error) {
        db.prepare("UPDATE portal_jobs SET status='failed',reason=?,completed_at=? WHERE id=?").run(
          error instanceof Error ? error.message : "自动预审失败",
          new Date().toISOString(),
          id,
        );
      } finally {
        controllers.delete(id);
      }
      break;
    }
  } finally {
    state.__goalReviewTicking = false;
  }
}

export function goalReviewReadiness(userId: string, goalId: string): string {
  const goal = studentGoal(userId, goalId);
  if (!goal) return "目标不存在。";
  if (goal.state !== "active") return "目标已暂停或归档。";
  if (!goal.autoReview) return "自动执行未开启，保留手动预审。";
  if (!goal.noticeId) return "请关联适用公告。";
  const current = notice(goal.noticeId);
  if (!current) return "公告已撤回或不可读，自动执行暂停。";
  if (current.version !== goal.noticeVersion)
    return "公告有新版，请先核对差异并明确采用；旧结果需复核。";
  if (goal.edition === "待确认考期") return "请先确认考期。";
  const task = goal.taskId ? getReviewStore().getTask(goal.taskId) : undefined;
  if (!task || getReviewStore().taskOwner(task.id) !== userId) return "请建立本人材料任务。";
  if (!task.materials.length) return "尚未上传材料；不会自动判通过。";
  if (
    current.content.attachments.some(
      (attachment) =>
        !task.supplementalSources.some(
          (source) =>
            source.sourceUrl === attachment.url && source.parseStatus === "text_extracted",
        ),
    )
  )
    return "公告附件尚未读取，请逐份确认导入。";
  if (
    !getReviewStore()
      .listRuleSets(task.id)
      .some((rules) =>
        hasCurrentRuleSources(rules, [task.noticeSource, ...task.supplementalSources]),
      )
  )
    return "缺少当前来源规则，请提取并核对。";
  const used = platformDb()
    .prepare<[string, string], { count: number }>(
      "SELECT COUNT(*) count FROM portal_jobs WHERE user_id=? AND created_at>?",
    )
    .get(userId, new Date(Date.now() - 86400000).toISOString());
  if ((used?.count ?? 0) >= 5) return "最近24小时自动任务已达到5次；可查看历史或手动复检。";
  return "自动条件已就绪；约每分钟检测版本，已运行的相同快照不会重复提交。";
}
