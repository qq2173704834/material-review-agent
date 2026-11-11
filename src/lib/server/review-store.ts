import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

import type {
  RequirementSourceSegment,
  RequirementSourceVersion,
  ReviewTaskBackground,
  ReviewTaskDetails,
  ReviewTaskSummary,
} from "@/domain/review";
import { reviewRuleSetSchema } from "@/domain/review-rule";

import type { ReviewRuleSet } from "@/domain/review-rule";

const MAXIMUM_TASK_COUNT = 100;
const DATABASE_SCHEMA_VERSION = 2;

interface ReviewDatabaseContext {
  databaseDirectory: string;
  database: Database.Database;
}

type ReviewDatabaseGlobal = typeof globalThis & {
  __materialReviewDatabase?: ReviewDatabaseContext;
};

interface CreateReviewTaskInput {
  name: string;
  description: string;
  background: ReviewTaskBackground;
  noticeText: string;
}

interface UpdateReviewTaskInput extends CreateReviewTaskInput {
  taskId: string;
}

interface DatabaseTaskSummaryRow {
  id: string;
  name: string;
  description: string;
  project_type: string | null;
  project_stage: string | null;
  collaboration_scope: string;
  source_count: number;
  notice_source_version: number | null;
  notice_preview: string | null;
  latest_updated_at: string;
}

interface DatabaseTaskDetailsRow extends DatabaseTaskSummaryRow {
  created_at: string;
  source_id: string;
  source_version: number;
  source_input_type: string;
  source_display_name: string;
  source_text: string;
  source_parse_status: string;
  source_created_at: string;
}

interface DatabaseSourceSegmentRow {
  paragraph_index: number;
  text: string;
  start_offset: number;
  end_offset: number;
}

interface DatabaseSourceVersionRow {
  version: number;
  original_text: string;
  parse_status: string;
  created_at: string;
}

interface DatabaseRuleSetRow {
  id: string;
  task_id: string;
  source_id: string;
  source_version: number;
  mode: string;
  provider: string;
  model: string;
  status: string;
  warnings_json: string;
  created_at: string;
}

interface DatabaseRuleRow {
  id: string;
  code: string;
  description: string;
  target: string;
  strength: string;
  applicability_scope: string;
  applicability_condition: string;
  parameters_json: string;
  checkability: string;
  generation_method: string;
  uncertainty: string;
  source_id: string;
  source_version: number;
  paragraph_index: number;
  quoted_text: string;
  start_offset: number;
  end_offset: number;
}

function readProjectBackground(row: DatabaseTaskSummaryRow): ReviewTaskBackground {
  if (
    row.collaboration_scope !== "individual" &&
    row.collaboration_scope !== "team" &&
    row.collaboration_scope !== "unknown"
  ) {
    throw new Error("Saved task has an invalid collaboration scope");
  }

  return {
    projectType: row.project_type ?? "",
    projectStage: row.project_stage ?? "",
    collaborationScope: row.collaboration_scope,
  };
}

function readSourceSegments(
  database: Database.Database,
  sourceId: string,
  version: number,
): RequirementSourceSegment[] {
  const rows = database
    .prepare<[string, number], DatabaseSourceSegmentRow>(
      `
      SELECT paragraph_index, text, start_offset, end_offset
      FROM requirement_source_segments
      WHERE source_id = ? AND source_version = ?
      ORDER BY paragraph_index ASC
    `,
    )
    .all(sourceId, version);

  return rows.map((row) => ({
    paragraphIndex: row.paragraph_index,
    text: row.text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
  }));
}

