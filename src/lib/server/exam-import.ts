import "server-only";
import { z } from "zod";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { reviewTaskInputSchema } from "@/domain/review-task";
import { favorites, listNotices, matchesExamCategory, notice } from "./exam-store";
import { studentGoals } from "./student-goals";
import { platformDb } from "./platform-db";
import { getReviewStore } from "./review-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { learningEntries } from "./learning-store";
import type { ExamImportOption, ExamImportPreview } from "@/domain/exam-import";
import type { ReviewTaskDetails } from "@/domain/review";

export function examImportOptions(userId: string): ExamImportOption[] {
  const published = listNotices();
  const summary = (item: (typeof published)[number]): ExamImportOption["candidates"][number] => ({
    id: item.id,
    title: item.content.title,
    region: item.content.region,
    edition: item.content.edition,
    version: item.version,
  });
  return [
    ...studentGoals(userId).map((goal) => ({
      key: `goal:${goal.id}`,
      group: "我的考试目标",
      label: `${CATEGORY_LABELS[goal.category]} · ${goal.region} · ${goal.edition}`,
      candidates: published
        .filter(
          (item) =>
            matchesExamCategory(item.content, goal.category) &&
            (item.content.region === "全国" || item.content.region === goal.region) &&
            (goal.noticeId
              ? item.id === goal.noticeId
              : goal.edition === "待确认考期" || item.content.edition === goal.edition),
        )
        .map(summary),
    })),
    ...favorites(userId).map((item) => ({
      key: `favorite:${item.id}`,
      group: "已收藏公告",
      label: `${item.content.title} · ${item.content.region} · ${item.content.edition}`,
      candidates: published.filter((current) => current.id === item.id).map(summary),
    })),
  ];
}

export function examImportPreview(
  userId: string,
  selection: string,
  noticeId: string,
): ExamImportPreview {
  const option = examImportOptions(userId).find((entry) => entry.key === selection);
  if (!option || !option.candidates.some((item) => item.id === noticeId))
    throw new Error("考试或公告不可用，请重新选择。");
  const item = notice(noticeId);
  if (!item) throw new Error("公告已撤回，请重新选择。");
  const blocked = catalogLifecycle(
    learningEntries(),
    item.content.category,
    item.content.region,
  ).blocked;
  const usable = item.content.disposition === "正常" && !blocked && !!item.content.text.trim();
  const goal = selection.startsWith("goal:")
    ? studentGoals(userId).find((entry) => `goal:${entry.id}` === selection)
    : undefined;
  const store = getReviewStore();
  const linked = platformDb()
    .prepare<[string, string, string], { task_id: string }>(
      "SELECT task_id FROM exam_task_links WHERE user_id=? AND notice_id=? AND stage='导入要求' AND target=? ORDER BY rowid DESC",
    )
    .all(userId, item.id, goal?.subject ?? "")
    .find((entry) => store.taskOwner(entry.task_id) === userId && store.getTask(entry.task_id));
  const existingTaskId =
    goal?.taskId && store.taskOwner(goal.taskId) === userId && store.getTask(goal.taskId)
      ? goal.taskId
      : linked?.task_id;
  return {
    selection,
    id: item.id,
    version: item.version,
    title: item.content.title,
    region: item.content.region,
    edition: item.content.edition,
    url: item.canonical_url,
    text: item.content.text,
    scope: item.content.textScope ?? "全文",
    usable,
    warning: !usable
      ? "当前公告暂不适合导入，请核对考试状态或手动补充要求。"
      : item.content.textScope === "摘录"
        ? "当前仅收录部分原文，可先导入，再补充缺少的要求。"
        : !/材料|证明|提交|上传|附件/.test(item.content.text)
          ? "原文未明确列出材料要求，可导入后补充相关通知。"
          : "",
    existingTaskId: existingTaskId ?? null,
  };
}

const importInput = reviewTaskInputSchema
  .omit({ noticeText: true })
  .extend({
    selection: z.string().regex(/^(goal|favorite):[0-9a-f-]{36}$/),
    noticeId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export function createImportedTask(
  userId: string,
  raw: unknown,
): { task: ReviewTaskDetails; reused: boolean } {
  const input = importInput.parse(raw);
  return platformDb().transaction(() => {
    const preview = examImportPreview(userId, input.selection, input.noticeId);
    if (!preview.usable) throw new Error(preview.warning);
    if (preview.version !== input.version) throw new Error("公告已更新，请重新预览后导入。");
    const store = getReviewStore();
    // Opening an existing task preserves its adopted source and all previous results.
    if (preview.existingTaskId)
      return { task: store.getTask(preview.existingTaskId)!, reused: true };
    const task = store.createTask({
      ownerId: userId,
      name: input.name || preview.title.slice(0, 120),
      description: input.description,
      background: input.background,
      noticeText: preview.text,
      sourceType: "webpage",
      sourceUrl: preview.url,
      sourceTitle: `${preview.title} · 公告v${preview.version} · ${preview.scope}`,
      sourceParseStatus: preview.scope === "摘录" ? "partial" : "text_extracted",
    });
    try {
      const goal = studentGoals(userId).find((entry) => `goal:${entry.id}` === input.selection);
      platformDb()
        .prepare(
          "INSERT INTO exam_task_links(user_id,notice_id,task_id,notice_version,stage,target) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,notice_id,stage,target) DO UPDATE SET task_id=excluded.task_id,notice_version=excluded.notice_version",
        )
        .run(userId, preview.id, task.id, preview.version, "导入要求", goal?.subject ?? "");
      if (input.selection.startsWith("goal:")) {
        // Only bind the task to a goal that already adopted this exact announcement version.
        platformDb()
          .prepare(
            "UPDATE student_goals SET task_id=? WHERE id=? AND user_id=? AND notice_version=? AND notice_id=?",
          )
          .run(task.id, input.selection.slice(5), userId, preview.version, preview.id);
      }
    } catch (error) {
      store.deleteTask(task.id);
      throw error;
    }
    return { task, reused: false };
  })();
}
