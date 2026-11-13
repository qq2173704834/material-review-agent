import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface PlatformContext {
  directory: string;
  database: Database.Database;
}
const state = globalThis as typeof globalThis & { __examPlatform?: PlatformContext };
export function platformDirectory(): string {
  return resolve(process.cwd(), process.env.REVIEW_DATA_DIR || ".local-data");
}
export function platformDb(): Database.Database {
  const directory = platformDirectory();
  if (state.__examPlatform) {
    const existing = state.__examPlatform;
    if (
      existing.directory === directory &&
      Number(existing.database.pragma("user_version", { simple: true })) === 3
    )
      return existing.database;
    existing.database.close();
    delete state.__examPlatform;
  }
  mkdirSync(directory, { recursive: true });
  const db = new Database(resolve(directory, "platform.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (Number(db.pragma("user_version", { simple: true })) > 3) {
    db.close();
    throw new Error("平台数据库版本高于当前程序，请使用对应程序版本。");
  }
  db.transaction(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS recovery_codes (
      digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exam_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT UNIQUE NOT NULL, category TEXT NOT NULL, region TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, interval_hours INTEGER NOT NULL DEFAULT 6,
      last_success TEXT, last_attempt TEXT, next_run INTEGER NOT NULL DEFAULT 0, error TEXT,
      locked_until INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS exam_notices (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES exam_sources(id), canonical_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', published_version INTEGER, created_at TEXT NOT NULL,
      UNIQUE(source_id,canonical_url)
    );
    CREATE TABLE IF NOT EXISTS exam_notice_versions (
      notice_id TEXT NOT NULL REFERENCES exam_notices(id), version INTEGER NOT NULL, payload TEXT NOT NULL,
      digest TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(notice_id,version)
    );
    CREATE TABLE IF NOT EXISTS exam_fetch_runs (
      id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES exam_sources(id), started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exam_favorites (
      user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, notice_id TEXT NOT NULL REFERENCES exam_notices(id),
      seen_version INTEGER NOT NULL DEFAULT 0, seen_status TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id,notice_id)
    );
    CREATE TABLE IF NOT EXISTS exam_task_links (
      user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, notice_id TEXT NOT NULL REFERENCES exam_notices(id),
      task_id TEXT NOT NULL UNIQUE, notice_version INTEGER NOT NULL, stage TEXT NOT NULL, target TEXT NOT NULL,
      PRIMARY KEY(user_id,notice_id,stage,target)
    );
    CREATE TABLE IF NOT EXISTS exam_publications (
      id INTEGER PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES exam_notices(id), version INTEGER NOT NULL,
      action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO exam_publications(notice_id,version,action,actor,created_at)
      SELECT n.id,n.published_version,'publish','schema-upgrade',n.created_at FROM exam_notices n
      WHERE n.published_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exam_publications p WHERE p.notice_id=n.id);
    PRAGMA user_version = 3;
  `),
  )();
  state.__examPlatform = { directory, database: db };
  return db;
}
export function consumeRate(key: string, maximum: number, intervalMs = 60_000): boolean {
  const db = platformDb();
  const now = Date.now();
  return db.transaction(() => {
    db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);
    const row = db
      .prepare<[string], { count: number }>("SELECT count FROM rate_limits WHERE key = ?")
      .get(key);
    if ((row?.count ?? 0) >= maximum) return false;
    db.prepare(
      "INSERT INTO rate_limits(key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, now + intervalMs);
    return true;
  })();
}
export function securityEvent(userId: string | null, action: string): void {
  platformDb()
    .prepare("INSERT INTO security_events(user_id,action,created_at) VALUES (?,?,?)")
    .run(userId, action, new Date().toISOString());
}
