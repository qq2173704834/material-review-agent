export function safeNext(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    /[\\%]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) <= 32) ||
    value.startsWith("//")
  )
    return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
