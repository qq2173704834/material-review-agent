import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, sep } from "node:path";
import "../../scripts/local-server-runtime.mjs";
const root = resolve(".local-data/collector-clock-tests");
mkdirSync(root, { recursive: true });
process.env.REVIEW_DATA_DIR = mkdtempSync(root + sep + "run-");
const { sources, saveDraft } = await import("../../src/lib/server/exam-store.ts");
const { platformDb } = await import("../../src/lib/server/platform-db.ts");
let { collectorTick } = await import("../../src/lib/server/exam-collector.ts");
const db = platformDb();
const selected = sources().slice(0, 2);
let now = Date.parse("2034-11-14T08:00:00+08:00");
const originalNow = Date.now;
Date.now = () => now;
let calls = 0;
let revision = 1;
const collect = async (id) => {
  calls++;
  const source = selected.find((entry) => entry.id === id);
  const failed = source.id === selected[1].id;
  db.prepare("UPDATE exam_sources SET last_attempt=?,error=?,failures=?,next_run=? WHERE id=?").run(
    new Date(now).toISOString(),
    failed ? "合成详情失败" : null,
    failed ? 1 : 0,
    now + (failed ? 48 : 6) * 3600000,
    id,
  );
  if (failed) throw new Error("合成详情失败");
  const item = saveDraft(
    id,
    new URL("/synthetic/daily.html", source.url).href,
    {
      title: "合成每日公告",
      category: "cet4",
      region: "全国",
      edition: "2034年",
      year: 2034,
      stage: "招考报名",
      organizer: "合成单位",
      publishedAt: "2034-11-14",
      text: `合成每日公告，重复采集不得重复产生版本。修订${revision}`,
      timeline: [],
      attachments: [],
      disposition: "正常",
    },
    "collector",
  );
  if (item.changed)
    db.prepare(
      "UPDATE exam_notice_versions SET created_at=? WHERE notice_id=? AND version=(SELECT MAX(version) FROM exam_notice_versions WHERE notice_id=?)",
    ).run(new Date(now).toISOString(), item.id, item.id);
};
const row = (day) => db.prepare("SELECT * FROM portal_daily_runs WHERE day=?").get(day);
try {
  await collectorTick(collect);
  assert.equal(row("2034-11-14").status, "none");
  for (const source of selected)
    db.prepare("UPDATE exam_sources SET enabled=1 WHERE id=?").run(source.id);
  await collectorTick(collect);
  assert.equal(calls, 2);
  assert.equal(row("2034-11-14").status, "partial");
  assert.match(row("2034-11-14").message, /生成1个新增或变化版本/);
  await collectorTick(collect);
  assert.equal(calls, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM portal_daily_runs").get().n, 1);
  // Restart the scheduler module; durable schedule and daily row remain authoritative.
  ({ collectorTick } = await import("../../src/lib/server/exam-collector.ts?restart=1"));
  await collectorTick(collect);
  assert.equal(calls, 2);
  now = Date.parse("2034-11-15T08:00:00+08:00");
  await collectorTick(collect);
  assert.equal(calls, 3); // Failure backoff must not be bypassed across midnight.
  assert.equal(row("2034-11-15").status, "running");
  assert.match(row("2034-11-15").message, /尚无新增或变化草稿/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_notice_versions").get().n, 1);
  now = Date.parse("2034-11-16T08:00:00+08:00");
  await collectorTick(collect);
  assert.equal(calls, 5);
  assert.equal(row("2034-11-16").status, "partial");
  revision = 2;
  now += 6 * 3600000;
  await collectorTick(collect);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_notice_versions").get().n, 2);
  assert.match(row("2034-11-16").message, /生成1个新增或变化版本/);
  db.prepare("UPDATE exam_notices SET status='withdrawn'").run();
  now += 6 * 3600000;
  await collectorTick(collect);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_notice_versions").get().n, 2);
  assert.equal(db.prepare("SELECT status FROM exam_notices").get().status, "withdrawn");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM exam_notices WHERE published_version IS NOT NULL").get().n,
    0,
  );
  console.log("每日汇总、失败隔离、重启、跨日退避、幂等及不自动发布通过");
} finally {
  Date.now = originalNow;
  db.close();
}
