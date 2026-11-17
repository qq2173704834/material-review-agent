import { examTimeline } from "@/lib/exam-timeline";
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

/**
 * 将本人的有效目标和收藏公告投影为日程，再叠加个人完成状态与手动日期。
 * 公告节点保留来源 ID；没有匹配公告或考试时间的目标仍生成时间待定节点。
 */
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
      !examTimeline(source.content).some((point) => /考试|笔试|口试|面试/u.test(point.label))
    ) {
      unknown.push({
        id: `goal:${goal.id}:exam`,
        title: `${CATEGORY_LABELS[goal.category]} · ${goal.edition}`,
        label: "考试安排",
        value: "",
        href: source
          ? `/exams/${source.id}?returnTo=${encodeURIComponent(`/me/schedule?goal=${goal.id}`)}`
          : `/me?editGoal=${goal.id}&returnTo=${encodeURIComponent(`/me/schedule?goal=${goal.id}&pending=1`)}#goal-editor`,
        missingDateReason:
          goal.edition === "待确认考期"
            ? "edition-unselected"
            : !source
              ? "source-unlinked"
              : undefined,
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
    return examTimeline(notice.content).map((point): ScheduleNode => {
      const index = counts.get(point.label) || 0;
      counts.set(point.label, index + 1);
      // 节点 ID 不包含日期，公告延期后仍更新同一节点并保留个人状态。
      const id = `exam:${notice.id}:${point.label}:${index}`;
      // 目标从时间待定转为明确安排时，将原节点状态承接到首个考试节点。
      const unknownState =
        !linkedUnknown && /考试|笔试|口试|面试/u.test(point.label)
          ? (goalIds.get(notice.id) || []).map((id) => saved.get(`goal:${id}:exam`)).find(Boolean)
          : undefined;
      if (/考试|笔试|口试|面试/u.test(point.label)) linkedUnknown = true;
      const prior = saved.get(id) || unknownState;
      const sourceValue = JSON.stringify(
        point.endValue ? [valid, point.value, point.endValue] : [valid, point.value],
      );
      // 保存时的来源值与当前值不同，手动日期暂不投影，等待用户核对新安排。
      const changed = !valid || (!!prior && prior.sourceValue !== sourceValue);
      const date = valid && Number.isFinite(scheduleTimestamp(point.value)) ? point.value : "";
      return {
        id,
        title: notice.content.title,
        label: point.label,
        endValue: !prior?.date && valid ? point.endValue : undefined,
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
/** 校验本人当前可见节点、修订号和来源值后写入个人状态，防止旧页面覆盖新安排。 */
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
