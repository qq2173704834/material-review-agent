import type { CampusEvent } from "../domain/campus";

export function campusTimestamp(value: string): number {
  return value
    ? Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : `${value}:00+08:00`)
    : NaN;
}
export function campusReminderKey(event: CampusEvent): string {
  return `${event.id}:${event.kind === "考试" ? event.start : event.end || event.start}:${event.reminderHours}`;
}
export function campusReminders(events: CampusEvent[], now: number): CampusEvent[] {
  return events.filter((event) => {
    const value = event.kind === "考试" ? event.start : event.end || event.start;
    // Date-only deadlines remain date-only: no fabricated 23:59 or two-hour reminder.
    if (
      event.done ||
      !value ||
      !event.reminderHours ||
      (value.length === 10 && event.reminderHours === 2)
    )
      return false;
    const timestamp = campusTimestamp(value);
    return (
      timestamp - now <= event.reminderHours * 3600000 &&
      now < timestamp + (value.length === 10 ? 86400000 : 0)
    );
  });
}
export function campusConflicts(events: CampusEvent[]): Array<[string, string]> {
  const exams = events.filter(
    (event) =>
      !event.done && event.kind === "考试" && event.start.length > 10 && event.end.length > 10,
  );
  return exams.flatMap((left, index) =>
    exams
      .slice(index + 1)
      .filter((right) => left.start < right.end && right.start < left.end)
      .map((right): [string, string] => [left.id, right.id]),
  );
}
export interface CampusDraft {
  title: string;
  course?: string;
  location?: string;
  start: string;
  end: string;
  kind: CampusEvent["kind"];
  quote: string;
  warning: string;
}
export function campusImportPreview(text: string, referenceDate = ""): CampusDraft[] {
  const lines = text
    .split(/[\n。；]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  const reference =
    /^\d{4}-\d{2}-\d{2}$/u.test(referenceDate) &&
    Number.isFinite(Date.parse(referenceDate)) &&
    new Date(referenceDate).toISOString().slice(0, 10) === referenceDate
      ? referenceDate
      : "";
  return lines.map((line) => {
    const matches = [
      ...line.matchAll(
        /(?:(20\d{2})[-/年])?(\d{1,2})[-/月](\d{1,2})日?(?:[ T\s]*(\d{1,2})[:：时](\d{1,2})?分?)?/gu,
      ),
    ];
    const relative = /今天|明天|后天|下周[一二三四五六日天]/u.exec(line)?.[0];
    const values = matches.map((match) => {
      const year = match[1] || reference.slice(0, 4);
      if (!year) return "";
      return `${year}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}${match[4] ? `T${match[4].padStart(2, "0")}:${(match[5] || "00").padStart(2, "0")}` : ""}`;
    });
    if (!values.length && relative && reference) {
      const date = new Date(`${reference}T00:00:00Z`);
      let offset = ({ 今天: 0, 明天: 1, 后天: 2 } as Record<string, number>)[relative];
      if (relative.startsWith("下周"))
        offset =
          7 -
          ((date.getUTCDay() + 6) % 7) +
          Math.min(6, "一二三四五六日天".indexOf(relative.slice(-1)));
      date.setUTCDate(date.getUTCDate() + (offset ?? 0));
      values.push(date.toISOString().slice(0, 10));
    }
    const clocks = [
      ...line.matchAll(
        /(上午|早上|中午|下午|晚上|晚)?(\d{1,2}|[一二三四五六七八九十两]{1,3})[点时](半|(?:\d{1,2}|[一二三四五六七八九十两]{1,3})分)?/gu,
      ),
    ];
    function number(raw: string): number {
      if (/^\d+$/u.test(raw)) return Number(raw);
      const digit = (value: string): number =>
        value === "两" ? 2 : "零一二三四五六七八九".indexOf(value);
      if (raw.includes("十")) {
        const [tens, ones] = raw.split("十");
        return (tens ? digit(tens) : 1) * 10 + (ones ? digit(ones) : 0);
      }
      return digit(raw);
    }
    values.forEach((value, index) => {
      const clock = clocks[index];
      if (value.length !== 10 || !clock) return;
      let hour = number(clock[2]!);
      const minute = clock[3] === "半" ? 30 : clock[3] ? number(clock[3].replace("分", "")) : 0;
      if (/下午|晚上|晚/u.test(clock[1] || "") && hour < 12) hour += 12;
      if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60)
        values[index] =
          `${value}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    });
    const kind = /作业|提交|上交/u.test(line)
      ? "作业"
      : /报名/u.test(line)
        ? "报名"
        : /考试|期中|期末/u.test(line)
          ? "考试"
          : /截止/u.test(line)
            ? "作业"
            : "其他";
    const warning =
      (relative && !reference) || matches.some((match) => !match[1] && !reference)
        ? "请补充原通知日期，再核对具体时间。"
        : matches.length > 2
          ? "包含多个日期，请拆分或选择对应节点。"
          : relative
            ? "已按原通知日期推算；具体时刻请核对。"
            : !values[0]
              ? "未识别到日期，可以保存为时间待定。"
              : "请核对日期与事项的对应关系。";
    return {
      title: line.slice(0, 100),
      course: /课程[：:]\s*([^，,；;\n]{1,60})/u.exec(line)?.[1]?.trim() || "",
      location: /(?:地点|教室)[：:]\s*([^，,；;\n]{1,100})/u.exec(line)?.[1]?.trim() || "",
      start: kind === "考试" ? values[0] || "" : "",
      end: kind === "考试" ? values[1] || "" : values[0] || "",
      kind,
      quote: line,
      warning,
    };
  });
}

/** Beijing calendar window; unknown-time events are never asserted to be this week. */
export function campusQuestionEvents(
  events: CampusEvent[],
  question: string,
  now: number,
): CampusEvent[] {
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const date = new Date(`${today}T00:00:00Z`);
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const minimum = /今天/u.test(question) ? today : weekStart.toISOString().slice(0, 10);
  const maximum = /今天/u.test(question) ? today : weekEnd.toISOString().slice(0, 10);
  return events
    .filter((event) => {
      if (event.done) return false;
      const value = (event.kind === "考试" ? event.start : event.end || event.start).slice(0, 10);
      if (/本周|今天/u.test(question) && (!value || value < minimum || value > maximum))
        return false;
      if (
        /作业/u.test(question) &&
        !/考试|期中|期末/u.test(question) &&
        event.kind !== "作业" &&
        event.kind !== "课程报告"
      )
        return false;
      if (/考试|期中|期末/u.test(question) && !/作业/u.test(question) && event.kind !== "考试")
        return false;
      return true;
    })
    .sort((a, b) => (a.start || a.end || "9999").localeCompare(b.start || b.end || "9999"));
}
