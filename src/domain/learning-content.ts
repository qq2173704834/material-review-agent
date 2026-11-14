import { z } from "zod";
import { EXAM_CATEGORIES, EXAM_REGIONS } from "./exam-catalog";
export const learningContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(EXAM_CATEGORIES.map((item) => item[0])),
    region: z.enum(EXAM_REGIONS).default("全国"),
    edition: z.string().trim().max(80).default(""),
    subject: z.string().trim().max(120).default(""),
    kind: z.enum(["resource", "knowledge", "school"]),
    format: z.enum(["考纲", "课程", "资料", "练习", "资讯"]).default("资料"),
    studyStage: z.enum(["通用", "入门", "基础", "强化", "冲刺"]).default("通用"),
    author: z.string().trim().min(1).max(200),
    url: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port;
      }, "来源必须为不含凭据的HTTPS地址。"),
    text: z.string().trim().min(1).max(30000),
    summary: z.string().trim().max(1000).default(""),
    language: z.string().trim().min(1).max(40).default("中文"),
    fee: z.enum(["免费", "付费", "未知"]).default("未知"),
    permission: z.enum(["仅链接", "允许转载", "自有原创"]).default("仅链接"),
    checkedAt: z.string().date(),
    scope: z.string().trim().min(1).max(1000),
    reviewNote: z.string().trim().max(1000).default(""),
    disposition: z.enum(["现行", "历史", "暂停", "停办", "待核实"]).default("待核实"),
  })
  .strict();
export type LearningContent = z.infer<typeof learningContentSchema>;
export interface ContentEntry {
  id: string;
  version: number;
  status: string;
  updatedAt: string;
  history?: Array<{ version: number; created_at: string }>;
  content: LearningContent;
}
