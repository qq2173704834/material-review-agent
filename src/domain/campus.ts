import { z } from "zod";

export const CAMPUS_KINDS = ["考试", "作业", "课程报告", "报名", "活动", "其他"] as const;
export const campusDateSchema = z.string().refine((value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/u.test(value)) return false;
  const date = value.slice(0, 10);
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    return false;
  return value.length === 10 || (Number(value.slice(11, 13)) < 24 && Number(value.slice(14)) < 60);
}, "请填写有效日期和时间。");
export const campusEventSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    kind: z.enum(CAMPUS_KINDS),
    course: z.string().trim().max(100).default(""),
    semester: z.string().trim().max(60).default(""),
    start: campusDateSchema,
    end: campusDateSchema,
    location: z.string().trim().max(200).default(""),
    note: z.string().max(5000).default(""),
    sourceUrl: z.union([z.literal(""), z.url().refine((url) => /^https?:/u.test(url))]).default(""),
    sourceId: z.string().max(100).default(""),
    sourceDigest: z.string().max(64).default(""),
    sourceNodeKey: z.string().max(200).optional(),
    resourceIds: z
      .array(z.string().regex(/^[a-f0-9-]{32,36}$/u))
      .max(5)
      .default([]),
    done: z.boolean().default(false),
    reminderHours: z.union([z.literal(0), z.literal(2), z.literal(24), z.literal(72)]).default(24),
  })
  .strict()
  .refine(
    (event) => !event.end || !event.start || event.end >= event.start,
    "结束时间不能早于开始时间。",
  );
export type CampusEvent = z.infer<typeof campusEventSchema>;
export const campusPreferencesSchema = z
  .object({
    schoolId: z.string().max(80),
    department: z.string().trim().max(100),
    grade: z.string().trim().max(50),
    interests: z.array(z.string().max(30)).max(10),
  })
  .strict();
export type CampusPreferences = z.infer<typeof campusPreferencesSchema>;
export interface CampusNotice {
  id: string;
  schoolId: string;
  department: string;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
  category: string;
  digest: string;
  updatedAt: string;
  withdrawn?: boolean;
  relatedUrls?: string[];
}
export interface CampusState {
  revision: number;
  preferences: CampusPreferences;
  events: CampusEvent[];
  reads: Record<string, string>;
  favorites: string[];
  reminderReads: string[];
}
export const campusMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preferences"),
      expectedRevision: z.number().int().nonnegative(),
      preferences: campusPreferencesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      expectedRevision: z.number().int().nonnegative(),
      events: z.array(campusEventSchema).min(1).max(30),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      expectedRevision: z.number().int().nonnegative(),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      expectedRevision: z.number().int().nonnegative(),
      id: z.string().max(100),
      digest: z.string().max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal("favorite"),
      expectedRevision: z.number().int().nonnegative(),
      id: z.string().max(100),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reminder-read"),
      expectedRevision: z.number().int().nonnegative(),
      key: z.string().max(200),
    })
    .strict(),
]);
