import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import "./local-server-runtime.mjs";
if (!process.argv.includes("--network"))
  throw new Error("核对公开官方引用需显式指定--network；不写入应用数据库。");
const { fetchPublicWebpage } = await import("../src/lib/server/webpage-fetcher.ts");
const batch = JSON.parse(readFileSync("src/domain/official-knowledge.json", "utf8"));
const pages = new Map();
const results = [];
for (const record of batch.entries) {
  const url = record.content.url;
  if (!pages.has(url)) {
    try {
      pages.set(url, await fetchPublicWebpage(url));
    } catch (error) {
      pages.set(url, error);
    }
  }
  const page = pages.get(url);
  const success = !(page instanceof Error) && page.text.includes(record.evidence.quote);
  results.push({
    key: record.key,
    url,
    success,
    checkedAt: new Date().toISOString(),
    message:
      page instanceof Error
        ? page.message
        : success
          ? "少量引用逐字命中公开原文；不表示已读取其PDF或全部资料。"
          : "原文未命中，需核对修订。",
    sourceSha256:
      page instanceof Error ? null : createHash("sha256").update(page.text).digest("hex"),
  });
}
mkdirSync("work", { recursive: true });
writeFileSync("work/official-knowledge-audit.json", JSON.stringify({ results }, null, 2));
console.log(
  `官方知识引用核对：${results.filter((item) => item.success).length}/${results.length}；不写入应用数据库。`,
);
if (results.some((item) => !item.success)) process.exitCode = 1;
