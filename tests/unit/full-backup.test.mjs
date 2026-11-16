import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  createFullBackup,
  verifyFullBackup,
  restoreFullBackup,
} from "../../scripts/lib/full-backup.mjs";
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "material-backup-test-")),
    source = resolve(root, "source"),
    dest = resolve(root, "snapshots");
  mkdirSync(source);
  const platform = new Database(resolve(source, "platform.sqlite"));
  platform.exec(
    "CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('student');CREATE TABLE exam_sources(enabled INTEGER,failures INTEGER);PRAGMA user_version=3;",
  );
  platform.close();
  const reviews = new Database(resolve(source, "reviews.sqlite"));
  reviews.exec(
    "CREATE TABLE review_material_versions(storage_key TEXT,sha256 TEXT);CREATE TABLE review_executions(status TEXT,created_at TEXT,metadata_json TEXT);CREATE TABLE requirement_rule_sets(created_at TEXT,model_calls_json TEXT);PRAGMA user_version=22;",
  );
  mkdirSync(resolve(source, "materials/task"), { recursive: true });
  const original = Buffer.from("合成材料原件");
  writeFileSync(resolve(source, "materials/task/file.txt"), original);
  writeFileSync(resolve(source, ".env.local"), "PRIVATE_SECRET_NOT_FOR_BACKUP");
  reviews
    .prepare("INSERT INTO review_material_versions VALUES(?,?)")
    .run("materials/task/file.txt", createHash("sha256").update(original).digest("hex"));
  reviews.close();
  return { root, source, dest };
}
test("REL02 两库与原件校验、独立恢复且不包含环境文件", () => {
  const f = fixture();
  try {
    const backup = createFullBackup(f.source, f.dest),
      manifest = verifyFullBackup(backup.directory);
    assert.equal(manifest.entries.length, 3);
    assert.equal(
      manifest.entries.some((item) => item.path.includes(".env")),
      false,
    );
    const restored = resolve(f.root, "restored");
    restoreFullBackup(backup.directory, restored);
    assert.equal(
      readFileSync(resolve(restored, "materials/task/file.txt"), "utf8"),
      "合成材料原件",
    );
    const db = new Database(resolve(restored, "platform.sqlite"), { readonly: true });
    assert.equal(db.prepare("SELECT id FROM accounts").get().id, "student");
    db.close();
    assert.throws(() => restoreFullBackup(backup.directory, restored), /新目录/);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
test("REL02 原件损坏拒绝发布快照", () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.source, "materials/task/file.txt"), "tampered");
    assert.throws(() => createFullBackup(f.source, f.dest), /哈希/);
    assert.equal(
      readdirSync(f.dest).some((name) => name.startsWith("snapshot-")),
      false,
    );
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
test("REL02 在途审查不能形成跨执行恢复点", () => {
  const f = fixture();
  try {
    const db = new Database(resolve(f.source, "reviews.sqlite"));
    db.exec("INSERT INTO review_executions(status) VALUES('running')");
    db.close();
    assert.throws(() => createFullBackup(f.source, f.dest), /执行中/);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
test("REL02 篡改备份与路径逃逸拒绝恢复", () => {
  const f = fixture();
  try {
    const backup = createFullBackup(f.source, f.dest),
      manifestPath = resolve(backup.directory, "manifest.json"),
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.entries[0].path = "../private";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyFullBackup(backup.directory), /路径|清单/);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
test("REL02 备份目的地不能位于源目录内", () => {
  const f = fixture();
  try {
    assert.throws(() => createFullBackup(f.source, resolve(f.source, "snapshots")), /独立/);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});

import { inspectOperations } from "../../scripts/lib/operations.mjs";
import { createServer } from "node:http";
import { once } from "node:events";

test("BUG-065 HTTPS部署巡检保留Host且拒绝重定向和过大响应", async () => {
  const f = fixture();
  const previousOrigin = process.env.APP_PUBLIC_ORIGIN;
  const server = createServer((request, response) => {
    if (request.headers.host !== "exams.example.test") {
      response.writeHead(503).end();
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "https://invalid.example/" }).end();
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ status: "ok", padding: request.url === "/large" ? "x".repeat(8192) : "" }),
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.APP_PUBLIC_ORIGIN = "https://exams.example.test";
  const options = { dataDirectory: f.source, backupDirectory: f.dest };
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(
      (await inspectOperations({ ...options, healthUrl: url + "/api/health" })).summary
        .serviceAvailable,
      true,
    );
    for (const path of ["/redirect", "/large"])
      assert.equal(
        (await inspectOperations({ ...options, healthUrl: url + path })).summary.serviceAvailable,
        false,
      );
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previousOrigin;
    await new Promise((done) => server.close(done));
    rmSync(f.root, { recursive: true });
  }
});

test("REL02 巡检实际生成服务/磁盘/备份/模型/采集告警且不输出正文", async () => {
  const f = fixture(),
    server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"ok"}');
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const platform = new Database(resolve(f.source, "platform.sqlite"));
    platform.exec("INSERT INTO exam_sources VALUES(1,3)");
    platform.close();
    const ledgerDirectory = resolve(f.source, "operations");
    mkdirSync(ledgerDirectory);
    const calls = Array.from({ length: 3 }, (_, index) => ({
      type: "model_call",
      operation: "material_review",
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date(Date.now() + index).toISOString(),
      inputTokens: index === 0 ? null : 20,
      outputTokens: 5,
      requestCount: 1,
      privateBody: "SECRET_TEST_BODY",
    }));
    writeFileSync(
      resolve(ledgerDirectory, `model-${new Date().toISOString().slice(0, 10)}.jsonl`),
      calls.map((call) => JSON.stringify(call)).join("\n"),
    );
    const backup = createFullBackup(f.source, f.dest),
      options = {
        dataDirectory: f.source,
        backupDirectory: f.dest,
        healthUrl: `http://127.0.0.1:${server.address().port}`,
        minimumFreeBytes: Number.MAX_SAFE_INTEGER,
        maximumTokens: 10,
      };
    const report = await inspectOperations(options);
    assert.equal(report.summary.serviceAvailable, true);
    assert.equal(report.summary.modelCalls24Hours, 3);
    for (const code of [
      "disk_space_low",
      "collector_repeated_failure",
      "model_repeated_failure",
      "model_token_budget_exceeded",
      "model_usage_incomplete",
    ])
      assert.ok(report.alerts.includes(code));
    assert.equal(JSON.stringify(report).includes("SECRET_TEST_BODY"), false);
    assert.ok(
      (
        await inspectOperations({ ...options, healthUrl: "http://127.0.0.1:1/api/health" })
      ).alerts.includes("service_unavailable"),
    );
    writeFileSync(resolve(backup.directory, "materials/task/file.txt"), "broken");
    assert.ok((await inspectOperations(options)).alerts.includes("backup_integrity_failed"));
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(f.root, { recursive: true });
  }
});
