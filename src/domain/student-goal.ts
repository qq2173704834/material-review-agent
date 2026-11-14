import { z } from "zod";
import { EXAM_CATEGORIES, EXAM_REGIONS } from "./exam-catalog";
export const goalInputSchema = z
  .object({
    category: z.enum(EXAM_CATEGORIES.map((item) => item[0])),
    region: z.enum(EXAM_REGIONS),
    edition: z.string().trim().max(80).default("待确认考期"),
    subject: z.string().trim().max(120).default(""),
    state: z.enum(["active", "paused", "archived"]).default("active"),
    foundation: z.string().trim().max(200).default(""),
    studyStage: z.string().trim().max(80).default("入门"),
    minutesPerDay: z.number().int().min(0).max(720).default(0),
    targetScore: z.string().trim().max(80).default(""),
    formats: z
      .array(z.enum(["考纲", "课程", "资料", "练习", "资讯"]))
      .max(5)
      .default([]),
    education: z.string().trim().max(120).default(""),
    progress: z.string().trim().max(1000).default(""),
    noticeId: z.string().uuid().optional(),
  })
  .strict();
export type GoalInput = z.infer<typeof goalInputSchema>;
export interface StudentGoal extends GoalInput {
  id: string;
  updatedAt: string;
  autoReview: boolean;
  taskId: string | null;
  noticeVersion: number | null;
}
