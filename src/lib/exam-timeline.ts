import reviewedDates from "../domain/reviewed-exam-dates.json" with { type: "json" };

export interface ExamTimePoint {
  label: string;
  value: string;
  quote?: string;
  endValue?: string;
  sourceUrl?: string;
}
interface TimelineContent {
  timeline: ExamTimePoint[];
  title?: string;
  category?: string;
  region?: string;
  edition?: string;
  year?: number;
  text?: string;
}

/** Reviewed dates supplement the exact public text; stored versions and material rules stay intact. */
export function reviewedExamDates(
  content: TimelineContent,
): (typeof reviewedDates)[number] | undefined {
  return reviewedDates.find(
    (entry) =>
      Object.entries(entry.match).every(
        ([key, value]) => content[key as keyof TimelineContent] === value,
      ) &&
      !entry.timeline.some((point) => {
        const stored = content.timeline.find((item) => item.label === point.label);
        return (
          !!stored?.value &&
          (stored.value !== point.value ||
            (!!stored.endValue &&
              stored.endValue !== ("endValue" in point ? point.endValue : undefined)))
        );
      }),
  );
}
export function examTimeline(content: TimelineContent): ExamTimePoint[] {
  const reference = reviewedExamDates(content);
  const points = content.timeline.map((point) => ({ ...point }));
  for (const point of reference?.timeline || []) {
    const existing = points.find((item) => item.label === point.label);
    if (existing?.value) {
      // A later editor's explicit date always wins. Only a matching date gets its reviewed range.
      if (existing.value === point.value && !existing.endValue && "endValue" in point)
        Object.assign(existing, { endValue: point.endValue, sourceUrl: reference?.sourceUrl });
    } else {
      const resolved = { ...point, sourceUrl: reference?.sourceUrl };
      if (existing) Object.assign(existing, resolved);
      else points.push(resolved);
    }
  }
  return points.filter((point) => point.value || point.quote);
}

export function formatExamPoint(point: ExamTimePoint): string {
  const format = (value: string): string => value.replace("T", " ").replace(/:00\+08:00$/u, "");
  return point.endValue && point.endValue !== point.value
    ? `${format(point.value)} 至 ${format(point.endValue)}`
    : format(point.value);
}

export function missingExamTimeLabel(point: ExamTimePoint): string {
  return /另行公布|另行通知|尚未公布|待公布/u.test(point.quote || "") ? "另行通知" : "本公告未列明";
}

/** Flag clear prose dates for editors; ambiguous, relative and per-school dates are never inferred. */
export function unrecordedExamDates(content: TimelineContent): string[] {
  const dates: string[] = [];
  const pattern =
    /(?:考试|笔试|初试|面试|口试)[^。\n]{0,60}?(?:将于|定于|时间为|时间[：:])\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/gu;
  for (const match of (content.text || "").matchAll(pattern)) {
    if (/报名|成绩|证书|缴费|准考证/u.test(match[0])) continue;
    const year = match[1] || content.year;
    if (!year || !match[2] || !match[3]) continue;
    const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
      continue;
    if (
      !examTimeline(content).some(
        (point) =>
          /考试|笔试|初试|面试|口试/u.test(point.label) && point.value.slice(0, 10) === date,
      )
    )
      dates.push(date);
  }
  return [...new Set(dates)];
}
