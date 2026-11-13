import { accountById } from "@/lib/server/account-auth";
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { defaultOwner, isLegacyTestMode } from "@/lib/server/access-config";
import Database from "better-sqlite3";

import type {
  RequirementSourceSegment,
  RequirementSourceVersion,
  MaterialContentSegment,
  MaterialParseStatus,
  MaterialPageCoverage,
  MaterialRevision,
  MaterialVersionPreview,
  ReviewMaterialSummary,
  ReviewExecution,
  HumanResolution,
  RemediationTask,
  ReviewTaskBackground,
  ReviewTaskDetails,
  ReviewTaskSummary,
} from "@/domain/review";
import { reviewRuleSetSchema } from "@/domain/review-rule";
import { classifyMaterial } from "@/lib/material-classification";
import type { MaterialClassification } from "@/lib/material-classification";

import type { ReviewRuleSet } from "@/domain/review-rule";

const DATABASE_SCHEMA_VERSION = 22;

interface ReviewDatabaseContext {
  databaseDirectory: string;
  database: Database.Database;
}

type ReviewDatabaseGlobal = typeof globalThis & {
  __materialReviewDatabase?: ReviewDatabaseContext;
};

interface CreateReviewTaskInput {
  ownerId?: string;
  name: string;
  description: string;
  background: ReviewTaskBackground;
  noticeText: string;
  sourceType?: "text" | "webpage" | "file";
  sourceUrl?: string;
  sourceFetchedAt?: string;
  sourceTitle?: string;
  sourceParseStatus?: MaterialParseStatus;
  sourceSegments?: RequirementSourceSegment[];
}

interface UpdateReviewTaskInput extends CreateReviewTaskInput {
  taskId: string;
}

interface CreateSupplementSourceInput {
  taskId: string;
  displayName: string;
  sourceType: "file" | "webpage";
  sourceUrl?: string;
  sourceFetchedAt?: string;
  text: string;
  segments: RequirementSourceSegment[];
  parseStatus: MaterialParseStatus;
}

interface DatabaseTaskSummaryRow {
  id: string;
  name: string;
  description: string;
  project_type: string | null;
  project_stage: string | null;
  condition_answers_json?: string;
  field_mappings_json?: string;
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
  source_url: string | null;
  source_fetched_at: string | null;
}

interface DatabaseSourceSegmentRow {
  paragraph_index: number;
  text: string;
  start_offset: number;
  end_offset: number;
  location: string;
}

interface DatabaseSourceVersionRow {
  version: number;
  original_text: string;
  parse_status: string;
  created_at: string;
  source_url: string | null;
  source_fetched_at: string | null;
}

interface DatabaseRuleSetRow {
  id: string;
  task_id: string;
  source_id: string;
  source_version: number;
  source_versions_json: string;
  mode: string;
  provider: string;
  model: string;
  status: string;
  warnings_json: string;
  model_calls_json: string;
  created_at: string;
}

interface DatabaseRuleRow {
  metadata_json: string;
  id: string;
  code: string;
  description: string;
  target: string;
  strength: string;
  applicability_scope: string;
  applicability_condition: string;
  parameters_json: string;
  material_ids_json: string;
  checkability: string;
  generation_method: string;
  uncertainty: string;
  source_id: string;
  source_version: number;
  source_display_name: string;
  paragraph_index: number;
  quoted_text: string;
  start_offset: number;
  end_offset: number;
}

interface DatabaseMaterialRow {
  id: string;
  version: number;
  original_file_name: string;
  media_type: string;
  extension: string;
  file_size_bytes: number;
  sha256: string;
  parse_status: string;
  parser_name: string;
  extracted_text: string;
  page_count: number | null;
  sheet_names_json: string;
  parse_message: string;
  page_coverage_json: string;
  revision_json: string;
  classification_json: string;
  created_at: string;
}

interface DatabaseMaterialSegmentRow {
  region_json: string;
  segment_index: number;
  text: string;
  start_offset: number;
  end_offset: number;
  location: string;
}

interface DatabaseExecutionRow {
  id: string;
  task_id: string;
  rule_set_id: string;
  source_version: number;
  status: string;
  unexecuted_count: number;
  material_snapshot_json: string;
  results_json: string;
  created_at: string;
  completed_at: string;
  metadata_json: string;
}

export interface SaveMaterialVersionInput {
  id: string;
  taskId: string;
  version: number;
  originalFileName: string;
  mediaType: string;
  extension: string;
  fileSizeBytes: number;
  sha256: string;
  storageKey: string;
  parseStatus: MaterialParseStatus;
  parserName: string;
  extractedText: string;
  segments: MaterialContentSegment[];
  pageCount: number | null;
  sheetNames: string[];
  parseMessage: string;
  pageCoverage?: MaterialPageCoverage[];
  revision?: MaterialRevision;
  classification?: MaterialClassification;
  createdAt: string;
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
    ...(row.condition_answers_json && row.condition_answers_json !== "[]"
      ? {
          conditionAnswers: JSON.parse(row.condition_answers_json) as NonNullable<
            ReviewTaskBackground["conditionAnswers"]
          >,
        }
      : {}),
    ...(row.field_mappings_json && row.field_mappings_json !== "[]"
      ? {
          fieldMappings: JSON.parse(row.field_mappings_json) as NonNullable<
            ReviewTaskBackground["fieldMappings"]
          >,
        }
      : {}),
    projectType: row.project_type ?? "",
    projectStage: row.project_stage ?? "",
    collaborationScope: row.collaboration_scope,
  };
}

function isMaterialParseStatus(value: string): value is MaterialParseStatus {
  return (
    value === "text_extracted" ||
    value === "partial" ||
    value === "failed" ||
    value === "ocr_required"
  );
}

function parseJsonStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Saved material metadata is invalid");
  }
  return parsed;
}