function saveSourceVersion(
  database: Database.Database,
  sourceId: string,
  version: number,
  originalText: string,
  createdAt: string,
): RequirementSourceSegment[] {
  database
    .prepare(
      `
      INSERT INTO requirement_source_versions (
        source_id,
        version,
        original_text,
        parse_status,
        created_at
      ) VALUES (?, ?, ?, 'text_extracted', ?)
    `,
    )
    .run(sourceId, version, originalText, createdAt);

  const insertSegment = database.prepare(`
    INSERT INTO requirement_source_segments (
      source_id,
      source_version,
      paragraph_index,
      text,
      start_offset,
      end_offset
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const segments: RequirementSourceSegment[] = [];
  let paragraphIndex = 0;

  for (const match of originalText.matchAll(/[^\r\n]+/g)) {
    const text = match[0];
    const startOffset = match.index;
    const endOffset = startOffset + text.length;

    if (text.trim().length === 0) {
      continue;
    }

    insertSegment.run(sourceId, version, paragraphIndex, text, startOffset, endOffset);
    segments.push({ paragraphIndex, text, startOffset, endOffset });
    paragraphIndex += 1;
  }

  return segments;
}

function createReviewDatabase(databaseDirectory: string): Database.Database {
  mkdirSync(databaseDirectory, { recursive: true });
  const database = new Database(resolve(databaseDirectory, "reviews.sqlite"));
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");

    const schemaVersionRow = database.pragma("user_version", { simple: true });
    if (typeof schemaVersionRow !== "number" || schemaVersionRow > DATABASE_SCHEMA_VERSION) {
      throw new Error("The local review database uses a newer unsupported schema");
    }

    if (schemaVersionRow === 0) {
      const migrateToVersionOne = database.transaction(() => {
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
        parse_status TEXT NOT NULL
          CHECK (parse_status IN ('text_extracted', 'partial', 'failed', 'pending')),
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
      });

      migrateToVersionOne();
    }

    const migratedSchemaVersion = database.pragma("user_version", { simple: true });
    if (migratedSchemaVersion === 1) {
      const migrateToVersionTwo = database.transaction(() => {
        database.exec(`
          CREATE TABLE requirement_rule_sets (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            source_version INTEGER NOT NULL CHECK (source_version > 0),
            mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
            provider TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
            warnings_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (source_id, source_version)
              REFERENCES requirement_source_versions (source_id, version)
          );

          CREATE TABLE requirement_rules (
            id TEXT PRIMARY KEY NOT NULL,
            rule_set_id TEXT NOT NULL REFERENCES requirement_rule_sets (id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            code TEXT NOT NULL,
            description TEXT NOT NULL,
            target TEXT NOT NULL,
            strength TEXT NOT NULL CHECK (strength IN ('required', 'recommended', 'optional', 'unknown')),
            applicability_scope TEXT NOT NULL CHECK (applicability_scope IN ('individual', 'team', 'unknown')),
            applicability_condition TEXT NOT NULL DEFAULT '',
            parameters_json TEXT NOT NULL DEFAULT '[]',
            checkability TEXT NOT NULL CHECK (checkability IN ('deterministic', 'assisted', 'unable_to_check')),
            generation_method TEXT NOT NULL CHECK (generation_method IN ('mock', 'live', 'manual')),
            uncertainty TEXT NOT NULL DEFAULT '',
            source_id TEXT NOT NULL,
            source_version INTEGER NOT NULL CHECK (source_version > 0),
            paragraph_index INTEGER NOT NULL CHECK (paragraph_index >= 0),
            quoted_text TEXT NOT NULL,
            start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
            end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
            UNIQUE (rule_set_id, ordinal),
            FOREIGN KEY (source_id, source_version)
              REFERENCES requirement_source_versions (source_id, version)
          );

          CREATE INDEX requirement_rule_sets_task_idx
            ON requirement_rule_sets (task_id, created_at DESC);
          CREATE INDEX requirement_rules_rule_set_idx
            ON requirement_rules (rule_set_id, ordinal ASC);

          PRAGMA user_version = 2;
        `);
      });

      migrateToVersionTwo();
    }

    const finalSchemaVersion = database.pragma("user_version", { simple: true });
    if (finalSchemaVersion !== DATABASE_SCHEMA_VERSION) {
      throw new Error("The local review database migration did not complete");
    }
    return database;
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}

export function createReviewStore(databaseDirectory: string): ReviewStore {
  const normalizedDirectory = resolve(databaseDirectory);
  const database = createReviewDatabase(normalizedDirectory);
  return new ReviewStore(database);
}

class ReviewStore {
  constructor(private readonly database: Database.Database) {}

  createTask(input: CreateReviewTaskInput): ReviewTaskDetails {
    const taskId = randomUUID();
    const sourceId = randomUUID();
    const createdAt = new Date().toISOString();
    const name = input.name.trim() || suggestTaskName(input.noticeText);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO review_tasks (
            id, name, description, project_type, project_stage, collaboration_scope, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          taskId,
          name,
          input.description,
          input.background.projectType || null,
          input.background.projectStage || null,
          input.background.collaborationScope,
          createdAt,
          createdAt,
        );
      this.database
        .prepare(
          `
          INSERT INTO requirement_sources (id, task_id, source_role, input_type, display_name, created_at)
          VALUES (?, ?, 'notice', 'text', '通知原文', ?)
        `,
        )
        .run(sourceId, taskId, createdAt);

      saveSourceVersion(this.database, sourceId, 1, input.noticeText, createdAt);
    });

    transaction();
    const task = this.getTask(taskId);

    if (!task) {
      throw new Error("Saved task could not be read back");
    }

    return task;
  }

  updateTask(input: UpdateReviewTaskInput): ReviewTaskDetails | undefined {
    const updatedAt = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      const updateResult = this.database
        .prepare(
          `
          UPDATE review_tasks
          SET name = ?,
              description = ?,
              project_type = ?,
              project_stage = ?,
              collaboration_scope = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          input.name.trim() || suggestTaskName(input.noticeText),
          input.description,
          input.background.projectType || null,
          input.background.projectStage || null,
          input.background.collaborationScope,
          updatedAt,
          input.taskId,
        );

      if (updateResult.changes === 0) {
        return false;
      }

      const sourceRow = this.database
        .prepare<
          [string],
          {
            id: string;
            version: number;
            original_text: string;
          }
        >(
          `
          SELECT source.id,
                 source_version.version,
                 source_version.original_text
          FROM requirement_sources AS source
          JOIN requirement_source_versions AS source_version ON source_version.source_id = source.id
          WHERE source.task_id = ? AND source.source_role = 'notice'
          ORDER BY source_version.version DESC
          LIMIT 1
        `,
        )
        .get(input.taskId);

      if (!sourceRow) {
        throw new Error("Saved task is missing its notice source");
      }

      if (sourceRow.original_text !== input.noticeText) {
        saveSourceVersion(
          this.database,
          sourceRow.id,
          sourceRow.version + 1,
          input.noticeText,
          updatedAt,
        );
      }

      return true;
    });

    if (!transaction()) {
      return undefined;
    }

    return this.getTask(input.taskId);
  }

  listTasks(): ReviewTaskSummary[] {
    const rows = this.database
      .prepare<[number], DatabaseTaskSummaryRow>(
        `
        SELECT task.id,
               task.name,
               task.description,
               task.project_type,
               task.project_stage,
               task.collaboration_scope,
               COUNT(DISTINCT source.id) AS source_count,
               MAX(source_version.version) AS notice_source_version,
               source_version.original_text AS notice_preview,
               task.updated_at AS latest_updated_at
        FROM review_tasks AS task
        LEFT JOIN requirement_sources AS source
          ON source.task_id = task.id AND source.source_role = 'notice'
        LEFT JOIN requirement_source_versions AS source_version
          ON source_version.source_id = source.id
         AND source_version.version = (
           SELECT MAX(latest.version)
           FROM requirement_source_versions AS latest
           WHERE latest.source_id = source.id
         )
        GROUP BY task.id
        ORDER BY task.updated_at DESC
        LIMIT ?
      `,
      )
      .all(MAXIMUM_TASK_COUNT);

    return rows.map((row) => ({
      id: row.id,
      noticeSourceVersion: row.notice_source_version ?? 0,
      name: row.name,
      description: row.description,
      background: readProjectBackground(row),
      sourceCount: row.source_count,
      noticePreview: row.notice_preview?.slice(0, 240) ?? "",
      latestUpdatedAt: row.latest_updated_at,
    }));
  }

  getTask(taskId: string): ReviewTaskDetails | undefined {
    const row = this.database
      .prepare<[string], DatabaseTaskDetailsRow>(
        `
        SELECT task.id,
               task.name,
               task.description,
               task.project_type,
               task.project_stage,
               task.collaboration_scope,
               COUNT(DISTINCT all_sources.id) AS source_count,
               notice_current.version AS notice_source_version,
               source_version.original_text AS notice_preview,
               task.updated_at AS latest_updated_at,
               task.created_at,
               notice.id AS source_id,
               source_version.version AS source_version,
               notice.input_type AS source_input_type,
               notice.display_name AS source_display_name,
               source_version.original_text AS source_text,
               source_version.parse_status AS source_parse_status,
               source_version.created_at AS source_created_at
        FROM review_tasks AS task
        LEFT JOIN requirement_sources AS all_sources ON all_sources.task_id = task.id
        LEFT JOIN requirement_sources AS notice
          ON notice.task_id = task.id AND notice.source_role = 'notice'
        LEFT JOIN (
          SELECT source_id, MAX(version) AS version
          FROM requirement_source_versions
          GROUP BY source_id
        ) AS notice_current ON notice_current.source_id = notice.id
        LEFT JOIN requirement_source_versions AS source_version
          ON source_version.source_id = notice.id
         AND source_version.version = notice_current.version
        WHERE task.id = ?
        GROUP BY task.id
      `,
      )
      .get(taskId);

    if (!row) {
      return undefined;
    }

    if (!row.source_id || !row.source_version) {
      throw new Error("Saved task is missing its notice source");
    }

    if (row.source_input_type !== "text" || row.source_parse_status !== "text_extracted") {
      throw new Error("Saved task has an unsupported notice input state");
    }

    const noticeSource: RequirementSourceVersion = {
      id: row.source_id,
      version: row.source_version,
      inputType: "text",
      displayName: row.source_display_name,
      originalText: row.source_text ?? "",
      parseStatus: "text_extracted",
      segments: readSourceSegments(this.database, row.source_id, row.source_version),
      createdAt: row.source_created_at,
    };
    const noticeHistory = this.readNoticeHistory(
      row.source_id,
      row.source_input_type,
      row.source_display_name,
    );

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      background: readProjectBackground(row),
      sourceCount: row.source_count,
      noticeSourceVersion: row.notice_source_version ?? 0,
      noticePreview: row.notice_preview ?? "",
      latestUpdatedAt: row.latest_updated_at,
      createdAt: row.created_at,
      noticeSource,
      noticeHistory,
    };
  }

  private readNoticeHistory(
    sourceId: string,
    inputType: string,
    displayName: string,
  ): RequirementSourceVersion[] {
    const rows = this.database
      .prepare<[string], DatabaseSourceVersionRow>(
        `
        SELECT version, original_text, parse_status, created_at
        FROM requirement_source_versions
        WHERE source_id = ?
        ORDER BY version DESC
      `,
      )
      .all(sourceId);

    if (inputType !== "text") {
      throw new Error("Saved notice has an unsupported input type");
    }

    return rows.map((versionRow) => {
      if (versionRow.parse_status !== "text_extracted") {
        throw new Error("Saved notice has an unsupported parse state");
      }

      return {
        id: sourceId,
        version: versionRow.version,
        inputType: "text",
        displayName,
        originalText: versionRow.original_text,
        parseStatus: "text_extracted",
        segments: readSourceSegments(this.database, sourceId, versionRow.version),
        createdAt: versionRow.created_at,
      };
    });
  }

  saveRuleSet(ruleSet: ReviewRuleSet): ReviewRuleSet {
    const parsedRuleSet = reviewRuleSetSchema.parse(ruleSet);
    const taskSource = this.database
      .prepare<[string], { source_id: string; version: number }>(
        `
        SELECT source.id AS source_id, source_version.version
        FROM review_tasks AS task
        JOIN requirement_sources AS source ON source.task_id = task.id AND source.source_role = 'notice'
        JOIN requirement_source_versions AS source_version ON source_version.source_id = source.id
        WHERE task.id = ?
        ORDER BY source_version.version DESC
        LIMIT 1
      `,
      )
      .get(parsedRuleSet.taskId);

    if (
      !taskSource ||
      taskSource.source_id !== parsedRuleSet.sourceId ||
      taskSource.version !== parsedRuleSet.sourceVersion
    ) {
      throw new Error("Rule set must reference the task's current notice version");
    }

    const insertRuleSet = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO requirement_rule_sets (
            id, task_id, source_id, source_version, mode, provider, model, status, warnings_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          parsedRuleSet.id,
          parsedRuleSet.taskId,
          parsedRuleSet.sourceId,
          parsedRuleSet.sourceVersion,
          parsedRuleSet.mode,
          parsedRuleSet.provider,
          parsedRuleSet.model,
          parsedRuleSet.status,
          JSON.stringify(parsedRuleSet.warnings),
          parsedRuleSet.createdAt,
        );

      const insertRule = this.database.prepare(`
        INSERT INTO requirement_rules (
          id, rule_set_id, ordinal, code, description, target, strength, applicability_scope,
          applicability_condition, parameters_json, checkability, generation_method,
          uncertainty, source_id, source_version, paragraph_index, quoted_text, start_offset, end_offset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      parsedRuleSet.rules.forEach((rule, ordinal) => {
        insertRule.run(
          rule.id,
          parsedRuleSet.id,
          ordinal,
          rule.code,
          rule.description,
          rule.target,
          rule.strength,
          rule.applicabilityScope,
          rule.applicabilityCondition,
          JSON.stringify(rule.parameters),
          rule.checkability,
          rule.generationMethod,
          rule.uncertainty,
          rule.source.sourceId,
          rule.source.sourceVersion,
          rule.source.paragraphIndex,
          rule.source.quotedText,
          rule.source.startOffset,
          rule.source.endOffset,
        );
      });
    });

    insertRuleSet();
    return parsedRuleSet;
  }

  listRuleSets(taskId: string): ReviewRuleSet[] {
    const ruleSetRows = this.database
      .prepare<[string], DatabaseRuleSetRow>(
        `
        SELECT id, task_id, source_id, source_version, mode, provider, model, status, warnings_json, created_at
        FROM requirement_rule_sets
        WHERE task_id = ?
        ORDER BY created_at DESC
      `,
      )
      .all(taskId);

    return ruleSetRows.map((row) => {
      const warnings: unknown = JSON.parse(row.warnings_json);
      const rules = this.database
        .prepare<[string], DatabaseRuleRow>(
          `
          SELECT id, code, description, target, strength, applicability_scope, applicability_condition,
                 parameters_json, checkability, generation_method, uncertainty, source_id,
                 source_version, paragraph_index, quoted_text, start_offset, end_offset
          FROM requirement_rules
          WHERE rule_set_id = ?
          ORDER BY ordinal ASC
        `,
        )
        .all(row.id);

      return reviewRuleSetSchema.parse({
        id: row.id,
        taskId: row.task_id,
        sourceId: row.source_id,
        sourceVersion: row.source_version,
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        status: row.status,
        warnings,
        createdAt: row.created_at,
        rules: rules.map((ruleRow) => ({
          id: ruleRow.id,
          code: ruleRow.code,
          description: ruleRow.description,
          target: ruleRow.target,
          strength: ruleRow.strength,
          applicabilityScope: ruleRow.applicability_scope,
          applicabilityCondition: ruleRow.applicability_condition,
          parameters: JSON.parse(ruleRow.parameters_json) as unknown,
          checkability: ruleRow.checkability,
          generationMethod: ruleRow.generation_method,
          uncertainty: ruleRow.uncertainty,
          source: {
            sourceId: ruleRow.source_id,
            sourceVersion: ruleRow.source_version,
            paragraphIndex: ruleRow.paragraph_index,
            quotedText: ruleRow.quoted_text,
            startOffset: ruleRow.start_offset,
            endOffset: ruleRow.end_offset,
          },
        })),
      });
    });
  }

  close(): void {
    this.database.close();
  }
}

function suggestTaskName(noticeText: string): string {
  const firstHeading = noticeText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ""))
    .find((line) => line.length > 0);
  return firstHeading?.slice(0, 64) || "新的材料预审任务";
}

export function getReviewStore(): ReviewStore {
  const databaseDirectory = resolve(
    process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
  );
  const reviewGlobals = globalThis as ReviewDatabaseGlobal;
  const existingContext = reviewGlobals.__materialReviewDatabase;

  if (existingContext?.databaseDirectory === databaseDirectory && existingContext.database.open) {
    return new ReviewStore(existingContext.database);
  }

  if (existingContext?.database.open) {
    existingContext.database.close();
  }

  const database = createReviewDatabase(databaseDirectory);
  reviewGlobals.__materialReviewDatabase = { databaseDirectory, database };
  return new ReviewStore(database);
}
