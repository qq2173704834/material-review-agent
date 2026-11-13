import {
  mkdirSync,
  appendFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createFullBackup, verifyFullBackup } from "./lib/full-backup.mjs";
import { inspectOperations } from "./lib/operations.mjs";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const integer = (name, fallback, minimum, maximum) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`参数${name}无效。`);
  return value;
};
const dataDirectory = resolve(option("data-dir", ".local-data")),
  backupDirectory = option("backup-dir");
const intervalMinutes = integer("interval-minutes", 5, 1, 1440),
  backupMinutes = integer("backup-every-minutes", 1440, 5, 43200),
  retainDays = integer("retain-days", 14, 1, 3650);
const logDirectory = resolve(dataDirectory, "operations");
mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
let lastBackup = 0;
function prune() {
  const root = realpathSync(resolve(backupDirectory));
  const snapshots = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^snapshot-\d{4}-[0-9TZ-]+-[0-9a-f-]{8}$/.test(entry.name),
    )
    .map((entry) => resolve(root, entry.name))
    .sort()
    .reverse();
  for (const path of snapshots.slice(2)) {
    if (
      !path.startsWith(root + sep) ||
      lstatSync(path).isSymbolicLink() ||
      !realpathSync(path).startsWith(root + sep)
    )
      throw new Error("拒绝清理越界路径。");
    const manifest = verifyFullBackup(path);
    if (Date.now() - Date.parse(manifest.createdAt) > retainDays * 86400000)
      rmSync(path, { recursive: true });
  }
}
async function tick() {
  const events = [];
  if (args.includes("--with-backup") && Date.now() - lastBackup >= backupMinutes * 60000) {
    if (!backupDirectory) throw new Error("自动备份必须指定独立--backup-dir。");
    try {
      const result = createFullBackup(dataDirectory, backupDirectory);
      lastBackup = Date.now();
      events.push({
        type: "backup_completed",
        fileCount: result.fileCount,
        durationMs: result.durationMs,
      });
      prune();
    } catch {
      events.push({ type: "backup_failed" });
    }
  }
  let record;
  try {
    record = await inspectOperations({
      dataDirectory,
      healthUrl: option("health-url", "http://127.0.0.1:3000/api/health"),
      backupDirectory,
      minimumFreeBytes: integer("minimum-free-mib", 1024, 1, 1000000) * 1024 ** 2,
      maximumBackupAgeHours: integer("backup-age-hours", 30, 1, 100000),
      maximumTokens: integer("token-budget", 1000000, 1, 1000000000),
    });
  } catch {
    record = {
      summary: { checkedAt: new Date().toISOString() },
      alerts: ["operations_inspection_failed"],
    };
  }
  if (events.some((event) => event.type === "backup_failed")) record.alerts.push("backup_failed");
  record.events = events;
  // Daily restricted local alert channel. No URLs, identities, exception bodies, keys or material text.
  const line = JSON.stringify(record);
  appendFileSync(
    resolve(logDirectory, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    line + "\n",
    { mode: 0o600 },
  );
  console.log(line);
  return record.alerts.length;
}
if (!existsSync(dataDirectory)) throw new Error("数据目录不存在。");
if (args.includes("--watch")) {
  do {
    await tick();
    await delay(intervalMinutes * 60000);
  } while (args.includes("--watch"));
} else process.exitCode = (await tick()) ? 2 : 0;
