import { z } from "zod";

export const prepDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    "日期无效",
  );
const optionalDate = z.union([prepDate, z.literal("")]);
export const prepStageSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    start: optionalDate,
    end: optionalDate,
  })
  .strict()
  .refine(
    (stage) => !stage.start || !stage.end || stage.start <= stage.end,
    "阶段结束日期早于开始日期",
  );
export const prepTaskSchema = z
  .object({
    id: z.string().uuid(),
    stageId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    date: optionalDate,
    minutes: z.number().int().min(0).max(720),
    actualMinutes: z.number().int().min(0).max(1440).nullable(),
    doneOn: optionalDate,
    resourceId: z.string().max(100),
    resourceVersion: z.number().int().positive().optional(),
    locked: z.boolean(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export const prepAssessmentSchema = z
  .object({
    id: z.string().uuid(),
    date: prepDate,
    name: z.string().trim().min(1).max(100),
    source: z.string().trim().min(1).max(200),
    system: z.string().trim().min(1).max(100),
    scores: z
      .array(
        z
          .object({
            dimension: z.string().trim().min(1).max(60),
            score: z.number().min(0),
            maximum: z.number().positive().max(10000),
          })
          .strict()
          .refine((score) => score.score <= score.maximum, "得分不能超过满分"),
      )
      .min(1)
      .max(12)
      .refine(
        (scores) => new Set(scores.map((item) => item.dimension)).size === scores.length,
        "维度不能重复",
      ),
  })
  .strict();
export const planItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    date: prepDate,
    minutes: z.number().int().min(1).max(720),
    resourceId: z.string().max(100).default(""),
  })
  .strict();
export const planOutputSchema = z
  .object({ reason: z.string().max(1000), items: z.array(planItemSchema).min(1).max(35) })
  .strict();
export type PrepStage = z.infer<typeof prepStageSchema>;
export type PrepTask = z.infer<typeof prepTaskSchema>;
export type PrepAssessment = z.infer<typeof prepAssessmentSchema>;
export interface PrepDraft extends z.infer<typeof planOutputSchema> {
  id: string;
  mode: "mock" | "live";
  minutes: number;
  dates: string[];
  createdAt: string;
  adopted: boolean;
}
export interface PrepState {
  revision: number;
  stages: PrepStage[];
  tasks: PrepTask[];
  assessments: PrepAssessment[];
  drafts: PrepDraft[];
  history: { id: string; at: string; tasks: PrepTask[]; afterTasks: PrepTask[]; undone: boolean }[];
}
export const prepMutationSchema = z
  .object({
    goalId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    command: z.discriminatedUnion("action", [
      z
        .object({
          action: z.literal("template"),
          start: prepDate.optional(),
          end: prepDate.optional(),
        })
        .strict(),
      z
        .object({
          action: z.literal("stage"),
          stage: prepStageSchema,
          position: z.number().int().min(0).max(20),
        })
        .strict(),
      z.object({ action: z.literal("removeStage"), id: z.string().uuid() }).strict(),
      z.object({ action: z.literal("task"), task: prepTaskSchema }).strict(),
      z.object({ action: z.literal("removeTask"), id: z.string().uuid() }).strict(),
      z.object({ action: z.literal("assessment"), assessment: prepAssessmentSchema }).strict(),
      z.object({ action: z.literal("removeAssessment"), id: z.string().uuid() }).strict(),
      z
        .object({
          action: z.literal("draft"),
          draft: z
            .object({ id: z.string().uuid(), items: z.array(planItemSchema).min(1).max(35) })
            .strict(),
        })
        .strict(),
      z
        .object({
          action: z.literal("adopt"),
          draftId: z.string().uuid(),
          replace: z.boolean(),
          selected: z.array(z.number().int().min(0).max(34)).min(1).max(35),
        })
        .strict(),
      z.object({ action: z.literal("undo"), id: z.string().uuid() }).strict(),
    ]),
  })
  .strict();
export const prepPlanSchema = z
  .object({
    goalId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    requestId: z.string().uuid(),
    minutes: z.number().int().min(5).max(720),
    dates: z
      .array(prepDate)
      .min(1)
      .max(7)
      .refine((dates) => new Set(dates).size === dates.length, "日期不能重复"),
    preference: z.string().trim().max(1000),
  })
  .strict();
