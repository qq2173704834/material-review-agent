import "server-only";
import { z } from "zod";
import { platformDb } from "./platform-db";
import {
  favorites,
  listNotices,
  notice as readNotice,
  noticeVersion,
  type ExamNotice,
} from "./exam-store";
import { studentGoals } from "./student-goals";
import { campusDisplayEvents, campusState } from "./campus-store";
import { learningEntries } from "./learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { resolvedGoalNotice } from "@/lib/goal-schedule";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { campusDateSchema } from "@/domain/campus";
import {
  campusScheduleNodes,
  scheduleGroup,
  scheduleTimestamp,
  sortSchedule,
  type ScheduleNode,
} from "@/lib/schedule";

interface NodeState {
  revision: number;
  done: boolean;
  date: string | null;
  sourceValue: string;
}
function scheduleDb(): ReturnType<typeof platformDb> {
  const db = platformDb();
  db.exec(`CREATE TABLE IF NOT EXISTS personal_schedule_nodes (
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id,node_id));`);
  return db;
}

/** Projections retain their source IDs. No copy of a public timeline is imported into private events. */
export function examScheduleNodes(userId: string): ScheduleNode[] {
  const goals = studentGoals(userId).filter((goal) => goal.state === "active");
  const notices = listNotices();
  const knowledge = learningEntries();
  const selected = new Map<string, ExamNotice>(
    favorites(userId).map((notice) => [notice.id, notice]),
  );
  const goalIds = new Map<string, string[]>();
  const unknown: ScheduleNode[] = [];
  for (const goal of goals) {
    let source = resolvedGoalNotice(goal, notices);
    if (!source && goal.noticeId) {
      const prior = readNotice(goal.noticeId, false);
      const published = prior?.published_version
        ? noticeVersion(prior.id, prior.published_version)
        : undefined;
      if (prior && published && prior.status !== "published")
        source = { ...prior, content: published.content, version: prior.published_version! };
    }
    if (source) {
      selected.set(source.id, source);
      goalIds.set(source.id, [...(goalIds.get(source.id) || []), goal.id]);
    }
    if (
      !source ||
      !source.content.timeline.some((point) => /考试|笔试|口试|面试/u.test(point.label))
    ) {
      unknown.push({
        id: `goal:${goal.id}:exam`,
        title: `${CATEGORY_LABELS[goal.category]} · ${goal.edition}`,
        label: "考试时间待公布",
        value: "",
        href: `/me/preparation?goal=${goal.id}`,
        group: "考试安排",
        goalIds: [goal.id],
        done: false,
        origin: "exam",
        changed: false,
        sourceValue: "",
        revision: 0,
        manual: false,
      });
    }
  }
  const saved = new Map(
    scheduleDb()
      .prepare<[string], { node_id: string; payload: string }>(
        "SELECT node_id,payload FROM personal_schedule_nodes WHERE user_id=?",
      )
      .all(userId)
      .map((row) => [row.node_id, JSON.parse(row.payload) as NodeState]),
  );
  const result = [...selected.values()].flatMap((notice) => {
    const valid =
      notice.status === "published" &&
      notice.content.disposition === "正常" &&
      !catalogLifecycle(knowledge, notice.content.category, notice.content.region).blocked;
    const counts = new Map<string, number>();
    let linkedUnknown = false;
    return notice.content.timeline.map((point): ScheduleNode => {
      const index = counts.get(point.label) || 0;
      counts.set(point.label, index + 1);
      // The date is deliberately excluded so postponement updates the existing node.
      const id = `exam:${notice.id}:${point.label}:${index}`;
      const unknownState =
        !linkedUnknown && /考试|笔试|口试|面试/u.test(point.label)
          ? (goalIds.get(notice.id) || []).map((id) => saved.get(`goal:${id}:exam`)).find(Boolean)
          : undefined;
      if (/考试|笔试|口试|面试/u.test(point.label)) linkedUnknown = true;
      const prior = saved.get(id) || unknownState;
      const sourceValue = JSON.stringify([valid, point.value]);
      const changed = !valid || (!!prior && prior.sourceValue !== sourceValue);
      const date = valid && Number.isFinite(scheduleTimestamp(point.value)) ? point.value : "";
      return {
        id,
        title: notice.content.title,
        label: point.label,
        value: prior?.date != null ? (changed ? "" : prior.date) : date,
        href: `/exams/${notice.id}?returnTo=${encodeURIComponent("/me/schedule")}`,
        group: scheduleGroup(point.label),
        goalIds: goalIds.get(notice.id) || [],
        done: prior?.done || false,
        origin: "exam",
        changed,
        sourceValue,
        revision: prior?.revision || 0,
        manual: prior?.date != null,
        manualValue: prior?.date ?? undefined,
      };
    });
  });
  return sortSchedule([
    ...result,
    ...unknown.map((node) => {
      const prior = saved.get(node.id);
      return prior
        ? {
            ...node,
            value: prior.date || "",
            done: prior.done,
            revision: prior.revision,
            manual: prior.date != null,
            manualValue: prior.date ?? undefined,
          }
        : node;
    }),
  ]);
}

export function personalSchedule(userId: string): ScheduleNode[] {
  const originals = campusState(userId).events;
  const campus = campusScheduleNodes(campusDisplayEvents(userId)).map((node) => ({
    ...node,
    changed: originals.some(
      (event) =>
        `campus:${event.id}` === node.id &&
        (event.start !== node.event?.start || event.end !== node.event?.end),
    ),
  }));
  return sortSchedule([...examScheduleNodes(userId), ...campus]);
}

const mutationSchema = z
  .object({
    id: z.string().min(1).max(300),
    expectedRevision: z.number().int().nonnegative(),
    sourceValue: z.string().max(1000),
    command: z.discriminatedUnion("action", [
      z.object({ action: z.literal("done"), done: z.boolean() }).strict(),
      z.object({ action: z.literal("date"), value: campusDateSchema }).strict(),
      z.object({ action: z.literal("reset") }).strict(),
    ]),
  })
  .strict();
export function mutateScheduleNode(userId: string, raw: unknown): void {
  const input = mutationSchema.parse(raw),
    db = scheduleDb();
  db.transaction(() => {
    const node = examScheduleNodes(userId).find((item) => item.id === input.id);
    if (!node) throw new Error("安排已取消或无权访问，请重新读取日程。");
    if (node.revision !== input.expectedRevision || node.sourceValue !== input.sourceValue)
      throw new Error("安排已有更新，请重新读取后核对，输入仍保留。");
    const prior = db
      .prepare<[string, string], { payload: string }>(
        "SELECT payload FROM personal_schedule_nodes WHERE user_id=? AND node_id=?",
      )
      .get(userId, node.id);
    const state: NodeState = prior
      ? (JSON.parse(prior.payload) as NodeState)
      : {
          revision: node.revision,
          done: node.done,
          date: node.manualValue ?? null,
          sourceValue: node.changed ? "" : node.sourceValue,
        };
    if (input.command.action === "done") state.done = input.command.done;
    else {
      state.date = input.command.action === "date" ? input.command.value : null;
      state.sourceValue = node.sourceValue;
    }
    state.revision++;
    db.prepare(
      "INSERT INTO personal_schedule_nodes VALUES (?,?,?) ON CONFLICT(user_id,node_id) DO UPDATE SET payload=excluded.payload",
    ).run(userId, node.id, JSON.stringify(state));
  })();
}
