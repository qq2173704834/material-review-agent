import "server-only";
import { examReminders } from "./exam-reminders";
import { studentGoals } from "./student-goals";
import { listNotices } from "./exam-store";
import { resolvedGoalNotice } from "@/lib/goal-schedule";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
export function campusExamNodes(
  userId: string,
  now = Date.now(),
): Array<{ id: string; title: string; label: string; value: string; href: string }> {
  const reminders = examReminders(userId, now).map((node) => ({
    ...node,
    id: `${node.id}:${node.label}:${node.value}`,
    href: `/exams/${node.id}`,
  }));
  const notices = listNotices();
  const unknown = studentGoals(userId)
    .filter((goal) => goal.state === "active")
    .flatMap((goal) => {
      const notice = resolvedGoalNotice(goal, notices);
      if (
        notice?.content.disposition === "正常" &&
        notice.content.timeline.some(
          (node) => /考试|笔试|口试|面试/u.test(node.label) && node.value,
        )
      )
        return [];
      return [
        {
          id: `goal-${goal.id}`,
          title: CATEGORY_LABELS[goal.category] || goal.category,
          label: "考试时间待公布",
          value: "",
          href: `/me/goals/${goal.id}`,
        },
      ];
    });
  return [...reminders, ...unknown];
}
