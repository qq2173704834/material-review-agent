import { parse } from "parse5";

interface ListingNode {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ListingNode[];
}
export interface CampusExternalEntry {
  url: string;
  title: string;
  publishedAt: string;
}
function attr(node: ListingNode, key: string): string {
  return node.attrs?.find((item) => item.name === key)?.value || "";
}
function hasClass(node: ListingNode, name: string): boolean {
  return attr(node, "class").split(/\s+/u).includes(name);
}
function find(node: ListingNode, match: (node: ListingNode) => boolean): ListingNode | undefined {
  if (match(node)) return node;
  for (const child of node.childNodes || []) {
    const result = find(child, match);
    if (result) return result;
  }
  return undefined;
}
function label(node: ListingNode): string {
  if (["script", "style", "noscript"].includes(node.nodeName)) return "";
  return node.nodeName === "#text" ? node.value || "" : (node.childNodes || []).map(label).join("");
}

/** Index only explicit official listing rows. No external body is fetched or inferred. */
export function campusExternalEntries(html: string, listingUrl: string): CampusExternalEntry[] {
  const listing = new URL(listingUrl);
  const sysu =
    listing.origin === "https://jwb.sysu.edu.cn" && listing.pathname === "/newscenter/notice";
  const webplus =
    listing.origin === "https://xsc.sspu.edu.cn" && listing.pathname === "/490/list.htm";
  if (!sysu && !webplus) throw new Error("外链目录仅接受已核验的学校通知列表。");
  const entries = new Map<string, CampusExternalEntry>();
  function visit(node: ListingNode): void {
    if (
      (sysu && hasClass(node, "newslist")) ||
      (webplus && node.nodeName === "li" && hasClass(node, "news"))
    ) {
      const titleNode = find(node, (item) => hasClass(item, sysu ? "title" : "news_title"));
      const anchor = titleNode && find(titleNode, (item) => item.nodeName === "a");
      const dateNode = find(node, (item) =>
        sysu ? item.nodeName === "time" && !!attr(item, "datetime") : hasClass(item, "news_meta"),
      );
      const publishedAt = dateNode
        ? sysu
          ? attr(dateNode, "datetime").slice(0, 10)
          : label(dateNode).trim()
        : "";
      const title = anchor ? label(anchor).replace(/\s+/gu, " ").trim() : "";
      if (
        !anchor ||
        title.length < 2 ||
        title.length > 250 ||
        !/^20\d{2}-\d{2}-\d{2}$/u.test(publishedAt) ||
        !Number.isFinite(Date.parse(publishedAt)) ||
        new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt
      )
        return;
      try {
        const url = new URL(attr(anchor, "href"), listing);
        if (
          url.origin !== "https://mp.weixin.qq.com" ||
          url.username ||
          url.password ||
          url.search ||
          !/^\/s\/[a-zA-Z0-9_-]{10,100}$/u.test(url.pathname)
        )
          return;
        url.hash = "";
        entries.set(url.href, { url: url.href, title, publishedAt });
      } catch {
        /* Malformed entries are excluded independently. */
      }
      return;
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html) as ListingNode);
  return [...entries.values()].slice(0, 20);
}
