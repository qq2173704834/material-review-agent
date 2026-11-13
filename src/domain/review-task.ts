import { z } from "zod";

export const MAXIMUM_NOTICE_CHARACTERS = 200_000;

export const reviewTaskIdSchema = z.string().uuid();

const taskBackgroundSchema = z
  .object({
    conditionAnswers: z
      .array(
        z
          .object({
            condition: z.string().trim().min(1).max(500),
            applies: z.boolean(),
            note: z.string().trim().max(500),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (answers) => new Set(answers.map((answer) => answer.condition)).size === answers.length,
        "同一条件不能保存重复答案。",
      )
      .optional(),
    projectType: z.string().trim().max(80).optional().default(""),
    projectStage: z.string().trim().max(80).optional().default(""),
    collaborationScope: z.enum(["individual", "team", "unknown"]).optional().default("unknown"),
  })
  .strict()
  .optional()
  .default({ projectType: "", projectStage: "", collaborationScope: "unknown" });

export const reviewTaskInputSchema = z
  .object({
    name: z.string().trim().max(120).optional().default(""),
    description: z.string().trim().max(2_000).optional().default(""),
    background: taskBackgroundSchema,
    noticeText: z
      .string()
      .max(MAXIMUM_NOTICE_CHARACTERS)
      .refine((noticeText) => noticeText.trim().length > 0, "请填写通知或项目要求的原文。"),
  })
  .strict();

export type ReviewTaskInput = z.infer<typeof reviewTaskInputSchema>;
