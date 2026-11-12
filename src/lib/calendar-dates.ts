export interface GregorianDateMatch {
  text: string;
  startIndex: number;
  endIndex: number;
  timestamp: number;
}

const GREGORIAN_DATE_PATTERN =
  /(\d{4})年(\d{1,2})月(\d{1,2})日?|\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;

export function findGregorianDates(value: string): GregorianDateMatch[] {
  const dates: GregorianDateMatch[] = [];
  for (const match of value.matchAll(GREGORIAN_DATE_PATTERN)) {
    const year = Number(match[1] ?? match[4]);
    const month = Number(match[2] ?? match[5]);
    const day = Number(match[3] ?? match[6]);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      continue;
    }
    const startIndex = match.index;
    const text = match[0];
    if (startIndex === undefined || !text) continue;
    dates.push({
      text,
      startIndex,
      endIndex: startIndex + text.length,
      timestamp: date.getTime(),
    });
  }
  return dates;
}
