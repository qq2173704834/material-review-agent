import "server-only";
import { randomUUID } from "node:crypto";
import { platformDb } from "./platform-db";
import { notice, matchesExamCategory } from "./exam-store";
import { goalInputSchema, type GoalInput, type StudentGoal } from "@/domain/student-goal";
interface GoalRow {
  id: string;
  payload: string;
  auto_review: number;
  task_id: string | null;
  notice_version: number | null;
  updated_at: string;
}
function mapGoal(row: GoalRow): StudentGoal {
  return {
    ...goalInputSchema.parse(JSON.parse(row.payload)),
    id: row.id,
    updatedAt: row.updated_at,
    autoReview: !!row.auto_review,
    taskId: row.task_id,
    noticeVersion: row.notice_version,
  };
}
export function studentGoals(userId: string): StudentGoal[] {
  return platformDb()
    .prepare<[string], GoalRow>(
      "SELECT * FROM student_goals WHERE user_id=? ORDER BY updated_at DESC",
    )
    .all(userId)
    .map(mapGoal);
}
export function studentGoal(userId: string, id: string): StudentGoal | undefined {
  const row = platformDb()
    .prepare<[string, string], GoalRow>("SELECT * FROM student_goals WHERE user_id=? AND id=?")
    .get(userId, id);
  return row ? mapGoal(row) : undefined;
}
export function saveGoal(userId: string, raw: GoalInput, id?: string): StudentGoal {
  const input = goalInputSchema.parse(raw),
    db = platformDb();
  return db.transaction(() => {
    const previous = id ? studentGoal(userId, id) : undefined;
    if (id && !previous) throw new Error("考试目标不存在。");
    if (!id && studentGoals(userId).length >= 50)
      throw new Error("最多保留50个考试目标，请归档或整理。");
    const source = input.noticeId ? notice(input.noticeId) : undefined;
    if (
      input.noticeId &&
      (!source ||
        !matchesExamCategory(source.content, input.category) ||
        (source.content.region !== "全国" && source.content.region !== input.region) ||
        (input.edition !== "待确认考期" && input.edition !== source.content.edition))
    )
      throw new Error("公告不存在或与考试/地区不匹配。");
    const changedScope =
      previous &&
      [
        previous.category,
        previous.region,
        previous.edition,
        previous.subject,
        previous.noticeId,
      ].join("|") !==
        [input.category, input.region, input.edition, input.subject, input.noticeId].join("|");
    const key = id ?? randomUUID(),
      now = new Date().toISOString();
    db.prepare(
      `INSERT INTO student_goals(id,user_id,category,region,edition,subject,state,payload,notice_id,notice_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET category=excluded.category,region=excluded.region,edition=excluded.edition,subject=excluded.subject,state=excluded.state,payload=excluded.payload,notice_id=excluded.notice_id,updated_at=excluded.updated_at`,
    ).run(
      key,
      userId,
      input.category,
      input.region,
      input.edition,
      input.subject,
      input.state,
      JSON.stringify(input),
      input.noticeId ?? null,
      source?.version ?? null,
      now,
    );
    if (changedScope)
      db.prepare(
        "UPDATE student_goals SET auto_review=0,task_id=NULL,notice_version=? WHERE id=? AND user_id=?",
      ).run(source?.version ?? null, key, userId);
    if (input.state !== "active")
      db.prepare("UPDATE student_goals SET auto_review=0 WHERE id=? AND user_id=?").run(
        key,
        userId,
      );
    return studentGoal(userId, key)!;
  })();
}
export function portalPreferences(userId: string): {
  personalized: boolean;
  retainChat: boolean;
  externalEnabled: boolean;
} {
  const row = platformDb()
    .prepare<[string], { personalized: number; retain_chat: number }>(
      "SELECT * FROM portal_preferences WHERE user_id=?",
    )
    .get(userId);
  return {
    personalized: row ? !!row.personalized : true,
    retainChat: row ? !!row.retain_chat : true,
    externalEnabled:
      platformDb()
        .prepare<[string], { external_enabled: number }>(
          "SELECT external_enabled FROM assistant_preferences WHERE user_id=?",
        )
        .get(userId)?.external_enabled !== 0,
  };
}
