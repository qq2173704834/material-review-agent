import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import "./local-server-runtime.mjs";
if (!process.argv.includes("--network"))
  throw new Error("核对公开官方引用需显式指定--network；不写入应用数据库。");
const { fetchPublicWebpage, fetchPublicResource } =
  await import("../src/lib/server/webpage-fetcher.ts");
const batch = JSON.parse(readFileSync("src/domain/official-knowledge.json", "utf8"));
const pages = new Map();
const results = [];
for (const record of batch.entries) {
  const url = record.content.url;
  if (!pages.has(url)) {
    try {
      if (/\.pdf$/i.test(new URL(url).pathname)) {
        const { parsePdfMaterial } = await import("../src/lib/server/pdf-parser.ts");
        const resource = await fetchPublicResource(url);
        const parsed = await parsePdfMaterial(Buffer.from(resource.bytes));
        if (parsed.parseStatus !== "text_extracted")
          throw new Error("PDF未完成文字提取，不将未读范围计为核对通过。");
        pages.set(url, {
          text: parsed.extractedText,
          segments: parsed.segments,
          sha256: createHash("sha256").update(resource.bytes).digest("hex"),
        });
      } else pages.set(url, await fetchPublicWebpage(url));
    } catch (error) {
      pages.set(url, error);
    }
  }
  const page = pages.get(url);
  const pdf = /\.pdf$/i.test(new URL(url).pathname);
  const sourcePage = record.evidence.sourcePage;
  const text =
    page instanceof Error
      ? ""
      : pdf
        ? (page.segments.find((segment) => segment.location === `第 ${sourcePage} 页`)?.text ?? "")
        : page.text;
  const success = !(page instanceof Error) && text.includes(record.evidence.quote);
  results.push({
    key: record.key,
    url,
    success,
    checkedAt: new Date().toISOString(),
    ...(pdf ? { sourcePage } : {}),
    message:
      page instanceof Error
        ? page.message
        : success
          ? pdf
            ? "少量引用逐字命中实际读取PDF指定页；不代表完整教材或个人资格结论。"
            : "少量引用逐字命中公开原文；不表示已读取其PDF或全部资料。"
          : "原文未命中，需核对修订。",
    sourceSha256:
      page instanceof Error
        ? null
        : (page.sha256 ?? createHash("sha256").update(page.text).digest("hex")),
  });
}
mkdirSync("work", { recursive: true });
writeFileSync("work/official-knowledge-audit.json", JSON.stringify({ results }, null, 2));
console.log(
  `官方知识引用核对：${results.filter((item) => item.success).length}/${results.length}；不写入应用数据库。`,
);
if (results.some((item) => !item.success)) process.exitCode = 1;
