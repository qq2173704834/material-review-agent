export function safeBrowseReturn(raw: string | undefined, fallback: string): string {
  return raw && /^\/(exams|learn|me(?:\/preparation)?)(\?[^#]*)?$/.test(raw) && !raw.includes("\\")
    ? raw
    : fallback;
}
