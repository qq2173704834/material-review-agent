function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Render only the Markdown constructs emitted by our report generator; never trust embedded HTML. */
export function reportHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  const readable = (value: string): string =>
    escapeHtml(
      value
        .replace(/\\([\\`*_{}[\]()#+!|])/g, "$1")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (index < lines.length && lines[index]?.startsWith("|")) {
        const row = lines[index++] ?? "";
        if (/^\|[\s:|-]+$/.test(row)) continue;
        const cell = rows.length ? "td" : "th";
        rows.push(
          "<tr>" +
            row
              .slice(1, -1)
              .split("|")
              .map((part) => `<${cell}>${readable(part.trim())}</${cell}>`)
              .join("") +
            "</tr>",
        );
      }
      index--;
      blocks.push("<table>" + rows.join("") + "</table>");
    } else {
      const heading = line.match(/^(#{1,3}) (.*)$/);
      blocks.push(
        heading
          ? `<h${heading[1]!.length}>${readable(heading[2] ?? "")}</h${heading[1]!.length}>`
          : `<p>${readable(line.replace(/^- /, "• "))}</p>`,
      );
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>材料预审报告 · 打印预览</title><style>
  @page { size: A4; margin: 18mm 16mm 20mm; @bottom-center { content: "第 " counter(page) " 页"; font-size: 9pt; } }
  *{box-sizing:border-box}body{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#111;background:#fff;line-height:1.75;margin:0}main{max-width:190mm;margin:24px auto;padding:16px}h1{font-size:20pt}h2{font-size:15pt;border-bottom:1px solid #888;margin-top:24px}h3{font-size:12pt;margin-top:20px}h1,h2,h3{break-after:avoid}p{margin:6px 0;font-size:10pt;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{border:1px solid #999;padding:6px 10px;text-align:left;overflow-wrap:anywhere}tr{break-inside:avoid}.toolbar{padding:16px;background:#eee;font-size:14px}.toolbar button{min-height:44px;padding:8px 16px;cursor:pointer}@media print{.toolbar{display:none}main{padding:0;margin:0;max-width:none}a{color:inherit;text-decoration:none}}
  </style></head><body><div class="toolbar"><button id="print-report" type="button">打印 / 另存为 PDF</button> 在打印窗口选择“另存为 PDF”，纸张选择 A4。若导出失败，可关闭本页并重试或下载 Markdown。</div><main>${blocks.join("\n")}</main><script>document.getElementById('print-report').addEventListener('click',()=>window.print());</script></body></html>`;
}
