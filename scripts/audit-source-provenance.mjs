import "./local-server-runtime.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
if (!process.argv.includes("--network"))
  throw new Error("必须显式指定--network；仅核对公开组织关系，不写应用数据库。");
const { fetchPublicWebpage } = await import("../src/lib/server/webpage-fetcher.ts");
const batch = JSON.parse(readFileSync("src/domain/official-source-provenance.json", "utf8"));
const pages = new Map();
async function page(url) {
  if (!pages.has(url)) {
    try {
      pages.set(url, await fetchPublicWebpage(url));
    } catch (error) {
      pages.set(url, error);
    }
  }
  return pages.get(url);
}
const results = [];
for (const record of batch.results) {
  const source = await page(record.provenance.referenceUrl),
    parent = await page(record.evidence.parentUrl);
  const success =
    !(source instanceof Error) &&
    !(parent instanceof Error) &&
    source.text.includes(record.provenance.quote) &&
    (record.sourceUrl === record.evidence.parentUrl ||
      parent.links.some(
        (link) => new URL(link.url).hostname === new URL(record.sourceUrl).hostname,
      ));
  results.push({
    sourceUrl: record.sourceUrl,
    success,
    checkedAt: new Date().toISOString(),
    message: success
      ? "网站组织关系原文及教育考试院公开同主机链接均可核对；版权主体、网站主办和主管分别表达，不代表具体考试主办、当期举办或报名开放。"
      : "缺少原文或总入口链接，需复核；不写应用数据库。",
  });
}
mkdirSync("work", { recursive: true });
writeFileSync("work/source-provenance-audit.json", JSON.stringify({ results }, null, 2));
console.log(
  `公开组织关系核对：${results.filter((x) => x.success).length}/${results.length}；不写应用数据库。`,
);
if (results.some((x) => !x.success)) process.exitCode = 1;
