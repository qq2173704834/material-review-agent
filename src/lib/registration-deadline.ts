export interface RegistrationDeadline {
  label: string;
  date: string;
  urgent: boolean;
}
export function registrationDeadline(
  content: { disposition: string; timeline: Array<{ label: string; value: string }> },
  now = Date.now(),
): RegistrationDeadline {
  const unknown = { label: "报名截止时间待确认", date: "", urgent: false };
  if (content.disposition !== "正常")
    return { label: `${content.disposition}，请核对最新公告`, date: "", urgent: false };
  const value = content.timeline.find((point) => point.label === "报名截止")?.value ?? "";
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\+08:00)?$/.test(value)) return unknown;
  if (
    value.length > 10 &&
    (Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14, 16)) > 59 ||
      Number(value.slice(17, 19)) > 59)
  )
    return unknown;
  const timestamp = Date.parse(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return unknown;
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return unknown;
  if (value.length === 10) {
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(day) - Date.parse(today)) / 86400000);
    return {
      label:
        days < 0
          ? "报名截止日期已过"
          : days === 0
            ? "今日为报名截止日期，请核对具体时刻"
            : `距报名截止日期还有${days}天（具体时刻待确认）`,
      date: day,
      urgent: false,
    };
  }
  const remainingMs = timestamp - now;
  const minutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return {
    label:
      remainingMs < 0
        ? "报名已截止"
        : remainingMs === 0
          ? "已到报名截止时刻"
          : `距报名截止${days ? `${days}天` : ""}${hours ? `${hours}小时` : ""}${remainingMinutes ? `${remainingMinutes}分钟` : ""}`,
    date: `${day} ${value.slice(11, 16)}（北京时间）`,
    urgent: remainingMs > 0 && remainingMs <= 86400000,
  };
}
