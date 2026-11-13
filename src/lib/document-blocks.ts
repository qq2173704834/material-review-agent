import { parseFragment } from "parse5";

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  attrs?: Array<{ name: string; value: string }>;
}

/** Preserve logical rows and cell coordinates; converted HTML has no reliable page geometry. */
export function documentBlocks(html: string): Array<{ text: string; location: string }> {
  const blocks: Array<{ text: string; location: string }> = [];
  let paragraph = 0;
  let table = 0;
  const textOf = (node: HtmlNode): string =>
    node.nodeName === "#text"
      ? (node.value ?? "")
      : (node.childNodes ?? []).map(textOf).join(node.tagName === "br" ? "\n" : "");
  const rowsOf = (node: HtmlNode): HtmlNode[] =>
    node.tagName === "tr" ? [node] : (node.childNodes ?? []).flatMap(rowsOf);
  const walk = (node: HtmlNode): void => {
    if (node.tagName === "table") {
      table++;
      rowsOf(node).forEach((row, index) => {
        const cells = (row.childNodes ?? []).filter(
          (cell) => cell.tagName === "td" || cell.tagName === "th",
        );
        const merged = cells.some((cell) =>
          cell.attrs?.some(
            (attr) => ["colspan", "rowspan"].includes(attr.name) && attr.value !== "1",
          ),
        );
        blocks.push({
          text: cells.map((cell) => textOf(cell).trim().replace(/\s+/g, " ")).join(" | "),
          location: `表格 ${table} 第 ${index + 1} 行（列1-${cells.length}${merged ? "；含合并单元格，仅逻辑顺序" : ""}）`,
        });
      });
      return;
    }
    if (/^(p|h[1-6]|li)$/.test(node.tagName ?? "")) {
      paragraph++;
      blocks.push({ text: textOf(node).trim(), location: `段落 ${paragraph}` });
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parseFragment(html));
  return blocks;
}
