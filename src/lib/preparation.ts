import type { PrepAssessment, PrepTask } from "../domain/preparation";

export function prepProgress(tasks: PrepTask[]): {
  completed: number;
  total: number;
  percent: number;
} {
  const completed = tasks.filter((task) => task.doneOn).length;
  return {
    completed,
    total: tasks.length,
    percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  };
}
export function learningDays(
  tasks: PrepTask[],
): Record<string, { tasks: number; minutes: number; recorded: number }> {
  const days: Record<string, { tasks: number; minutes: number; recorded: number }> = {};
  for (const task of tasks) {
    if (!task.doneOn) continue;
    const day = (days[task.doneOn] ??= { tasks: 0, minutes: 0, recorded: 0 });
    day.tasks++;
    if (task.actualMinutes !== null) {
      day.minutes += task.actualMinutes;
      day.recorded++;
    }
  }
  return days;
}
export function comparableScores(a: PrepAssessment, b: PrepAssessment): boolean {
  return (
    a.system === b.system &&
    a.scores.length === b.scores.length &&
    a.scores.every((score) =>
      b.scores.some(
        (other) => other.dimension === score.dimension && other.maximum === score.maximum,
      ),
    )
  );
}

export function learningSummary(
  tasks: PrepTask[],
  start: string,
  end: string,
): { tasks: number; minutes: number | null; days: number } {
  const entries = Object.entries(learningDays(tasks)).filter(([day]) => day >= start && day <= end);
  return {
    tasks: entries.reduce((sum, [, value]) => sum + value.tasks, 0),
    minutes: entries.some(([, value]) => value.recorded > 0)
      ? entries.reduce((sum, [, value]) => sum + value.minutes, 0)
      : null,
    days: entries.length,
  };
}
