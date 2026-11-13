import { verifyFullBackup } from "./full-backup.mjs";
import Database from "better-sqlite3";
import { statfsSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
export async function inspectOperations({
  dataDirectory,
  healthUrl,
  backupDirectory,
  minimumFreeBytes = 1024 ** 3,
  maximumBackupAgeHours = 30,
  maximumTokens = 1000000,
}) {
  const directory = resolve(dataDirectory),
    alerts = [],
    summary = { checkedAt: new Date().toISOString() };
  const disk = statfsSync(directory, { bigint: true });
  summary.freeBytes = Number(disk.bavail * disk.bsize);
  if (summary.freeBytes < minimumFreeBytes) alerts.push("disk_space_low");
  try {
    const url = new URL(healthUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("invalid_health_url");
    const configuredOrigin = process.env.APP_PUBLIC_ORIGIN
      ? new URL(process.env.APP_PUBLIC_ORIGIN)
      : undefined;
    if (configuredOrigin && configuredOrigin.protocol !== "https:")
      throw new Error("invalid_public_origin");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
      headers: configuredOrigin ? { host: configuredOrigin.host } : undefined,
    });
    summary.serviceAvailable = response.ok && (await response.json()).status === "ok";
  } catch {
    summary.serviceAvailable = false;
  }
  if (!summary.serviceAvailable) alerts.push("service_unavailable");
  const now = Date.now(),
    cutoff = new Date(now - 24 * 3600000).toISOString();
  if (backupDirectory && existsSync(backupDirectory)) {
    const manifests = readdirSync(backupDirectory, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^snapshot-/.test(entry.name),
      )
      .flatMap((entry) => {
        try {
          const record = JSON.parse(
            readFileSync(resolve(backupDirectory, entry.name, "manifest.json"), "utf8"),
          );
          return record.format === 1 && Number.isFinite(Date.parse(record.createdAt))
            ? [{ ...record, directory: resolve(backupDirectory, entry.name) }]
            : [];
        } catch {
          return [];
        }
      });
    const latest = manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest) {
      try {
        verifyFullBackup(latest.directory);
      } catch {
        alerts.push("backup_integrity_failed");
      }
    }
    summary.backupAgeHours = latest
      ? Math.max(0, (now - Date.parse(latest.createdAt)) / 3600000)
      : null;
  } else summary.backupAgeHours = null;
  if (summary.backupAgeHours === null || summary.backupAgeHours > maximumBackupAgeHours)
    alerts.push("backup_missing_or_stale");
  const platform = new Database(resolve(directory, "platform.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const reviews = new Database(resolve(directory, "reviews.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    summary.collectorsFailing = platform
      .prepare("SELECT COUNT(*) AS count FROM exam_sources WHERE enabled=1 AND failures>=3")
      .get().count;
    if (summary.collectorsFailing) alerts.push("collector_repeated_failure");
    let calls = [
      ...reviews
        .prepare(
          "SELECT model_calls_json AS payload FROM requirement_rule_sets WHERE created_at>=?",
        )
        .all(cutoff)
        .flatMap((row) => JSON.parse(row.payload)),
      ...reviews
        .prepare("SELECT metadata_json AS payload FROM review_executions WHERE created_at>=?")
        .all(cutoff)
        .flatMap((row) => JSON.parse(row.payload).modelCalls ?? []),
    ];
    const ledgerDirectory = resolve(directory, "operations");
    const ledgers = existsSync(ledgerDirectory)
      ? readdirSync(ledgerDirectory, { withFileTypes: true }).filter(
          (entry) =>
            entry.isFile() &&
            !entry.isSymbolicLink() &&
            /^model-\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name) &&
            entry.name.slice(6, 16) >= cutoff.slice(0, 10),
        )
      : [];
    if (ledgers.length) {
      const recorded = [];
      for (const ledger of ledgers) {
        const path = resolve(ledgerDirectory, ledger.name);
        if (statSync(path).size > 20 * 1024 ** 2) {
          alerts.push("model_telemetry_over_limit");
          continue;
        }
        for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
          try {
            const event = JSON.parse(line);
            if (event.type === "model_call" && event.startedAt >= cutoff) recorded.push(event);
          } catch {
            alerts.push("model_telemetry_invalid");
          }
        }
      }
      calls = [
        ...new Map(
          [...calls, ...recorded].map((call) => [
            JSON.stringify([call.operation, call.startedAt, call.completedAt]),
            call,
          ]),
        ).values(),
      ];
      summary.modelUsageSource = "local_operation_ledger_and_historical_snapshots";
    } else summary.modelUsageSource = "execution_snapshots_only";
    summary.modelCalls24Hours = calls.length;
    summary.modelFailures24Hours = calls.filter((call) => call.status === "failed").length;
    summary.modelTokens24Hours = calls.reduce(
      (sum, call) => sum + (call.inputTokens ?? 0) + (call.outputTokens ?? 0),
      0,
    );
    summary.modelUsageUnknown24Hours = calls.filter(
      (call) => call.inputTokens === null || call.outputTokens === null,
    ).length;
    if (summary.modelFailures24Hours >= 3) alerts.push("model_repeated_failure");
    if (summary.modelTokens24Hours > maximumTokens) alerts.push("model_token_budget_exceeded");
    if (summary.modelUsageUnknown24Hours) alerts.push("model_usage_incomplete");
  } finally {
    platform.close();
    reviews.close();
  }
  return { summary, alerts };
}
