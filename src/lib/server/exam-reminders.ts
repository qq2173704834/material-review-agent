import "server-only";
import { platformDb } from "./platform-db";
import { favorites, listNotices, matchesExamCategory, type ExamNotice } from "./exam-store";
import { studentGoals } from "./student-goals";
import { learningEntries } from "./learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { isUpcoming, nodeTimestamp } from "@/lib/portal-feed";

export function reminderNotices(userId: string): ExamNotice[] {
  const goals = studentGoals(userId).filter((goal) => goal.state === "active");
  const selected = new Map(
    favorites(userId).map((item) => [item.id, item] as [string, ExamNotice]),
  );
  for (const item of listNotices()) {
    if (
      goals.some((goal) =>
        goal.noticeId
          ? goal.noticeId === item.id
          : matchesExamCategory(item.content, goal.category) &&
            (item.content.region === "全国" || goal.region === item.content.region) &&
            goal.edition !== "待确认考期" &&
            goal.edition === item.content.edition,
      )
    ) {
      selected.set(item.id, item);
    }
  }
  return [...selected.values()];
}

export function examReminders(
  userId: string,
  now = Date.now(),
): Array<{
  id: string;
  version: number;
  title: string;
  label: string;
  value: string;
  read: boolean;
}> {
  const reads = platformDb()
    .prepare<[string], { notice_id: string; version: number }>(
      "SELECT notice_id,version FROM exam_reminder_reads WHERE user_id=?",
    )
    .all(userId);
  const knowledge = learningEntries();
  return reminderNotices(userId)
    .filter(
      (item) =>
        item.status === "published" &&
        item.content.disposition === "正常" &&
        !catalogLifecycle(knowledge, item.content.category, item.content.region).blocked,
    )
    .flatMap((item) =>
      item.content.timeline
        .filter((point) => isUpcoming(point.value, now))
        .map((point) => ({
          id: item.id,
          version: item.version,
          title: item.content.title,
          ...point,
          read: reads.some((read) => read.notice_id === item.id && read.version === item.version),
        })),
    )
    .sort((a, b) => nodeTimestamp(a.value) - nodeTimestamp(b.value));
}

export function markReminderRead(userId: string, id: string, version: number): void {
  const item = reminderNotices(userId).find((item) => item.id === id);
  if (!item || item.version !== version)
    throw new Error("提醒不存在、已取消关注或版本已更新，请刷新后重试。");
  platformDb()
    .prepare(
      "INSERT INTO exam_reminder_reads(user_id,notice_id,version,read_at) VALUES (?,?,?,?) ON CONFLICT(user_id,notice_id) DO UPDATE SET version=excluded.version,read_at=excluded.read_at",
    )
    .run(userId, id, version, new Date().toISOString());
}
