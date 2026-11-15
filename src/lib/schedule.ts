import type { CampusEvent } from "../domain/campus";

export const SCHEDULE_GROUPS = ["考试安排", "报名与申请", "作业与报告", "活动与其他"] as const;
export type ScheduleGroup = (typeof SCHEDULE_GROUPS)[number];
export interface ScheduleNode {
  id: string;
  title: string;
  label: string;
  value: string;
  href: string;
  group: ScheduleGroup;
  goalIds: string[];
  done: boolean;
  origin: "exam" | "campus";
  changed: boolean;
  sourceValue: string;
  revision: number;
  manual: boolean;
  manualValue?: string;
  event?: CampusEvent;
}

export function scheduleGroup(label: string): ScheduleGroup {
  if (/报名|申请|缴费|提交材料|资格审核|资格复审/u.test(label)) return "报名与申请";
  if (/作业|报告/u.test(label)) return "作业与报告";
  if (/考试|笔试|口试|面试|准考证|成绩/u.test(label)) return "考试安排";
  return "活动与其他";
}
/** Calendar dates and timezone-less campus clock times are interpreted in Beijing. */
export function scheduleTimestamp(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(value)
  )
    return NaN;
  return Date.parse(
    value.length === 10
      ? `${value}T00:00:00+08:00`
      : /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
        ? value
        : `${value}+08:00`,
  );
}
export function scheduleDate(value: string): string {
  const timestamp = scheduleTimestamp(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10)
    : "";
}
export function scheduleOverdue(value: string, now: number): boolean {
  const time = scheduleTimestamp(value);
  return Number.isFinite(time) && now >= time + (value.length === 10 ? 86400000 : 0);
}
export function sortSchedule(nodes: ScheduleNode[]): ScheduleNode[] {
  return nodes.toSorted((a, b) => {
    const left = scheduleTimestamp(a.value),
      right = scheduleTimestamp(b.value);
    return (
      (Number.isFinite(left) ? left : Infinity) - (Number.isFinite(right) ? right : Infinity) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function campusScheduleNodes(events: CampusEvent[]): ScheduleNode[] {
  return events.map((event) => ({
    id: `campus:${event.id}`,
    title: event.title,
    label: event.kind,
    value: event.kind === "考试" ? event.start : event.end || event.start,
    href: `/me/schedule?edit=${event.id}`,
    group: scheduleGroup(event.kind),
    goalIds: [],
    done: event.done,
    origin: "campus",
    changed: false,
    sourceValue: "",
    revision: 0,
    manual: false,
    event,
  }));
}

export function formatScheduleTime(value: string): string {
  if (value.length === 10) return value;
  const timestamp = scheduleTimestamp(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(timestamp))
        .replaceAll("/", "-")
    : "时间待公布";
}
export function scheduleCountdown(value: string, now: number): string {
  const timestamp = scheduleTimestamp(value);
  if (!Number.isFinite(timestamp)) return "时间待公布";
  if (value.length === 10) {
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(value) - Date.parse(today)) / 86400000);
    return days === 0 ? "今天" : days > 0 ? `还有${days}天` : "已到日期";
  }
  const remaining = timestamp - now;
  return remaining <= 0
    ? "已到时间"
    : remaining >= 86400000
      ? `还有${Math.ceil(remaining / 86400000)}天`
      : `还有${Math.ceil(remaining / 3600000)}小时`;
}
