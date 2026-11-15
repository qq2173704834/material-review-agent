import type { CampusSource } from "../domain/campus-schools";

/** Match only registered same-origin article routes, including PHP article query IDs. */
export function campusSourceLinks(
  links: readonly { url: string; name: string }[],
  source: CampusSource,
): string[] {
  const origin = new URL(source.url).origin;
  const pathPattern = new RegExp(source.pattern, "u");
  const titlePattern = source.linkTextPattern ? new RegExp(source.linkTextPattern, "u") : undefined;
  const matches = links.flatMap((link) => {
    try {
      const target = new URL(link.url);
      if (
        target.origin !== origin ||
        target.username ||
        target.password ||
        !pathPattern.test(target.pathname + target.search) ||
        (titlePattern && !titlePattern.test(link.name))
      )
        return [];
      target.hash = "";
      return [target.href];
    } catch {
      return [];
    }
  });
  return [...new Set(matches)].slice(0, 10);
}
