export function assistantPolicy(environment: Record<string, string | undefined>): {
  enabled: boolean;
  hourlyLimit: number;
} {
  const limit = Number(environment.ASSISTANT_HOURLY_LIMIT ?? 20);
  return {
    enabled: environment.ASSISTANT_ENABLED !== "off",
    hourlyLimit: Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 20,
  };
}

export function lacksDatedExamNotice(
  question: string,
  learning: boolean,
  sources: readonly { url: string; scope: string; historical: boolean }[],
): boolean {
  const year = question.match(/20\d{2}/)?.[0];
  if (learning || !year) return false;
  const schedule =
    /(?:报名|缴费|准考证|考试|笔试|口试|成绩)[^。！？]{0,16}(?:何时|什么时候|哪|几月|几号|时间|日期|截止|开始)|(?:何时|什么时候|哪一天|哪天|几月|几号)[^。！？]{0,16}(?:报名|缴费|准考证|考试|笔试|口试|成绩)/.test(
      question,
    );
  return (
    schedule &&
    !sources.some(
      (source) =>
        !source.historical &&
        source.url.startsWith("/exams/") &&
        source.scope.split(" · ")[1]?.includes(year),
    )
  );
}
