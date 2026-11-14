import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import "./local-server-runtime.mjs";
if (!process.argv.includes("--network"))
  throw new Error("实际请求公开官网需显式传入--network；不会启用来源或发布内容。");
const root = resolve(".local-data/source-audit");
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(root + sep + "run-");
process.env.REVIEW_DATA_DIR = directory;
const { sources } = await import("../src/lib/server/exam-store.ts");
const { collectSource } = await import("../src/lib/server/exam-collector.ts");
const { platformDb } = await import("../src/lib/server/platform-db.ts");
const { EXAM_PORTALS } = await import("../src/domain/exam-portals.ts");
const selected = sources().filter(
  (source) =>
    source.region === "全国" &&
    (EXAM_PORTALS.some(
      (portal) => portal.url === source.url && portal.collectionMode === "candidate",
    ) ||
      ["cet4", "ncre", "teacher", "graduate"].includes(source.category)),
);
const results = [];
const output = resolve(directory, "source-audit.json");
for (const source of selected) {
  let outcome;
  try {
    outcome = { success: true, ...(await collectSource(source.id)) };
  } catch (error) {
    outcome = { success: false, message: error instanceof Error ? error.message : "采集失败" };
  }
  const db = platformDb();
  const drafts = db
    .prepare(
      "SELECT n.id,n.canonical_url,v.digest,v.version FROM exam_notices n JOIN exam_notice_versions v ON v.notice_id=n.id WHERE n.source_id=?",
    )
    .all(source.id);
  let repeat = null;
  if (outcome.success) {
    try {
      repeat = await collectSource(source.id);
    } catch (error) {
      repeat = { error: error instanceof Error ? error.message : "复查失败" };
    }
  }
  results.push({
    source: source.url,
    category: source.category,
    checkedAt: new Date().toISOString(),
    outcome,
    drafts,
    repeat,
  });
  writeFileSync(
    output,
    JSON.stringify(
      {
        directory,
        automaticPublication: false,
        enabledSources: sources().filter((item) => item.enabled).length,
        publishedNotices: db
          .prepare("SELECT COUNT(*) count FROM exam_notices WHERE status='published'")
          .get().count,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.length}/${selected.length} ${source.category}: ${outcome.success ? "已形成持久草稿" : "失败或未适配"} ${outcome.message}`,
  );
}
console.log(`逐源证据：${output}`);
