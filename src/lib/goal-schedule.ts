import type { StudentGoal } from "../domain/student-goal";
import type { ExamNotice } from "./server/exam-store";

/** 优先按已选公告 ID 关联，否则按已确认考期匹配，并限定考试类别和地区。 */
export function matchingGoalNotices(
  goal: Pick<StudentGoal, "category" | "region" | "edition" | "noticeId">,
  notices: ExamNotice[],
): ExamNotice[] {
  return notices.filter(
    (item) =>
      item.status === "published" &&
      (goal.noticeId
        ? item.id === goal.noticeId
        : goal.edition !== "待确认考期" && item.content.edition === goal.edition) &&
      (item.content.category === goal.category ||
        item.content.categories?.includes(goal.category) ||
        ((goal.category === "cet4" || goal.category === "cet6") &&
          (item.content.category === "cet4" || item.content.category === "cet6") &&
          /四、六级|四六级|四级.*六级/.test(item.content.title))) &&
      (item.content.region === "全国" || item.content.region === goal.region),
  );
}
/** 只有唯一候选时才确定关联公告，多个匹配留给目标选择流程处理。 */
export function resolvedGoalNotice(
  goal: Pick<StudentGoal, "category" | "region" | "edition" | "noticeId">,
  notices: ExamNotice[],
): ExamNotice | undefined {
  const matches = matchingGoalNotices(goal, notices);
  return matches.length === 1 ? matches[0] : undefined;
}

export function countdownLabel(value: string, now: number): string {
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || !Number.isFinite(Date.parse(value)))
    return "时间待公布";
  if (value.length === 10) {
    // 全天日期按北京时间的日历日比较，避免按当前时刻计算而提前或延后一天。
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(value) - Date.parse(today)) / 86400000);
    return days === 0 ? "今天" : days > 0 ? `还有${days}天` : "已到日期";
  }
  const remaining = Date.parse(value) - now;
  if (remaining <= 0) return "已到时间";
  return remaining >= 86400000
    ? `还有${Math.ceil(remaining / 86400000)}天`
    : `还有${Math.ceil(remaining / 3600000)}小时`;
}

/** 时间戳统一按北京时间展示，使服务端与浏览器首屏使用相同的时区。 */
export function formatExamTime(value: string): string {
  if (!value.includes("T") || !Number.isFinite(Date.parse(value))) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}
