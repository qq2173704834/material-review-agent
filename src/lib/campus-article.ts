import { parse } from "parse5";

interface Node {
  nodeName: string;
  value?: string;
  childNodes?: Node[];
  attrs?: Array<{ name: string; value: string }>;
}
export type CampusArticleProfile = "webplus" | "pku" | "vsb" | "ustc" | "sysu";

function findNode(node: Node, matches: (node: Node) => boolean): Node | undefined {
  if (matches(node)) return node;
  for (const child of node.childNodes || []) {
    const found = findNode(child, matches);
    if (found) return found;
  }
  return undefined;
}
function attribute(node: Node, name: string): string {
  return node.attrs?.find((attr) => attr.name === name)?.value || "";
}
function hasClass(node: Node, value: string): boolean {
  return attribute(node, "class").split(/\s+/u).includes(value);
}
function text(node: Node): string {
  if (["script", "style", "noscript", "nav", "footer", "aside"].includes(node.nodeName)) return "";
  if (node.nodeName === "#text") return node.value || "";
  const content = (node.childNodes || []).map(text).join("");
  if (["td", "th"].includes(node.nodeName)) return `${content} `;
  return ["p", "div", "tr", "li", "br"].includes(node.nodeName) ? `${content}\n` : content;
}
function metaValue(root: Node, name: string): string {
  const node = findNode(
    root,
    (item) =>
      item.nodeName === "meta" && attribute(item, "name").toLowerCase() === name.toLowerCase(),
  );
  return node ? attribute(node, "content") : "";
}
function articleNode(root: Node, profile: CampusArticleProfile): Node | undefined {
  const bodyClass = {
    webplus: "wp_articlecontent",
    pku: "newsinfo_box",
    vsb: "v_news_content",
    ustc: "post",
    sysu: "field-body",
  }[profile];
  // Drupal reuses field-body in banners; restrict the search to the article node.
  const scope =
    profile === "sysu" ? findNode(root, (node) => hasClass(node, "node--type-article")) : root;
  return scope ? findNode(scope, (node) => hasClass(node, bodyClass)) : undefined;
}

/** Only verified article containers are eligible; navigation is never a notice body. */
export function campusArticle(html: string, profile: CampusArticleProfile = "webplus"): string {
  const article = articleNode(parse(html) as Node, profile);
  if (!article) throw new Error("未识别到学校通知正文，等待维护核对。");
  const body = text(article)
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n/gu, "\n")
    .trim();
  if (body.length < 20 || body.length > 80000) throw new Error("通知正文为空或超出限制。");
  return body;
}

function validPublicationDate(value: string): string | undefined {
  const match = /(?:^|\D)(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})(?:日|\D|$)/u.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
    ? date
    : undefined;
}
export function campusPublicationDate(
  html: string,
  url: string,
  profile: CampusArticleProfile = "webplus",
): string {
  const root = parse(html) as Node;
  let declared: string;
  if (profile === "vsb") declared = metaValue(root, "PubDate");
  else if (profile === "pku") {
    const article = articleNode(root, profile);
    // The publication span is a direct child immediately after the article heading.
    const dateNode = article?.childNodes?.find((node) => node.nodeName === "span");
    declared = dateNode ? text(dateNode) : "";
  } else if (profile === "ustc" || profile === "sysu") {
    const dateNode = findNode(root, (node) =>
      hasClass(node, profile === "ustc" ? "meta-date" : "article-date"),
    );
    declared = dateNode ? text(dateNode) : "";
  } else {
    declared =
      /(?:发布时间|发布日期)[：:]\s*(?:<[^>]*>|\s|&nbsp;)*(20\d{2}-\d{2}-\d{2})/u.exec(html)?.[1] ||
      "";
  }
  const date = validPublicationDate(declared);
  if (date) return date;
  // Only the existing WebPlus path format encodes the publication date.
  if (profile === "webplus") {
    const path = /\/(20\d{2})\/(\d{2})(\d{2})\//u.exec(url);
    if (path) {
      const pathDate = validPublicationDate(`${path[1]}-${path[2]}-${path[3]}`);
      if (pathDate) return pathDate;
    }
  }
  throw new Error("无法确认通知发布日期。");
}

export function campusArticleTitle(
  html: string,
  profile: CampusArticleProfile = "webplus",
): string {
  const root = parse(html) as Node;
  const titleClass =
    profile === "webplus" ? "arti_title" : profile === "sysu" ? "article-title" : "single-title";
  const titleNode =
    profile === "pku"
      ? findNode(articleNode(root, profile) || root, (node) => node.nodeName === "h1")
      : findNode(root, (node) => hasClass(node, titleClass));
  const fallback = findNode(root, (node) => node.nodeName === "title");
  const heading =
    titleNode && (findNode(titleNode, (node) => /^h[1-3]$/u.test(node.nodeName)) || titleNode);
  const result = (
    metaValue(root, "ArticleTitle") || (heading ? text(heading) : fallback ? text(fallback) : "")
  )
    .replace(/\s+/gu, " ")
    .trim();
  if (!result || result.length > 250) throw new Error("通知标题需要维护核对。");
  return result;
}
