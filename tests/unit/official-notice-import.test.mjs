import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import "../../scripts/local-server-runtime.mjs";
const { noticeInputSchema, validatePublication } =
  await import("../../src/lib/server/exam-store.ts");
const batch = JSON.parse(
  readFileSync(new URL("../../data/official-notices-2026-11-14.json", import.meta.url), "utf8"),
);
const expansion = JSON.parse(
  readFileSync(
    new URL("../../data/official-notices-expansion-2026-11-14.json", import.meta.url),
    "utf8",
  ),
);
test("官方公告批次有日期引用，缺失的地方报名时段不凭空补全", () => {
  for (const item of [...batch, ...expansion])
    validatePublication(noticeInputSchema.parse(item.content));
  for (const item of expansion.filter((item) => item.content.textScope === "摘录"))
    assert.match(item.content.text, /原文摘录，非全文/);
  const cet = batch.find((item) => item.content.category === "cet4").content;
  assert.equal(
    cet.timeline.some((point) => point.label === "报名截止"),
    false,
  );
  assert.throws(
    () =>
      validatePublication({
        ...cet,
        timeline: [{ label: "笔试", value: "2026-12-12", quote: "原文没有这句话" }],
      }),
    /引用/,
  );
});
test("本地导入预览不写库，正式导入有备份且重复执行保留原版本及撤回状态", () => {
  const directory = mkdtempSync(join(tmpdir(), "exam-official-import-"));
  const run = (apply = false, batchName = "initial") => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/import-official-notices.mjs",
        "--data-dir",
        directory,
        "--batch",
        batchName,
        ...(apply ? ["--apply"] : []),
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  let db;
  try {
    assert.equal(run().count, 6);
    assert.throws(() => new Database(join(directory, "platform.sqlite"), { readonly: true }));
    const first = run(true);
    assert.equal(first.added, 6);
    const backup = new Database(first.backupPath, { readonly: true });
    assert.equal(backup.prepare("SELECT COUNT(*) n FROM exam_notices").get().n, 0);
    backup.close();
    db = new Database(join(directory, "platform.sqlite"));
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM exam_notices WHERE status='published'").get().n,
      6,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_sources WHERE enabled=1").get().n, 0);
    db.prepare(
      "UPDATE exam_notices SET status='withdrawn' WHERE id=(SELECT id FROM exam_notices LIMIT 1)",
    ).run();
    const second = run(true);
    assert.deepEqual([second.added, second.skipped], [0, 6]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_notice_versions").get().n, 6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_publications").get().n, 6);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM exam_notices WHERE status='withdrawn'").get().n,
      1,
    );
    const originalVersions = db
      .prepare("SELECT digest FROM exam_notice_versions ORDER BY digest")
      .all();
    assert.equal(run(true, "expansion").added, 7);
    const duplicateExpansion = run(true, "expansion");
    assert.deepEqual([duplicateExpansion.added, duplicateExpansion.skipped], [0, 7]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_notices").get().n, 13);
    for (const row of originalVersions)
      assert.ok(db.prepare("SELECT 1 FROM exam_notice_versions WHERE digest=?").get(row.digest));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_sources WHERE enabled=1").get().n, 0);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
