export function beijingDay(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function homepageOptions(filters: Record<string, string | undefined>): {
  days: number;
  size: number;
} {
  const days = Number(filters.days),
    size = Number(filters.size);
  return {
    days: [7, 30, 60, 90].includes(days) ? days : 30,
    size: [6, 12, 24].includes(size) ? size : 12,
  };
}
export function nodeTimestamp(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value);
}
export function isUpcoming(value: string, now = Date.now(), days = 30): boolean {
  if (!value) return false;
  const time = nodeTimestamp(value);
  return time >= nodeTimestamp(beijingDay(now)) && time <= now + days * 86400000;
}
