/** Keep server-rendered timestamps and browser hydration in the same time zone. */
export function displayDateTime(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString("zh-CN", { ...options, timeZone: "Asia/Shanghai" });
}
