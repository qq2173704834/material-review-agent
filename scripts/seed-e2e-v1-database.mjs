import Database from "better-sqlite3";
import { resolve } from "node:path";

const databaseDirectory = resolve(".local-data", "e2e");
const database = new Database(resolve(databaseDirectory, "reviews.sqlite"));

try {
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE review_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      project_type TEXT,
      project_stage TEXT,
      collaboration_scope TEXT NOT NULL DEFAULT 'unknown'
        CHECK (collaboration_scope IN ('individual', 'team', 'unknown')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE requirement_sources (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
      source_role TEXT NOT NULL CHECK (source_role IN ('notice', 'supplement')),
      input_type TEXT NOT NULL CHECK (input_type IN ('text', 'file', 'webpage')),
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (task_id, id)
    );

    CREATE TABLE requirement_source_versions (
      source_id TEXT NOT NULL REFERENCES requirement_sources (id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0),
      original_text TEXT NOT NULL,
      parse_status TEXT NOT NULL CHECK (parse_status IN ('text_extracted', 'partial', 'failed', 'pending')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, version)
    );

    CREATE TABLE requirement_source_segments (
      source_id TEXT NOT NULL,
      source_version INTEGER NOT NULL,
      paragraph_index INTEGER NOT NULL CHECK (paragraph_index >= 0),
      text TEXT NOT NULL,
      start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
      end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
      PRIMARY KEY (source_id, source_version, paragraph_index),
      FOREIGN KEY (source_id, source_version)
        REFERENCES requirement_source_versions (source_id, version) ON DELETE CASCADE
    );

    CREATE INDEX review_tasks_updated_at_idx ON review_tasks (updated_at DESC);
    CREATE INDEX requirement_sources_task_id_idx ON requirement_sources (task_id, created_at);
    CREATE INDEX requirement_source_versions_latest_idx
      ON requirement_source_versions (source_id, version DESC);
    PRAGMA user_version = 1;
  `);

  const insertTask = database.prepare(`
    INSERT INTO review_tasks (
      id, name, description, project_type, project_stage, collaboration_scope, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = database.prepare(`
    INSERT INTO requirement_sources (id, task_id, source_role, input_type, display_name, created_at)
    VALUES (?, ?, 'notice', 'text', '通知原文', ?)
  `);
  const insertVersion = database.prepare(`
    INSERT INTO requirement_source_versions (source_id, version, original_text, parse_status, created_at)
    VALUES (?, 1, ?, 'text_extracted', ?)
  `);
  const insertSegment = database.prepare(`
    INSERT INTO requirement_source_segments (
      source_id, source_version, paragraph_index, text, start_offset, end_offset
    ) VALUES (?, 1, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  const originalText = "遗留版本通知\n提交一份说明。";
  const saveLegacyTask = database.transaction(() => {
    insertTask.run(
      "00000000-0000-4000-8000-000000000004",
      "E2E 遗留任务 ENG-004",
      "验证从 schema v1 升级时保留数据。",
      "合成项目",
      "历史阶段",
      "team",
      now,
      now,
    );
    insertSource.run(
      "00000000-0000-4000-8000-000000000005",
      "00000000-0000-4000-8000-000000000004",
      now,
    );
    insertVersion.run("00000000-0000-4000-8000-000000000005", originalText, now);
    insertSegment.run("00000000-0000-4000-8000-000000000005", 0, "遗留版本通知", 0, 6);
    insertSegment.run("00000000-0000-4000-8000-000000000005", 1, "提交一份说明。", 7, 14);
  });

  saveLegacyTask();
} finally {
  database.close();
}
