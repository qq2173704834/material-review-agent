import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  realpathSync,
  lstatSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { resolve, dirname, sep, posix } from "node:path";

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const inside = (root, path) => path.startsWith(root + sep);
function safePath(root, key) {
  if (
    typeof key !== "string" ||
    key.includes("\\") ||
    key.includes(":") ||
    key.includes("\0") ||
    posix.isAbsolute(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("备份路径无效。");
  const target = resolve(root, key);
  if (!inside(root, target)) throw new Error("备份路径越界。");
  return target;
}
function regularFile(root, key) {
  const target = safePath(root, key);
  if (
    lstatSync(target).isSymbolicLink() ||
    !lstatSync(target).isFile() ||
    !inside(realpathSync(root), realpathSync(target))
  )
    throw new Error("拒绝链接或越界文件。");
  return target;
}
function checkedDatabase(path) {
  const db = new Database(path, { fileMustExist: true, readonly: true });
  try {
    if (
      db.pragma("integrity_check", { simple: true }) !== "ok" ||
      db.pragma("foreign_key_check").length
    )
      throw new Error("数据库完整性检查失败。");
    return db.pragma("user_version", { simple: true });
  } finally {
    db.close();
  }
}
function materialEntries(db) {
  return db
    .prepare(
      "SELECT DISTINCT storage_key,sha256 FROM review_material_versions ORDER BY storage_key",
    )
    .all();
}
export function createFullBackup(sourceDirectory, destinationDirectory) {
  const started = Date.now(),
    source = realpathSync(resolve(sourceDirectory));
  const destination = resolve(destinationDirectory);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const destinationReal = realpathSync(destination);
  if (
    destinationReal === source ||
    inside(source, destinationReal) ||
    inside(destinationReal, source)
  )
    throw new Error("备份目的地必须独立于数据目录。");
  const id = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const staging = resolve(destinationReal, `.pending-${id}`),
    final = resolve(destinationReal, id);
  mkdirSync(staging, { mode: 0o700 });
  const platform = new Database(regularFile(source, "platform.sqlite"), { fileMustExist: true });
  let reviews;
  try {
    reviews = new Database(regularFile(source, "reviews.sqlite"), { fileMustExist: true });
    platform.pragma("busy_timeout=5000");
    reviews.pragma("busy_timeout=5000");
    // Hold BOTH write reservations until the two snapshots and every referenced immutable original are captured.
    // A concurrent deletion may remove an original before its DB commit: fail the entire snapshot in that case.
    platform.exec("BEGIN IMMEDIATE");
    reviews.exec("BEGIN IMMEDIATE");
    if (
      reviews
        .prepare("SELECT COUNT(*) AS count FROM review_executions WHERE status='running'")
        .get().count
    )
      throw new Error("仍有审查执行中，请等待结束或取消后备份。");
    const entries = [];
    for (const [key, db] of [
      ["platform.sqlite", platform],
      ["reviews.sqlite", reviews],
    ]) {
      const buffer = db.serialize();
      if (buffer.byteLength > 512 * 1024 * 1024)
        throw new Error("数据库超过512MiB离线快照限额，请使用专用备份方案。");
      writeFileSync(safePath(staging, key), buffer, { flag: "wx", mode: 0o600 });
      entries.push({
        path: key,
        sizeBytes: buffer.length,
        sha256: hash(buffer),
        schemaVersion: db.pragma("user_version", { simple: true }),
      });
    }
    const unique = new Map();
    for (const item of materialEntries(reviews)) {
      if (!item.storage_key.startsWith("materials/")) throw new Error("原件目录无效。");
      if (unique.has(item.storage_key) && unique.get(item.storage_key) !== item.sha256)
        throw new Error("同路径原件哈希冲突。");
      unique.set(item.storage_key, item.sha256);
    }
    for (const [key, expectedHash] of unique) {
      const original = regularFile(source, key),
        target = safePath(staging, key);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(original, target);
      chmodSync(target, 0o600);
      const buffer = readFileSync(target);
      if (hash(buffer) !== expectedHash) throw new Error("原件缺失或哈希不符，未发布备份。");
      entries.push({ path: key, sizeBytes: buffer.length, sha256: expectedHash });
    }
    const manifest = {
      format: 1,
      application: "material-review-agent",
      id,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      consistency: "dual-sqlite-write-reservations-and-hashed-referenced-originals",
      entries,
    };
    writeFileSync(resolve(staging, "manifest.json"), JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    reviews.exec("ROLLBACK");
    platform.exec("ROLLBACK");
    verifyFullBackup(staging);
    renameSync(staging, final);
    return { directory: final, fileCount: entries.length, durationMs: Date.now() - started };
  } finally {
    if (reviews?.inTransaction) reviews.exec("ROLLBACK");
    if (platform.inTransaction) platform.exec("ROLLBACK");
    reviews?.close();
    platform.close();
  }
}
export function verifyFullBackup(directory) {
  const root = realpathSync(resolve(directory));
  const manifest = JSON.parse(readFileSync(regularFile(root, "manifest.json"), "utf8"));
  if (
    manifest.format !== 1 ||
    manifest.application !== "material-review-agent" ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > 100000
  )
    throw new Error("备份清单格式无效。");
  const paths = new Set();
  for (const entry of manifest.entries) {
    if (
      paths.has(entry.path) ||
      (!["platform.sqlite", "reviews.sqlite"].includes(entry.path) &&
        !entry.path.startsWith("materials/")) ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error("备份清单项目无效或重复。");
    paths.add(entry.path);
    const buffer = readFileSync(regularFile(root, entry.path));
    if (buffer.length !== entry.sizeBytes || hash(buffer) !== entry.sha256)
      throw new Error("备份文件完整性校验失败。");
  }
  for (const [name, maximum] of [
    ["platform.sqlite", 5],
    ["reviews.sqlite", 22],
  ]) {
    if (!paths.has(name)) throw new Error("缺少数据库。");
    const version = checkedDatabase(resolve(root, name));
    if (
      version < 1 ||
      version > maximum ||
      version !== manifest.entries.find((entry) => entry.path === name).schemaVersion
    )
      throw new Error("数据库版本不兼容。");
  }
  const reviews = new Database(resolve(root, "reviews.sqlite"), {
    fileMustExist: true,
    readonly: true,
  });
  try {
    for (const item of materialEntries(reviews)) {
      const entry = manifest.entries.find((entry) => entry.path === item.storage_key);
      if (!entry || entry.sha256 !== item.sha256) throw new Error("数据库原件引用与备份不一致。");
    }
  } finally {
    reviews.close();
  }
  return manifest;
}
export function restoreFullBackup(backupDirectory, targetDirectory) {
  const started = Date.now(),
    manifest = verifyFullBackup(backupDirectory),
    root = realpathSync(resolve(backupDirectory)),
    target = resolve(targetDirectory);
  if (existsSync(target) || inside(root, target) || inside(target, root))
    throw new Error("恢复只允许独立且不存在的新目录，不能覆盖现用数据。");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  // No secrets, sessions or originals are printed. A failed partial restore is retained for diagnosis, never activated.
  for (const entry of manifest.entries) {
    const file = safePath(target, entry.path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    copyFileSync(regularFile(root, entry.path), file);
    chmodSync(file, 0o600);
  }
  writeFileSync(
    resolve(target, "restore-receipt.json"),
    JSON.stringify({
      backupId: manifest.id,
      restoredAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return {
    directory: target,
    fileCount: manifest.entries.length,
    durationMs: Date.now() - started,
  };
}
