import { parse } from "parse5";

interface Node {
  nodeName: string;
  value?: string;
  childNodes?: Node[];
  attrs?: Array<{ name: string; value: string }>;
}
/** Only an explicit school article container is eligible; navigation is never a notice body. */
export function campusArticle(html: string): string {
  const root = parse(html) as Node;
  function find(node: Node): Node | undefined {
    if (
      node.attrs?.some(
        (attr) => attr.name === "class" && attr.value.split(/\s+/u).includes("wp_articlecontent"),
      )
    )
      return node;
    for (const child of node.childNodes || []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  }
  function text(node: Node): string {
    if (["script", "style", "noscript"].includes(node.nodeName)) return "";
    if (node.nodeName === "#text") return node.value || "";
    const content = (node.childNodes || []).map(text).join("");
    return ["p", "div", "tr", "li", "br"].includes(node.nodeName) ? `${content}\n` : content;
  }
  const article = find(root);
  if (!article) throw new Error("未识别到学校通知正文，等待维护核对。");
  const body = text(article)
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n/gu, "\n")
    .trim();
  if (body.length < 20 || body.length > 80000) throw new Error("通知正文为空或超出限制。");
  return body;
}

export function campusPublicationDate(html: string, url: string): string {
  const label = /(?:发布时间|发布日期)[：:]\s*(?:<[^>]*>|\s|&nbsp;)*(20\d{2}-\d{2}-\d{2})/u.exec(
    html,
  )?.[1];
  if (label) return label;
  const path = /\/(20\d{2})\/(\d{2})(\d{2})\//u.exec(url);
  if (path) return `${path[1]}-${path[2]}-${path[3]}`;
  throw new Error("无法确认通知发布日期。");
}

export function campusArticleTitle(html: string): string {
  const root = parse(html) as Node;
  function title(node: Node): string {
    if (node.nodeName === "title")
      return (node.childNodes || [])
        .map((child) => child.value || "")
        .join("")
        .trim();
    for (const child of node.childNodes || []) {
      const found = title(child);
      if (found) return found;
    }
    return "";
  }
  const result = title(root);
  if (!result || result.length > 250) throw new Error("通知标题需要维护核对。");
  return result;
}
