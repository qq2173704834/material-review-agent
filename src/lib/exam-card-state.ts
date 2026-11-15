import { nodeTimestamp } from "./portal-feed.ts";
import { examTimeline, type ExamTimePoint } from "./exam-timeline.ts";
interface ExamSchedule {
  stage?: string;
  disposition: string;
  timeline: ExamTimePoint[];
  title?: string;
}
export interface ExamCardState {
  kind: "registration" | "exam" | "upcoming" | "closed" | "unknown" | "paused";
  label: string;
  tone: "green" | "blue" | "amber" | "gray";
  detail: string;
  current: boolean;
}
export function examCardState(content: ExamSchedule, now = Date.now()): ExamCardState {
  const timeline = examTimeline(content);
  if (content.disposition !== "正常")
    return {
      kind: "paused",
      label: content.disposition,
      tone: "gray",
      detail: "请以最新官方处置公告为准",
      current: false,
    };
  if (content.stage === "成绩") {
    const resultDate = timeline.find((node) => node.label === "成绩")?.value;
    const isFuture = !!resultDate && nodeTimestamp(resultDate) > now;
    return {
      kind: "upcoming",
      label: isFuture ? "待公布成绩" : "成绩查询",
      tone: "blue",
      detail: isFuture ? `成绩公布：${resultDate}` : "成绩或证书查询公告，请按原文指引查询",
      current: false,
    };
  }
  const start = timeline.find((node) => node.label === "报名开始")?.value ?? "",
    end = timeline.find((node) => node.label === "报名截止")?.value ?? "";
  const startTime = nodeTimestamp(start),
    endTime = nodeTimestamp(end) + (end.length === 10 ? 86400000 - 1 : 0);
  if (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime <= endTime &&
    now >= startTime &&
    now <= endTime
  ) {
    const dateOnly = start.length === 10 || end.length === 10;
    return {
      kind: "registration",
      label: dateOnly ? "报名时刻待确认" : "可报名",
      tone: dateOnly ? "amber" : "green",
      detail: dateOnly
        ? "处于公布的报名日期范围，请核对具体时刻和通道"
        : "处于公告报名时段，资格及通道状态以官方为准",
      current: true,
    };
  }
  const exams = timeline.filter(
    (node) =>
      /^(笔试|面试|口试|考试)$/.test(node.label) && Number.isFinite(nodeTimestamp(node.value)),
  );
  const examEnd = (point: ExamTimePoint): number => {
    const value = point.endValue || point.value.slice(0, 10);
    return nodeTimestamp(value) + (value.length === 10 ? 86400000 - 1 : 0);
  };
  if (exams.some((node) => now >= nodeTimestamp(node.value) && now <= examEnd(node)))
    return {
      kind: "exam",
      label: exams.some((node) => node.endValue && node.endValue !== node.value)
        ? "考试进行中"
        : "今日考试",
      tone: "blue",
      detail: "今日有已公布考试安排，具体场次以准考证为准",
      current: true,
    };
  if (Number.isFinite(startTime) && startTime > now)
    return {
      kind: "upcoming",
      label: "即将报名",
      tone: "blue",
      detail: `报名开始：${start}`,
      current: false,
    };
  if (exams.some((node) => nodeTimestamp(node.value) > now))
    return {
      kind: "upcoming",
      label: "待考试",
      tone: "blue",
      detail: "已公布后续考试节点，请核对具体安排",
      current: false,
    };
  if (exams.length && exams.every((point) => examEnd(point) < now))
    return {
      kind: "closed",
      label: "考试已结束",
      tone: "gray",
      detail: "本考期已公布的考试日期已过",
      current: false,
    };
  if (Number.isFinite(endTime) && endTime < now)
    return {
      kind: "closed",
      label: "报名已截止",
      tone: "gray",
      detail: `报名截止：${end}`,
      current: false,
    };
  return {
    kind: "unknown",
    label: /证书|合格证/u.test(content.title || "")
      ? "证书通知"
      : content.stage === "考试"
        ? "考试通知"
        : "日程未收录",
    tone: "amber",
    detail: "本公告未列完整日程，可查看原文或对应考期的安排通知",
    current: false,
  };
}
