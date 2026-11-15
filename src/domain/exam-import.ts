import { z } from "zod";
export const examImportOptionSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  candidates: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      region: z.string(),
      edition: z.string(),
      version: z.number().int(),
    }),
  ),
});
export const examImportPreviewSchema = z.object({
  selection: z.string(),
  id: z.string().uuid(),
  version: z.number().int(),
  title: z.string(),
  region: z.string(),
  edition: z.string(),
  url: z.string(),
  text: z.string(),
  scope: z.string(),
  usable: z.boolean(),
  warning: z.string(),
  existingTaskId: z.string().uuid().nullable(),
});
export type ExamImportOption = z.infer<typeof examImportOptionSchema>;
export type ExamImportPreview = z.infer<typeof examImportPreviewSchema>;
