import { z } from "zod";

export const modelCallSchema = z.object({
  operation: z.enum(["connection_test", "rule_extraction", "material_review"]),
  provider: z.string().max(120),
  model: z.string().max(120),
  startedAt: z.string(),
  completedAt: z.string(),
  status: z.enum(["completed", "failed"]),
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  requestCount: z.number().int().nonnegative(),
  errorCode: z.string().max(80),
});

export type ModelCall = z.infer<typeof modelCallSchema>;
