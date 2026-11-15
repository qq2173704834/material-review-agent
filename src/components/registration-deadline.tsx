"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { registrationDeadline } from "@/lib/registration-deadline";
import { examCardState } from "@/lib/exam-card-state";
function useCurrentTime(initialNow: number): number {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = (): void => setNow(Date.now());
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return now;
}
interface ScheduleProps {
  disposition: string;
  timeline: Array<{ label: string; value: string; endValue?: string }>;
  title?: string;
  initialNow: number;
  stage?: string;
}
const tones = {
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  gray: "bg-slate-400",
};
export function ExamStatus(props: ScheduleProps): ReactElement {
  const now = useCurrentTime(props.initialNow);
  const state = examCardState(props, now);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs"
      title={state.detail}
      aria-label="考试状态"
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${tones[state.tone]}`} />
      {state.label}
    </span>
  );
}
export function RegistrationDeadline({
  disposition,
  timeline,
  initialNow,
  stage,
}: ScheduleProps): ReactElement | null {
  const now = useCurrentTime(initialNow);
  const deadline = registrationDeadline({ disposition, timeline }, now);
  if (stage && stage !== "招考报名" && !timeline.some((point) => point.label === "报名截止"))
    return null;
  return (
    <div className="mt-3 space-y-1 text-xs" aria-label="报名截止提醒">
      <p
        className={
          deadline.urgent
            ? "font-semibold text-amber-700 dark:text-amber-400"
            : "text-muted-foreground"
        }
      >
        {deadline.label}
      </p>
      {deadline.date && <p className="text-muted-foreground">截止：{deadline.date}</p>}
    </div>
  );
}
