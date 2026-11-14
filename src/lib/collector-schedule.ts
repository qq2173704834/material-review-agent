export interface ScheduledSource {
  id: string;
  enabled: number;
  failures: number;
  last_attempt: string | null;
  next_run: number;
}

/** Daily catch-up can shorten a healthy interval, but never a failure backoff. */
export function dueCollectorSources<T extends ScheduledSource>(
  sources: readonly T[],
  now: number,
  dailyHour: number,
  limit = 2,
): T[] {
  const local = new Date(now + 8 * 3600000);
  const day = local.toISOString().slice(0, 10);
  const hour = Number.isInteger(dailyHour) && dailyHour >= 0 && dailyHour <= 23 ? dailyHour : 8;
  const attemptTime = (source: T): number => {
    const time = Date.parse(source.last_attempt ?? "");
    return Number.isFinite(time) ? time : 0;
  };
  return sources
    .filter((source) => {
      if (!source.enabled) return false;
      if (source.next_run <= now) return true;
      if (source.failures > 0 || local.getUTCHours() < hour) return false;
      const attempt = attemptTime(source);
      return !attempt || new Date(attempt + 8 * 3600000).toISOString().slice(0, 10) !== day;
    })
    .sort(
      (a, b) =>
        attemptTime(a) - attemptTime(b) || a.next_run - b.next_run || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}