function readSourceSegments(
  database: Database.Database,
  sourceId: string,
  version: number,
): RequirementSourceSegment[] {
  const rows = database
    .prepare<[string, number], DatabaseSourceSegmentRow>(
      `
      SELECT paragraph_index, text, start_offset, end_offset, location
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
    location: row.location || undefined,
  }));
}

function saveSourceVersion(
  database: Database.Database,
  sourceId: string,
  version: number,
  originalText: string,
  createdAt: string,
  parseStatus: MaterialParseStatus = "text_extracted",
  sourceSegments?: RequirementSourceSegment[],
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
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(sourceId, version, originalText, parseStatus, createdAt);

  const insertSegment = database.prepare(`
    INSERT INTO requirement_source_segments (
      source_id,
      source_version,
      paragraph_index,
      text,
      start_offset,
      end_offset,
      location
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const segments: RequirementSourceSegment[] = [];
  const sourceBlocks: RequirementSourceSegment[] =
    sourceSegments ??
    [...originalText.matchAll(/[^\r\n]+/g)]
      .filter((match) => match[0].trim().length > 0)
      .map((match, paragraphIndex) => ({
        paragraphIndex,
        text: match[0],
        startOffset: match.index,
        endOffset: match.index + match[0].length,
      }));

  for (const [index, segment] of sourceBlocks.entries()) {
    const paragraphIndex = segment.paragraphIndex ?? index;
    insertSegment.run(
      sourceId,
      version,
      paragraphIndex,
      segment.text,
      segment.startOffset,
      segment.endOffset,
      segment.location ?? "",
    );
    segments.push({ ...segment, paragraphIndex });
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

    const currentSchemaVersion = database.pragma("user_version", { simple: true });
    if (currentSchemaVersion === 2) {
      const migrateToVersionThree = database.transaction(() => {
        database.exec(`
          CREATE TABLE review_materials (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            UNIQUE (task_id, id)
          );

          CREATE TABLE review_material_versions (
            material_id TEXT NOT NULL REFERENCES review_materials (id) ON DELETE CASCADE,
            version INTEGER NOT NULL CHECK (version > 0),
            original_file_name TEXT NOT NULL,
            media_type TEXT NOT NULL,
            extension TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
            sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
            storage_key TEXT NOT NULL,
            parse_status TEXT NOT NULL
              CHECK (parse_status IN ('text_extracted', 'partial', 'failed', 'ocr_required')),
            parser_name TEXT NOT NULL,
            extracted_text TEXT NOT NULL DEFAULT '',
            page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
            sheet_names_json TEXT NOT NULL DEFAULT '[]',
            parse_message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            PRIMARY KEY (material_id, version)
          );

          CREATE TABLE review_material_segments (
            material_id TEXT NOT NULL,
            material_version INTEGER NOT NULL,
            segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
            text TEXT NOT NULL,
            start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
            end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
            location TEXT NOT NULL,
            PRIMARY KEY (material_id, material_version, segment_index),
            FOREIGN KEY (material_id, material_version)
              REFERENCES review_material_versions (material_id, version) ON DELETE CASCADE
          );

          CREATE INDEX review_materials_task_idx ON review_materials (task_id, created_at DESC);
          CREATE INDEX review_material_versions_latest_idx
            ON review_material_versions (material_id, version DESC);
          PRAGMA user_version = 3;
        `);
      });

      migrateToVersionThree();
    }

    const materialSchemaVersion = database.pragma("user_version", { simple: true });
    if (materialSchemaVersion === 3) {
      const migrateToVersionFour = database.transaction(() => {
        database.exec(`
          CREATE TABLE review_executions (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
            rule_set_id TEXT NOT NULL REFERENCES requirement_rule_sets (id),
            source_version INTEGER NOT NULL CHECK (source_version > 0),
            status TEXT NOT NULL CHECK (status IN ('completed')),
            material_snapshot_json TEXT NOT NULL,
            results_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT NOT NULL
          );
          CREATE INDEX review_executions_task_idx ON review_executions (task_id, created_at DESC);
          PRAGMA user_version = 4;
        `);
      });
      migrateToVersionFour();
    }

    const executionSchemaVersion = database.pragma("user_version", { simple: true });
    if (executionSchemaVersion === 4) {
      const migrateToVersionFive = database.transaction(() => {
        database.exec(`
          ALTER TABLE review_executions RENAME TO review_executions_v4;
          CREATE TABLE review_executions (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
            rule_set_id TEXT NOT NULL REFERENCES requirement_rule_sets (id),
            source_version INTEGER NOT NULL CHECK (source_version > 0),
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
            unexecuted_count INTEGER NOT NULL DEFAULT 0 CHECK (unexecuted_count >= 0),
            material_snapshot_json TEXT NOT NULL,
            results_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO review_executions (
            id, task_id, rule_set_id, source_version, status, material_snapshot_json,
            results_json, created_at, completed_at
          ) SELECT id, task_id, rule_set_id, source_version, status, material_snapshot_json,
                   results_json, created_at, completed_at
            FROM review_executions_v4;
          DROP TABLE review_executions_v4;
          CREATE INDEX review_executions_task_idx ON review_executions (task_id, created_at DESC);
          PRAGMA user_version = 5;
        `);
      });
      migrateToVersionFive();
    }

    if (database.pragma("user_version", { simple: true }) === 5) {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE requirement_rule_sets ADD COLUMN model_calls_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE review_executions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
          PRAGMA user_version = 6;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 6) {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE requirement_rules ADD COLUMN material_ids_json TEXT NOT NULL DEFAULT '[]';
          PRAGMA user_version = 7;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 7) {
      database.transaction(() => {
        database.exec(`
          CREATE TABLE review_human_resolutions (
            execution_id TEXT NOT NULL REFERENCES review_executions (id) ON DELETE CASCADE,
            rule_id TEXT NOT NULL,
            decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'deferred')),
            note TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (execution_id, rule_id)
          );
          PRAGMA user_version = 8;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 8) {
      database.transaction(() => {
        database.exec(`
          CREATE TABLE review_remediation_tasks (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES review_tasks (id) ON DELETE CASCADE,
            execution_id TEXT NOT NULL REFERENCES review_executions (id) ON DELETE CASCADE,
            rule_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done')),
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (execution_id, rule_id)
          );
          CREATE INDEX review_remediation_task_idx
            ON review_remediation_tasks (task_id, updated_at DESC);
          PRAGMA user_version = 9;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 9) {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE requirement_sources ADD COLUMN source_url TEXT;
          ALTER TABLE requirement_sources ADD COLUMN source_fetched_at TEXT;
          PRAGMA user_version = 10;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 10) {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE requirement_source_segments ADD COLUMN location TEXT NOT NULL DEFAULT '';
          PRAGMA user_version = 11;
        `);
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 11) {
      database.transaction(() => {
        database.exec(`
          ALTER TABLE requirement_rule_sets
            ADD COLUMN source_versions_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE requirement_rules RENAME TO requirement_rules_v11;
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
            source_display_name TEXT NOT NULL DEFAULT '',
            paragraph_index INTEGER NOT NULL CHECK (paragraph_index >= 0),
            quoted_text TEXT NOT NULL,
            start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
            end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
            material_ids_json TEXT NOT NULL DEFAULT '[]',
            UNIQUE (rule_set_id, ordinal)
          );
          INSERT INTO requirement_rules (
            id, rule_set_id, ordinal, code, description, target, strength, applicability_scope,
            applicability_condition, parameters_json, checkability, generation_method,
            uncertainty, source_id, source_version, paragraph_index, quoted_text,
            start_offset, end_offset, material_ids_json
          ) SELECT id, rule_set_id, ordinal, code, description, target, strength,
                   applicability_scope, applicability_condition, parameters_json, checkability,
                   generation_method, uncertainty, source_id, source_version, paragraph_index,
                   quoted_text, start_offset, end_offset, material_ids_json
            FROM requirement_rules_v11;
          DROP TABLE requirement_rules_v11;
          CREATE INDEX requirement_rules_rule_set_idx
            ON requirement_rules (rule_set_id, ordinal ASC);
          PRAGMA user_version = 12;
        `);
        const oldRuleSets = database
          .prepare("SELECT id, source_id, source_version FROM requirement_rule_sets")
          .all() as Array<{ id: string; source_id: string; source_version: number }>;
        const updateManifest = database.prepare(
          "UPDATE requirement_rule_sets SET source_versions_json = ? WHERE id = ?",
        );
        for (const ruleSet of oldRuleSets)
          updateManifest.run(
            JSON.stringify([{ sourceId: ruleSet.source_id, version: ruleSet.source_version }]),
            ruleSet.id,
          );
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 12) {
      database.transaction(() => {
        const ruleSets = database
          .prepare("SELECT id, source_versions_json FROM requirement_rule_sets")
          .all() as Array<{ id: string; source_versions_json: string }>;
        const sourceName = database.prepare(
          "SELECT display_name FROM requirement_sources WHERE id = ?",
        );
        const updateSources = database.prepare(
          "UPDATE requirement_rule_sets SET source_versions_json = ? WHERE id = ?",
        );
        for (const ruleSet of ruleSets) {
          const sourceVersions: unknown = JSON.parse(ruleSet.source_versions_json);
          if (!Array.isArray(sourceVersions)) throw new Error("Invalid source manifest");
          const namedSources = sourceVersions.map((source: unknown) => {
            if (typeof source !== "object" || source === null || !("sourceId" in source))
              throw new Error("Invalid source manifest item");
            const sourceId = source.sourceId;
            if (typeof sourceId !== "string") throw new Error("Invalid source manifest ID");
            const row = sourceName.get(sourceId) as { display_name: string } | undefined;
            return {
              ...source,
              displayName: row?.display_name ?? "已移除来源",
            };
          });
          updateSources.run(JSON.stringify(namedSources), ruleSet.id);
        }
        database
          .prepare(
            `UPDATE requirement_rules
             SET source_display_name = COALESCE(
               (SELECT display_name FROM requirement_sources WHERE id = requirement_rules.source_id),
               '已移除来源'
             )
             WHERE source_display_name = ''`,
          )
          .run();
        database.exec("PRAGMA user_version = 13");
      })();
    }

    if (database.pragma("user_version", { simple: true }) === 13) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_material_versions ADD COLUMN page_coverage_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 14;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 14) {
      database.transaction(() => {
        database.exec(`CREATE TABLE execution_source_snapshots (
          execution_id TEXT NOT NULL REFERENCES review_executions(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL, version INTEGER NOT NULL, display_name TEXT NOT NULL,
          source_url TEXT, segments_json TEXT NOT NULL,
          PRIMARY KEY (execution_id, source_id, version)
        ); PRAGMA user_version = 15;`);
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 15) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_material_versions ADD COLUMN revision_json TEXT NOT NULL DEFAULT 'null'; PRAGMA user_version = 16;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 16) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE requirement_rules ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'; PRAGMA user_version = 17;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 17) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_material_versions ADD COLUMN classification_json TEXT NOT NULL DEFAULT 'null'; PRAGMA user_version = 18;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 18) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_tasks ADD COLUMN condition_answers_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 19;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 19) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_tasks ADD COLUMN owner_id TEXT; CREATE TABLE task_grants (task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY(task_id,user_id)); PRAGMA user_version = 20;",
        );
        database
          .prepare("UPDATE review_tasks SET owner_id = ? WHERE owner_id IS NULL")
          .run(defaultOwner());
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 20) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_tasks ADD COLUMN field_mappings_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 21;",
        );
      })();
    }
    if (database.pragma("user_version", { simple: true }) === 21) {
      database.transaction(() => {
        database.exec(
          "ALTER TABLE review_material_segments ADD COLUMN region_json TEXT NOT NULL DEFAULT 'null'; PRAGMA user_version = 22;",
        );
      })();
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

  deleteTask(taskId: string): boolean {
    return this.database.prepare("DELETE FROM review_tasks WHERE id = ?").run(taskId).changes > 0;
  }

  createSupplementSource(input: CreateSupplementSourceInput): RequirementSourceVersion | undefined {
    if (!this.getTask(input.taskId)) return undefined;
    const sourceId = randomUUID();
    const createdAt = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO requirement_sources (id, task_id, source_role, input_type, display_name, created_at)
           VALUES (?, ?, 'supplement', ?, ?, ?)`,
        )
        .run(sourceId, input.taskId, input.sourceType, input.displayName, createdAt);
      if (input.sourceUrl)
        this.database
          .prepare(
            "UPDATE requirement_sources SET source_url = ?, source_fetched_at = ? WHERE id = ?",
          )
          .run(input.sourceUrl ?? null, input.sourceFetchedAt ?? createdAt, sourceId);
      saveSourceVersion(
        this.database,
        sourceId,
        1,
        input.text,
        createdAt,
        input.parseStatus,
        input.segments,
      );
      this.database
        .prepare("UPDATE review_tasks SET updated_at = ? WHERE id = ?")
        .run(createdAt, input.taskId);
    })();
    return this.readSource(sourceId);
  }

  deleteSupplementSource(taskId: string, sourceId: string): boolean {
    const deleted = this.database
      .prepare(
        "DELETE FROM requirement_sources WHERE id = ? AND task_id = ? AND source_role = 'supplement'",
      )
      .run(sourceId, taskId).changes;
    if (deleted > 0)
      this.database
        .prepare("UPDATE review_tasks SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), taskId);
    return deleted > 0;
  }

  reviseSupplementSource(
    taskId: string,
    sourceId: string,
    version: number,
    text: string,
    note: string,
    confirmedComplete: boolean,
  ): RequirementSourceVersion | undefined {
    const source = this.getTask(taskId)?.supplementalSources.find((item) => item.id === sourceId);
    if (!source) return undefined;
    if (source.version !== version) throw new Error("Source version changed");
    const now = new Date().toISOString();
    const segments = [...text.matchAll(/[^\r\n]+/g)].map((match, paragraphIndex) => ({
      paragraphIndex,
      text: match[0],
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      location: `人工修订段落 ${paragraphIndex + 1} · 依据：${note}`,
    }));
    this.database.transaction(() => {
      saveSourceVersion(
        this.database,
        sourceId,
        version + 1,
        text,
        now,
        confirmedComplete ? "text_extracted" : source.parseStatus,
        segments,
      );
      this.database.prepare("UPDATE review_tasks SET updated_at = ? WHERE id = ?").run(now, taskId);
    })();
    return this.readSource(sourceId);
  }

  private readSource(sourceId: string): RequirementSourceVersion | undefined {
    const row = this.database
      .prepare<[string], DatabaseSourceVersionRow & { input_type: string; display_name: string }>(
        `SELECT source.input_type, source.display_name, version.version, version.original_text,
                version.parse_status, version.created_at, source.source_url, source.source_fetched_at
         FROM requirement_sources AS source
         JOIN requirement_source_versions AS version ON version.source_id = source.id
         WHERE source.id = ? ORDER BY version.version DESC LIMIT 1`,
      )
      .get(sourceId);
    if (!row || !isMaterialParseStatus(row.parse_status)) return undefined;
    return {
      id: sourceId,
      version: row.version,
      inputType: row.input_type as RequirementSourceVersion["inputType"],
      displayName: row.display_name,
      sourceUrl: row.source_url ?? undefined,
      fetchedAt: row.source_fetched_at ?? undefined,
      originalText: row.original_text,
      parseStatus: row.parse_status,
      segments: readSourceSegments(this.database, sourceId, row.version),
      createdAt: row.created_at,
    };
  }

  createTask(input: CreateReviewTaskInput): ReviewTaskDetails {
    const taskId = randomUUID();
    const sourceId = randomUUID();
    const createdAt = new Date().toISOString();
    const name = input.name.trim() || suggestTaskName(input.noticeText);
    const transaction = this.database.transaction(() => {
      const ownerId = input.ownerId ?? defaultOwner();
      if (!isLegacyTestMode()) {
        const account = accountById(ownerId);
        if (!account || account.disabled) throw new Error("账号已失效，未创建新任务，请重新登录。");
      }
      const count =
        this.database
          .prepare<[string], { count: number }>(
            "SELECT COUNT(*) AS count FROM review_tasks WHERE owner_id=?",
          )
          .get(ownerId)?.count ?? 0;
      if (!isLegacyTestMode() && count >= 100)
        throw new Error("当前账号最多保存100个任务，请导出并清理不再需要的任务。");
      this.database
        .prepare(
          `
          INSERT INTO review_tasks (
            id, name, description, project_type, project_stage, collaboration_scope, created_at, updated_at, condition_answers_json, owner_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          JSON.stringify(input.background.conditionAnswers ?? []),
          input.ownerId ?? defaultOwner(),
        );
      this.database
        .prepare(
          `
          INSERT INTO requirement_sources (id, task_id, source_role, input_type, display_name, created_at)
          VALUES (?, ?, 'notice', ?, ?, ?)
        `,
        )
        .run(
          sourceId,
          taskId,
          input.sourceType ?? "text",
          input.sourceType === "webpage"
            ? `${input.sourceTitle?.trim() || "公开网页"} · ${input.sourceUrl}`
            : input.sourceType === "file"
              ? input.sourceTitle?.trim() || "要求文件"
              : "通知原文",
          createdAt,
        );
      if (input.sourceType === "webpage")
        this.database
          .prepare(
            "UPDATE requirement_sources SET source_url = ?, source_fetched_at = ? WHERE id = ?",
          )
          .run(input.sourceUrl ?? null, input.sourceFetchedAt ?? createdAt, sourceId);

      saveSourceVersion(
        this.database,
        sourceId,
        1,
        input.noticeText,
        createdAt,
        input.sourceParseStatus ?? "text_extracted",
        input.sourceSegments,
      );
    });

    transaction();
    const task = this.getTask(taskId);

    if (!task) {
      throw new Error("Saved task could not be read back");
    }

    return task;
  }

  isReady(): boolean {
    this.database.prepare("SELECT 1 FROM review_tasks LIMIT 1").all();
    return true;
  }

  saveFieldMappings(
    taskId: string,
    expected: string,
    mappings: NonNullable<ReviewTaskBackground["fieldMappings"]>,
  ): boolean {
    return (
      this.database
        .prepare(
          "UPDATE review_tasks SET field_mappings_json = ?, updated_at = ? WHERE id = ? AND field_mappings_json = ?",
        )
        .run(JSON.stringify(mappings), new Date().toISOString(), taskId, expected).changes === 1
    );
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
              condition_answers_json = COALESCE(?, condition_answers_json),
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
          input.background.conditionAnswers
            ? JSON.stringify(input.background.conditionAnswers)
            : null,
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
      .prepare<[], DatabaseTaskSummaryRow>(
        `
        SELECT task.id,
               task.name,
               task.description,
               task.project_type,
               task.project_stage,
               task.condition_answers_json,
               task.field_mappings_json,
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

      `,
      )
      .all();

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
               task.condition_answers_json,
               task.field_mappings_json,
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
               source_version.created_at AS source_created_at,
               notice.source_url AS source_url,
               notice.source_fetched_at AS source_fetched_at
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

    if (
      !(
        row.source_input_type === "text" ||
        row.source_input_type === "webpage" ||
        row.source_input_type === "file"
      ) ||
      !isMaterialParseStatus(row.source_parse_status)
    ) {
      throw new Error("Saved task has an unsupported notice input state");
    }

    const noticeSource: RequirementSourceVersion = {
      id: row.source_id,
      version: row.source_version,
      inputType: row.source_input_type as RequirementSourceVersion["inputType"],
      displayName: row.source_display_name,
      sourceUrl: row.source_url ?? undefined,
      fetchedAt: row.source_fetched_at ?? undefined,
      originalText: row.source_text ?? "",
      parseStatus: row.source_parse_status,
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
      supplementalSources: this.readSupplementSources(taskId),
      materials: this.listMaterials(taskId),
    };
  }

  private readSupplementSources(taskId: string): RequirementSourceVersion[] {
    const sourceIds = this.database
      .prepare<[string], { id: string }>(
        "SELECT id FROM requirement_sources WHERE task_id = ? AND source_role = 'supplement' ORDER BY created_at, id",
      )
      .all(taskId);
    return sourceIds.flatMap(({ id }) => {
      const source = this.readSource(id);
      return source ? [source] : [];
    });
  }

  private readNoticeHistory(
    sourceId: string,
    inputType: RequirementSourceVersion["inputType"],
    displayName: string,
  ): RequirementSourceVersion[] {
    const rows = this.database
      .prepare<[string], DatabaseSourceVersionRow>(
        `
        SELECT version.version, version.original_text, version.parse_status, version.created_at,
               source.source_url, source.source_fetched_at
        FROM requirement_source_versions AS version
        JOIN requirement_sources AS source ON source.id = version.source_id
        WHERE version.source_id = ?
        ORDER BY version.version DESC
      `,
      )
      .all(sourceId);

    return rows.map((versionRow) => {
      if (!isMaterialParseStatus(versionRow.parse_status)) {
        throw new Error("Saved notice has an unsupported parse state");
      }

      return {
        id: sourceId,
        version: versionRow.version,
        inputType,
        displayName,
        sourceUrl: versionRow.source_url ?? undefined,
        fetchedAt: versionRow.source_fetched_at ?? undefined,
        originalText: versionRow.original_text,
        parseStatus: versionRow.parse_status,
        segments: readSourceSegments(this.database, sourceId, versionRow.version),
        createdAt: versionRow.created_at,
      };
    });
  }

  saveRuleSet(ruleSet: ReviewRuleSet): ReviewRuleSet {
    const parsedRuleSet = reviewRuleSetSchema.parse(ruleSet);
    const task = this.getTask(parsedRuleSet.taskId);
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
      !task ||
      !taskSource ||
      taskSource.source_id !== parsedRuleSet.sourceId ||
      taskSource.version !== parsedRuleSet.sourceVersion
    ) {
      throw new Error("Rule set must reference the task's current notice version");
    }

    const sourceVersions = parsedRuleSet.sourceVersions.length
      ? parsedRuleSet.sourceVersions
      : [
          {
            sourceId: parsedRuleSet.sourceId,
            version: parsedRuleSet.sourceVersion,
            displayName: task.noticeSource.displayName,
          },
        ];
    const currentSources = [task.noticeSource, ...task.supplementalSources];
    if (
      sourceVersions.length !== currentSources.length ||
      currentSources.some(
        (source) =>
          !sourceVersions.some(
            (candidate) => candidate.sourceId === source.id && candidate.version === source.version,
          ),
      )
    )
      throw new Error("Rule set must snapshot all current task sources");
    parsedRuleSet.sourceVersions = currentSources.map(({ id, version, displayName }) => ({
      sourceId: id,
      version,
      displayName,
    }));
    for (const rule of parsedRuleSet.rules) {
      for (const citation of [rule.source, ...(rule.additionalSources ?? [])]) {
        const source = currentSources.find((candidate) => candidate.id === citation.sourceId);
        const segment = source?.segments.find(
          (candidate) => candidate.paragraphIndex === citation.paragraphIndex,
        );
        if (
          !source ||
          source.version !== citation.sourceVersion ||
          !sourceVersions.some(
            (candidate) => candidate.sourceId === source.id && candidate.version === source.version,
          ) ||
          !segment ||
          citation.startOffset < segment.startOffset ||
          citation.endOffset > segment.endOffset ||
          source.originalText.slice(citation.startOffset, citation.endOffset) !==
            citation.quotedText
        )
          throw new Error("Rule citation must match a current source position");
        citation.displayName = source.displayName;
      }
    }

    const insertRuleSet = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO requirement_rule_sets (
            id, task_id, source_id, source_version, source_versions_json, mode, provider, model,
            status, warnings_json, created_at, model_calls_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          parsedRuleSet.id,
          parsedRuleSet.taskId,
          parsedRuleSet.sourceId,
          parsedRuleSet.sourceVersion,
          JSON.stringify(
            parsedRuleSet.sourceVersions.length
              ? parsedRuleSet.sourceVersions
              : [
                  {
                    sourceId: parsedRuleSet.sourceId,
                    version: parsedRuleSet.sourceVersion,
                    displayName: task.noticeSource.displayName,
                  },
                ],
          ),
          parsedRuleSet.mode,
          parsedRuleSet.provider,
          parsedRuleSet.model,
          parsedRuleSet.status,
          JSON.stringify(parsedRuleSet.warnings),
          parsedRuleSet.createdAt,
          JSON.stringify(parsedRuleSet.modelCalls),
        );

      const insertRule = this.database.prepare(`
        INSERT INTO requirement_rules (
          id, rule_set_id, ordinal, code, description, target, strength, applicability_scope,
          applicability_condition, parameters_json, checkability, generation_method,
            uncertainty, source_id, source_version, paragraph_index, quoted_text, start_offset, end_offset,
            source_display_name, material_ids_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          rule.source.displayName,
          JSON.stringify(rule.materialIds),
          JSON.stringify({
            additionalSources: rule.additionalSources,
            numericConstraints: rule.numericConstraints,
          }),
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
        SELECT id, task_id, source_id, source_version, source_versions_json, mode, provider, model,
               status, warnings_json, created_at, model_calls_json
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
                 parameters_json, checkability, generation_method, uncertainty, source_id, metadata_json,
                 source_version, source_display_name, paragraph_index, quoted_text, start_offset, end_offset
                 , material_ids_json
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
        sourceVersions: JSON.parse(row.source_versions_json) as unknown,
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        status: row.status,
        warnings,
        modelCalls: JSON.parse(row.model_calls_json) as unknown,
        createdAt: row.created_at,
        rules: rules.map((ruleRow) => ({
          ...(JSON.parse(ruleRow.metadata_json) as Record<string, unknown>),
          id: ruleRow.id,
          code: ruleRow.code,
          description: ruleRow.description,
          target: ruleRow.target,
          strength: ruleRow.strength,
          applicabilityScope: ruleRow.applicability_scope,
          applicabilityCondition: ruleRow.applicability_condition,
          parameters: JSON.parse(ruleRow.parameters_json) as unknown,
          materialIds: JSON.parse(ruleRow.material_ids_json) as unknown,
          checkability: ruleRow.checkability,
          generationMethod: ruleRow.generation_method,
          uncertainty: ruleRow.uncertainty,
          source: {
            sourceId: ruleRow.source_id,
            sourceVersion: ruleRow.source_version,
            displayName: ruleRow.source_display_name || "主通知",
            paragraphIndex: ruleRow.paragraph_index,
            quotedText: ruleRow.quoted_text,
            startOffset: ruleRow.start_offset,
            endOffset: ruleRow.end_offset,
          },
        })),
      });
    });
  }

  saveMaterialVersion(input: SaveMaterialVersionInput): ReviewMaterialSummary {
    const materialExists = this.database
      .prepare<[string], { task_id: string; latest_version: number | null }>(
        `SELECT material.task_id, MAX(version.version) AS latest_version
         FROM review_materials AS material
         LEFT JOIN review_material_versions AS version ON version.material_id = material.id
         WHERE material.id = ? GROUP BY material.id`,
      )
      .get(input.id);

    if (
      !this.database
        .prepare<[string], { id: string }>("SELECT id FROM review_tasks WHERE id = ?")
        .get(input.taskId)
    ) {
      throw new Error("Review task does not exist");
    }
    if (materialExists && materialExists.task_id !== input.taskId) {
      throw new Error("Material does not belong to the review task");
    }
    if (materialExists && input.version !== (materialExists.latest_version ?? 0) + 1) {
      throw new Error("Material versions must be saved in order");
    }
    if (!materialExists && input.version !== 1) {
      throw new Error("A new material must start at version 1");
    }

    const save = this.database.transaction(() => {
      if (!materialExists) {
        this.database
          .prepare("INSERT INTO review_materials (id, task_id, created_at) VALUES (?, ?, ?)")
          .run(input.id, input.taskId, input.createdAt);
      }

      this.database
        .prepare(
          `
          INSERT INTO review_material_versions (
            material_id, version, original_file_name, media_type, extension, file_size_bytes,
            sha256, storage_key, parse_status, parser_name, extracted_text, page_count,
            sheet_names_json, parse_message, created_at, page_coverage_json, revision_json, classification_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          input.id,
          input.version,
          input.originalFileName,
          input.mediaType,
          input.extension,
          input.fileSizeBytes,
          input.sha256,
          input.storageKey,
          input.parseStatus,
          input.parserName,
          input.extractedText,
          input.pageCount,
          JSON.stringify(input.sheetNames),
          input.parseMessage,
          input.createdAt,
          JSON.stringify(input.pageCoverage ?? []),
          JSON.stringify(input.revision ?? null),
          JSON.stringify(input.classification ?? classifyMaterial(input.segments) ?? null),
        );

      const insertSegment = this.database.prepare(`
        INSERT INTO review_material_segments (
          material_id, material_version, segment_index, text, start_offset, end_offset, location, region_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const segment of input.segments) {
        insertSegment.run(
          input.id,
          input.version,
          segment.segmentIndex,
          segment.text,
          segment.startOffset,
          segment.endOffset,
          segment.location,
          JSON.stringify(segment.region ?? null),
        );
      }
    });

    save();
    const savedMaterial = this.listMaterials(input.taskId).find(
      (material) => material.id === input.id,
    );
    if (!savedMaterial) throw new Error("Saved material could not be read back");
    return savedMaterial;
  }

  getMaterialVersionPreview(
    taskId: string,
    materialId: string,
    version: number,
    offset = 0,
  ): MaterialVersionPreview | undefined {
    const row = this.database
      .prepare<[string, string, number], DatabaseMaterialRow>(
        `
      SELECT material.id, version.* FROM review_materials AS material
      JOIN review_material_versions AS version ON version.material_id = material.id
      WHERE material.task_id = ? AND material.id = ? AND version.version = ?
    `,
      )
      .get(taskId, materialId, version);
    if (!row || !isMaterialParseStatus(row.parse_status)) return undefined;
    const total =
      this.database
        .prepare<[string, number], { count: number }>(
          "SELECT COUNT(*) AS count FROM review_material_segments WHERE material_id = ? AND material_version = ?",
        )
        .get(materialId, version)?.count ?? 0;
    const segments = this.database
      .prepare<[string, number, number], DatabaseMaterialSegmentRow>(
        `
      SELECT segment_index, substr(text, 1, 16000) AS text, start_offset, end_offset, location, region_json
      FROM review_material_segments WHERE material_id = ? AND material_version = ?
      ORDER BY segment_index LIMIT 5 OFFSET ?
    `,
      )
      .all(materialId, version, offset);
    return {
      id: materialId,
      version,
      originalFileName: row.original_file_name,
      extension: row.extension,
      parseStatus: row.parse_status,
      parseMessage: row.parse_message,
      pageCount: row.page_count,
      totalSegments: total,
      offset,
      segments: segments.map((segment) => ({
        segmentIndex: segment.segment_index,
        text: segment.text,
        startOffset: segment.start_offset,
        endOffset: segment.end_offset,
        location: segment.location,
        ...(segment.region_json !== "null"
          ? {
              region: JSON.parse(segment.region_json) as NonNullable<
                MaterialContentSegment["region"]
              >,
            }
          : {}),
      })),
    };
  }

  getMaterialFile(
    taskId: string,
    materialId: string,
    version: number,
  ): { storageKey: string; mediaType: string; originalFileName: string } | undefined {
    const row = this.database
      .prepare<
        [string, string, number],
        { storage_key: string; media_type: string; original_file_name: string }
      >(
        `
      SELECT version.storage_key, version.media_type, version.original_file_name
      FROM review_materials AS material JOIN review_material_versions AS version ON version.material_id = material.id
      WHERE material.task_id = ? AND material.id = ? AND version.version = ?
    `,
      )
      .get(taskId, materialId, version);
    return row
      ? {
          storageKey: row.storage_key,
          mediaType: row.media_type,
          originalFileName: row.original_file_name,
        }
      : undefined;
  }

  listMaterials(taskId: string, includeHistory = false): ReviewMaterialSummary[] {
    const rows = this.database
      .prepare<[number, string], DatabaseMaterialRow>(
        `
        SELECT material.id,
               material_version.version,
               material_version.original_file_name,
               material_version.media_type,
               material_version.extension,
               material_version.file_size_bytes,
               material_version.sha256,
               material_version.parse_status,
               material_version.parser_name,
               material_version.extracted_text,
               material_version.page_count,
               material_version.sheet_names_json,
               material_version.parse_message,
               material_version.page_coverage_json,
               material_version.revision_json,
               material_version.classification_json,
               material_version.created_at
        FROM review_materials AS material
        JOIN (
          SELECT material_id, MAX(version) AS version
          FROM review_material_versions
          GROUP BY material_id
        ) AS latest ON latest.material_id = material.id
        JOIN review_material_versions AS material_version
          ON material_version.material_id = material.id AND (? = 1 OR material_version.version = latest.version)
        WHERE material.task_id = ?
        ORDER BY material.created_at DESC, material.id
      `,
      )
      .all(includeHistory ? 1 : 0, taskId);

    return rows.map((row) => {
      if (!isMaterialParseStatus(row.parse_status)) {
        throw new Error("Saved material has an invalid parse status");
      }
      const segments = this.database
        .prepare<[string, number], DatabaseMaterialSegmentRow>(
          `
          SELECT segment_index, text, start_offset, end_offset, location, region_json
          FROM review_material_segments
          WHERE material_id = ? AND material_version = ?
          ORDER BY segment_index ASC
        `,
        )
        .all(row.id, row.version);

      return {
        id: row.id,
        version: row.version,
        originalFileName: row.original_file_name,
        mediaType: row.media_type,
        extension: row.extension,
        fileSizeBytes: row.file_size_bytes,
        sha256: row.sha256,
        parseStatus: row.parse_status,
        parserName: row.parser_name,
        extractedText: row.extracted_text,
        segments: segments.map((segment) => ({
          segmentIndex: segment.segment_index,
          text: segment.text,
          startOffset: segment.start_offset,
          endOffset: segment.end_offset,
          location: segment.location,
          ...(segment.region_json !== "null"
            ? {
                region: JSON.parse(segment.region_json) as NonNullable<
                  MaterialContentSegment["region"]
                >,
              }
            : {}),
        })),
        pageCount: row.page_count,
        sheetNames: parseJsonStringArray(row.sheet_names_json),
        parseMessage: row.parse_message,
        pageCoverage: JSON.parse(row.page_coverage_json) as MaterialPageCoverage[],
        revision: (JSON.parse(row.revision_json) as MaterialRevision | null) ?? undefined,
        classification:
          (JSON.parse(row.classification_json) as MaterialClassification | null) ?? undefined,
        createdAt: row.created_at,
      };
    });
  }

  saveReviewExecution(execution: ReviewExecution): ReviewExecution {
    const ruleSet = this.database
      .prepare<[string, string], { task_id: string; source_version: number }>(
        "SELECT task_id, source_version FROM requirement_rule_sets WHERE id = ? AND task_id = ?",
      )
      .get(execution.ruleSetId, execution.taskId);
    if (!ruleSet || ruleSet.source_version !== execution.sourceVersion) {
      throw new Error("Review execution must reference a rule set belonging to this task");
    }
    const currentMaterials = this.listMaterials(execution.taskId).map(({ id, version }) => ({
      materialId: id,
      version,
    }));
    if (JSON.stringify(currentMaterials) !== JSON.stringify(execution.materialSnapshot)) {
      throw new Error("Review execution material snapshot is stale");
    }
    const sourceTask = this.getTask(execution.taskId);
    const saveSnapshot = this.database.transaction(() => {
      this.database
        .prepare(
          `
      INSERT INTO review_executions (
        id, task_id, rule_set_id, source_version, status, unexecuted_count,
        material_snapshot_json, results_json, created_at, completed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          execution.id,
          execution.taskId,
          execution.ruleSetId,
          execution.sourceVersion,
          execution.status,
          execution.unexecutedCount,
          JSON.stringify(execution.materialSnapshot),
          JSON.stringify(execution.results),
          execution.createdAt,
          execution.completedAt,
          JSON.stringify(execution.metadata ?? {}),
        );
      if (sourceTask) {
        const insertSource = this.database.prepare(
          "INSERT INTO execution_source_snapshots (execution_id, source_id, version, display_name, source_url, segments_json) VALUES (?, ?, ?, ?, ?, ?)",
        );
        for (const source of [sourceTask.noticeSource, ...sourceTask.supplementalSources]) {
          insertSource.run(
            execution.id,
            source.id,
            source.version,
            source.displayName,
            source.sourceUrl ?? null,
            JSON.stringify(source.segments),
          );
        }
      }
    });
    saveSnapshot();
    return execution;
  }

  getExecutionSource(
    taskId: string,
    executionId: string,
    sourceId: string,
    version: number,
    offset: number,
  ):
    | {
        displayName: string;
        sourceUrl: string | null;
        version: number;
        totalSegments: number;
        segments: RequirementSourceSegment[];
      }
    | undefined {
    const row = this.database
      .prepare<
        [string, string, string, number],
        { display_name: string; source_url: string | null; segments_json: string }
      >(
        `
      SELECT snapshot.display_name, snapshot.source_url, snapshot.segments_json
      FROM execution_source_snapshots AS snapshot JOIN review_executions AS execution ON execution.id = snapshot.execution_id
      WHERE execution.task_id = ? AND execution.id = ? AND snapshot.source_id = ? AND snapshot.version = ?
    `,
      )
      .get(taskId, executionId, sourceId, version);
    if (row) {
      const segments = JSON.parse(row.segments_json) as RequirementSourceSegment[];
      return {
        displayName: row.display_name,
        sourceUrl: row.source_url,
        version,
        totalSegments: segments.length,
        segments: segments
          .slice(offset, offset + 5)
          .map((segment) => ({ ...segment, text: segment.text.slice(0, 16000) })),
      };
    }
    // Older executions can still use an available source, but only if the rule snapshot references it.
    const execution = this.listReviewExecutions(taskId).find((item) => item.id === executionId);
    const rules = this.listRuleSets(taskId).find((item) => item.id === execution?.ruleSetId);
    if (
      !rules?.rules.some(
        (rule) => rule.source.sourceId === sourceId && rule.source.sourceVersion === version,
      )
    )
      return undefined;
    const task = this.getTask(taskId);
    const source = [...(task?.noticeHistory ?? []), ...(task?.supplementalSources ?? [])].find(
      (item) => item.id === sourceId && item.version === version,
    );
    return source
      ? {
          displayName: source.displayName,
          sourceUrl: source.sourceUrl ?? null,
          version,
          totalSegments: source.segments.length,
          segments: source.segments
            .slice(offset, offset + 5)
            .map((segment) => ({ ...segment, text: segment.text.slice(0, 16000) })),
        }
      : undefined;
  }

  appendReviewExecutionResult(
    executionId: string,
    result: ReviewExecution["results"][number],
    metadata?: ReviewExecution["metadata"],
  ): void {
    const append = this.database.transaction(() => {
      const row = this.database
        .prepare<[string], { status: string; results_json: string }>(
          "SELECT status, results_json FROM review_executions WHERE id = ?",
        )
        .get(executionId);
      if (!row || row.status !== "running") throw new Error("Review execution is not running");
      const results = JSON.parse(row.results_json) as ReviewExecution["results"];
      results.push(result);
      this.database
        .prepare(
          "UPDATE review_executions SET results_json = ?, unexecuted_count = MAX(0, unexecuted_count - 1), metadata_json = COALESCE(?, metadata_json) WHERE id = ? AND status = 'running'",
        )
        .run(JSON.stringify(results), metadata ? JSON.stringify(metadata) : null, executionId);
    });
    append();
  }

  finishReviewExecution(
    executionId: string,
    status: Exclude<ReviewExecution["status"], "running">,
    unexecutedCount: number,
    completedAt: string,
    metadata?: ReviewExecution["metadata"],
  ): void {
    this.database
      .prepare(
        `
        UPDATE review_executions
        SET status = ?, unexecuted_count = ?, completed_at = ?, metadata_json = COALESCE(?, metadata_json)
        WHERE id = ? AND status = 'running'
      `,
      )
      .run(
        status,
        unexecutedCount,
        completedAt,
        metadata ? JSON.stringify(metadata) : null,
        executionId,
      );
  }

  listReviewExecutions(taskId: string): ReviewExecution[] {
    const rows = this.database
      .prepare<[string], DatabaseExecutionRow>(
        `
        SELECT id, task_id, rule_set_id, source_version, status, unexecuted_count, material_snapshot_json,
               results_json, created_at, completed_at, metadata_json
        FROM review_executions WHERE task_id = ? ORDER BY created_at DESC
      `,
      )
      .all(taskId);
    const listResolutions = this.database.prepare<
      [string],
      {
        rule_id: string;
        decision: HumanResolution["decision"];
        note: string;
        updated_at: string;
      }
    >(
      "SELECT rule_id, decision, note, updated_at FROM review_human_resolutions WHERE execution_id = ?",
    );
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      ruleSetId: row.rule_set_id,
      sourceVersion: row.source_version,
      status: row.status as ReviewExecution["status"],
      unexecutedCount: row.unexecuted_count,
      materialSnapshot: JSON.parse(
        row.material_snapshot_json,
      ) as ReviewExecution["materialSnapshot"],
      results: JSON.parse(row.results_json) as ReviewExecution["results"],
      createdAt: row.created_at,
      completedAt: row.completed_at,
      metadata:
        row.metadata_json === "{}"
          ? undefined
          : (JSON.parse(row.metadata_json) as ReviewExecution["metadata"]),
      humanResolutions: listResolutions.all(row.id).map((resolution) => ({
        ruleId: resolution.rule_id,
        decision: resolution.decision,
        note: resolution.note,
        updatedAt: resolution.updated_at,
      })),
    }));
  }

  saveHumanResolution(input: {
    taskId: string;
    executionId: string;
    ruleId: string;
    decision: HumanResolution["decision"];
    note: string;
    updatedAt: string;
  }): HumanResolution | undefined {
    const execution = this.database
      .prepare<[string, string], { results_json: string; status: string }>(
        "SELECT results_json, status FROM review_executions WHERE id = ? AND task_id = ?",
      )
      .get(input.executionId, input.taskId);
    if (!execution || execution.status === "running") return undefined;
    const results = JSON.parse(execution.results_json) as ReviewExecution["results"];
    if (!results.some((result) => result.ruleId === input.ruleId)) return undefined;
    this.database
      .prepare(
        `
      INSERT INTO review_human_resolutions (execution_id, rule_id, decision, note, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (execution_id, rule_id) DO UPDATE SET
        decision = excluded.decision, note = excluded.note, updated_at = excluded.updated_at
    `,
      )
      .run(input.executionId, input.ruleId, input.decision, input.note, input.updatedAt);
    return {
      ruleId: input.ruleId,
      decision: input.decision,
      note: input.note,
      updatedAt: input.updatedAt,
    };
  }

  listRemediationTasks(taskId: string): RemediationTask[] {
    return this.database
      .prepare<
        [string],
        { payload_json: string; status: RemediationTask["status"]; updated_at: string }
      >(
        "SELECT payload_json, status, updated_at FROM review_remediation_tasks WHERE task_id = ? ORDER BY updated_at DESC",
      )
      .all(taskId)
      .map((row) => ({
        ...(JSON.parse(row.payload_json) as RemediationTask),
        status: row.status,
        updatedAt: row.updated_at,
      }));
  }

  createRemediationTask(
    taskId: string,
    executionId: string,
    ruleId: string,
    createdAt: string,
  ): RemediationTask | undefined {
    const execution = this.database
      .prepare<[string, string], { status: string; results_json: string }>(
        "SELECT status, results_json FROM review_executions WHERE id = ? AND task_id = ?",
      )
      .get(executionId, taskId);
    if (!execution || execution.status === "running") return undefined;
    const result = (JSON.parse(execution.results_json) as ReviewExecution["results"]).find(
      (candidate) => candidate.ruleId === ruleId,
    );
    if (!result || result.strength !== "required" || result.verdict !== "failed") return undefined;
    const todo: RemediationTask = {
      id: randomUUID(),
      taskId,
      executionId,
      ruleId,
      ruleCode: result.ruleCode,
      requirement: result.requirement,
      reason: result.reason,
      recommendation: result.recommendation,
      sourceQuote: result.source.quotedText,
      materialIds: [...new Set(result.evidence.map((evidence) => evidence.materialId))],
      status: "open",
      createdAt,
      updatedAt: createdAt,
    };
    this.database
      .prepare(
        "INSERT OR IGNORE INTO review_remediation_tasks (id, task_id, execution_id, rule_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        todo.id,
        taskId,
        executionId,
        ruleId,
        todo.status,
        JSON.stringify(todo),
        createdAt,
        createdAt,
      );
    const row = this.database
      .prepare<
        [string, string],
        { payload_json: string; status: RemediationTask["status"]; updated_at: string }
      >(
        "SELECT payload_json, status, updated_at FROM review_remediation_tasks WHERE execution_id = ? AND rule_id = ?",
      )
      .get(executionId, ruleId);
    return row
      ? {
          ...(JSON.parse(row.payload_json) as RemediationTask),
          status: row.status,
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  updateRemediationStatus(
    taskId: string,
    remediationId: string,
    status: RemediationTask["status"],
    updatedAt: string,
  ): RemediationTask | undefined {
    const row = this.database
      .prepare<[string, string], { payload_json: string }>(
        "SELECT payload_json FROM review_remediation_tasks WHERE id = ? AND task_id = ?",
      )
      .get(remediationId, taskId);
    if (!row) return undefined;
    this.database
      .prepare(
        "UPDATE review_remediation_tasks SET status = ?, updated_at = ? WHERE id = ? AND task_id = ?",
      )
      .run(status, updatedAt, remediationId, taskId);
    return { ...(JSON.parse(row.payload_json) as RemediationTask), status, updatedAt };
  }

  removeUserGrants(userId: string): void {
    this.database.prepare("DELETE FROM task_grants WHERE user_id=?").run(userId);
  }

  taskOwner(taskId: string): string | undefined {
    return this.database
      .prepare<[string], { owner_id: string }>("SELECT owner_id FROM review_tasks WHERE id = ?")
      .get(taskId)?.owner_id;
  }
  canAccessTask(taskId: string, userId: string): boolean {
    return (
      this.taskOwner(taskId) === userId ||
      Boolean(
        this.database
          .prepare("SELECT 1 FROM task_grants WHERE task_id = ? AND user_id = ?")
          .get(taskId, userId),
      )
    );
  }
  taskGrants(taskId: string): string[] {
    return this.database
      .prepare<[string], { user_id: string }>(
        "SELECT user_id FROM task_grants WHERE task_id = ? ORDER BY user_id",
      )
      .all(taskId)
      .map((row) => row.user_id);
  }
  setTaskGrant(taskId: string, userId: string, enabled: boolean): void {
    if (enabled)
      this.database
        .prepare("INSERT OR IGNORE INTO task_grants (task_id,user_id) VALUES (?,?)")
        .run(taskId, userId);
    else
      this.database
        .prepare("DELETE FROM task_grants WHERE task_id = ? AND user_id = ?")
        .run(taskId, userId);
  }

  assignRemediation(
    taskId: string,
    remediationId: string,
    assignee: string,
    note: string,
  ): RemediationTask | undefined {
    const todo = this.listRemediationTasks(taskId).find((item) => item.id === remediationId);
    if (!todo) return undefined;
    const now = new Date().toISOString();
    const updated: RemediationTask = {
      ...todo,
      assignee,
      updatedAt: now,
      assignmentHistory: [...(todo.assignmentHistory ?? []), { assignee, note, at: now }].slice(
        -100,
      ),
    };
    this.database
      .prepare(
        "UPDATE review_remediation_tasks SET payload_json = ?, updated_at = ? WHERE id = ? AND task_id = ?",
      )
      .run(JSON.stringify(updated), now, remediationId, taskId);
    return updated;
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

  if (
    existingContext?.databaseDirectory === databaseDirectory &&
    existingContext.database.open &&
    existingContext.database.pragma("user_version", { simple: true }) === DATABASE_SCHEMA_VERSION
  ) {
    return new ReviewStore(existingContext.database);
  }

  if (existingContext?.database.open) {
    existingContext.database.close();
  }

  const database = createReviewDatabase(databaseDirectory);
  reviewGlobals.__materialReviewDatabase = { databaseDirectory, database };
  return new ReviewStore(database);
}
