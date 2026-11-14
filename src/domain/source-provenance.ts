import { z } from "zod";
const fields = {
  organizer: z.string().trim().min(1).max(200),
  relationship: z.enum(["主办机构", "受托承办", "官方信息发布", "待核实"]),
  referenceUrl: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port;
    }, "依据须为不含凭据的公开HTTPS地址。"),
  quote: z.string().trim().min(10).max(2000),
  result: z.enum(["已核对", "待核实"]),
};
export const sourceProvenanceInputSchema = z
  .object(fields)
  .strict()
  .refine(
    (value) => value.result !== "已核对" || value.relationship !== "待核实",
    "组织关系未知时不能标记已核对。",
  );
export const sourceProvenanceSchema = z
  .object({ ...fields, checkedAt: z.string().datetime() })
  .strict();
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;
