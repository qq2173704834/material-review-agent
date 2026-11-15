import "./local-server-runtime.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const { CAMPUS_SOURCES } = await import("../src/domain/campus-schools.ts");
const sourceIds = [...new Set(process.argv.slice(2))];
if (
  !sourceIds.length ||
  sourceIds.length > 6 ||
  sourceIds.some((id) => !CAMPUS_SOURCES.some((source) => source.id === id))
)
  throw new Error("请指定1—6个已登记的公开通知来源ID；此命令只更新仓库公开快照。");

// Never read the active app database or environment files. Each run uses a new directory.
const researchRoot = resolve(".local-data/campus-snapshots");
mkdirSync(researchRoot, { recursive: true });
process.env.REVIEW_DATA_DIR = mkdtempSync(researchRoot + sep + "run-");
process.env.EXAM_SCHEDULER = "off";
const { collectCampusSource } = await import("../src/lib/server/campus-collector.ts");
const { campusDb, campusNotices } = await import("../src/lib/server/campus-store.ts");
const target = resolve("src/domain/campus-notices.json");
const records = new Map(
  JSON.parse(readFileSync(target, "utf8")).map((notice) => [notice.id, notice]),
);
const results = [];
try {
  for (const id of sourceIds) {
    const source = CAMPUS_SOURCES.find((item) => item.id === id);
    try {
      const count = await collectCampusSource(id);
      const notices = campusNotices(source.schoolId);
      for (const notice of notices) records.set(notice.id, notice);
      results.push({ id, url: source.url, count, storedForSchool: notices.length });
    } catch (error) {
      results.push({
        id,
        url: source.url,
        error: error instanceof Error ? error.message : "公开通知读取失败。",
      });
    }
  }
  if (results.some((result) => result.count > 0))
    writeFileSync(target, JSON.stringify([...records.values()], null, 2) + "\n");
  console.log(
    JSON.stringify({ checkedAt: new Date().toISOString(), results, total: records.size }, null, 2),
  );
  if (results.some((result) => result.error)) process.exitCode = 1;
} finally {
  campusDb().close();
}
