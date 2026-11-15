export function safeBrowseReturn(raw: string | undefined, fallback: string): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    [...raw].some((char) => char.charCodeAt(0) <= 32)
  )
    return fallback;
  try {
    const url = new URL(raw, "https://local.invalid");
    return url.origin === "https://local.invalid" &&
      /^\/(?:exams|learn|campus|me(?:\/(?:preparation|schedule|records|goals\/[a-f0-9-]{36}))?)$/u.test(
        url.pathname,
      )
      ? url.pathname + url.search + url.hash
      : fallback;
  } catch {
    return fallback;
  }
}
