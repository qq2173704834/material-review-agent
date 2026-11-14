import "./local-server-runtime.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
if (!process.argv.includes("--network"))
  throw new Error("需显式指定--network；只读核对第三方页面，不写应用数据库。");
const { fetchPublicWebpage } = await import("../src/lib/server/webpage-fetcher.ts");
const batch = JSON.parse(readFileSync("src/domain/supplemental-knowledge.json", "utf8"));
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
  const success =
    !(page instanceof Error) &&
    record.content.sourceType === "非官方参考" &&
    page.text.includes(record.evidence.quote);
  results.push({
    key: record.key,
    sourceType: "非官方参考",
    url,
    success,
    checkedAt: new Date().toISOString(),
    sourceSha256:
      page instanceof Error ? null : createHash("sha256").update(page.text).digest("hex"),
    message:
      page instanceof Error
        ? page.message
        : "仅核对第三方原文命中；不计官方政策核实或个人资格结论。",
  });
}
mkdirSync("work", { recursive: true });
writeFileSync("work/supplemental-knowledge-audit.json", JSON.stringify({ results }, null, 2));
console.log(
  `非官方参考原文核对：${results.filter((r) => r.success).length}/${results.length}；不写入应用数据库。`,
);
if (results.some((r) => !r.success)) process.exitCode = 1;
