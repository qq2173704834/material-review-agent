export function filterDependencies(name: string): string[] {
  if (name === "category") return ["level", "subject", "language", "examForm"];
  if (name === "goal") return ["subject", "stage"];
  return [];
}

export function normalizeSearchFilters(
  input: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, raw] of Object.entries(input)) {
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) continue;
    if (["saved", "hidden"].includes(key) && value !== "1") continue;
    if (key === "page") {
      if (/^[1-9]\d{0,6}$/.test(value)) result[key] = value;
    } else result[key] = value.slice(0, 120);
  }
  return result;
}
