export function beijingDay(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function nodeTimestamp(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value);
}
export function isUpcoming(value: string, now = Date.now(), days = 30): boolean {
  if (!value) return false;
  const time = nodeTimestamp(value);
  return time >= nodeTimestamp(beijingDay(now)) && time <= now + days * 86400000;
}
