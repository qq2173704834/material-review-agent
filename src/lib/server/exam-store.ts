import officialSourceProvenance from "@/domain/official-source-provenance.json";
import { EXAM_PORTALS } from "@/domain/exam-portals";
import provincialSources from "@/domain/provincial-exam-sources.json";
import "server-only";
import { examTimeline, unrecordedExamDates } from "@/lib/exam-timeline";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EXAM_CATEGORIES, EXAM_REGIONS, EXAM_STAGES, TIMELINE_LABELS } from "@/domain/exam-catalog";
import { digest } from "./account-auth";
import { platformDb, securityEvent } from "./platform-db";
import { sourceProvenanceSchema, type SourceProvenance } from "@/domain/source-provenance";
export const noticeInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    category: z.enum(EXAM_CATEGORIES.map((item) => item[0])),
    categories: z
      .array(z.enum(EXAM_CATEGORIES.map((item) => item[0])))
      .max(8)
      .refine((items) => new Set(items).size === items.length, "关联考试不能重复。")
      .optional(),
    levels: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    subjects: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    examForms: z
      .array(z.enum(["笔试", "口试", "面试", "机考", "实操", "材料评审"]))
      .max(6)
      .optional(),
    region: z.enum(EXAM_REGIONS),
    edition: z.string().trim().min(1).max(80),
    year: z.number().int().min(2000).max(2100),
    stage: z.enum(EXAM_STAGES),
    organizer: z.string().trim().min(1).max(200),
    publishedAt: z.string().max(40),
    text: z.string().trim().min(1).max(200000),
    textScope: z.enum(["全文", "摘录"]).optional(),
    summary: z.string().max(10000).default(""),
    audience: z.string().max(3000).default(""),
    timeline: z
      .array(
        z
          .object({
            label: z.enum(TIMELINE_LABELS),
            value: z.string().max(40),
            endValue: z.string().max(40).optional(),
            quote: z.string().max(2000),
          })
          .strict(),
      )
      .max(TIMELINE_LABELS.length)
      .default([]),
    attachments: z
      .array(
        z
          .object({
            url: z.url().max(2048),
            name: z.string().min(1).max(200),
            status: z.enum(["仅官方链接，未读取", "已读取", "获取失败", "部分读取"]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    relatedId: z.string().uuid().optional(),
    disposition: z.enum(["正常", "延期", "取消", "待核实"]).default("待核实"),
  })
  .strict();
export type NoticeContent = z.infer<typeof noticeInputSchema>;
export interface ExamSource {
  id: string;
  name: string;
  url: string;
  category: string;
  region: string;
  enabled: number;
  interval_hours: number;
  last_success: string | null;
  last_attempt: string | null;
  next_run: number;
  error: string | null;
  failures: number;
  provenance?: SourceProvenance;
}
export interface ExamNotice {
  id: string;
  source_id: string;
  canonical_url: string;
  status: string;
  published_version: number | null;
  version: number;
  content: NoticeContent;
  created_at: string;
  source_name: string;
  last_success: string | null;
}
const initialSources = [
  ["cet4", "大学英语四六级考试官网", "https://cet.neea.edu.cn/"],
  ["ncre", "全国计算机等级考试官网", "https://ncre.neea.edu.cn/"],
  ["teacher", "中小学教师资格考试官网", "https://ntce.neea.edu.cn/"],
  ["graduate", "中国研究生招生信息网", "https://yz.chsi.com.cn/"],
  [
    "jlpt",
    "教育部教育考试院日本语能力测试",
    "https://www.neea.edu.cn/html1/folder/19093/4844-1.htm",
  ],
  ["pets", "中国教育考试网（综合考试入口）", "https://www.neea.edu.cn/"],
  ...EXAM_PORTALS.filter((portal) => portal.collectionMode === "candidate").map(
    (portal) => [portal.category, portal.name, portal.url] as const,
  ),
] as const;
function reviewedSourceProvenance(url: string): SourceProvenance | undefined {
  const record = officialSourceProvenance.results.find((entry) => entry.sourceUrl === url);
  if (!record?.verified) return undefined;
  const parsed = sourceProvenanceSchema.safeParse(record.provenance);
  return parsed.success ? parsed.data : undefined;
}
export function sources(): ExamSource[] {
  const db = platformDb();
  for (const [category, name, url] of initialSources)
    db.prepare(
      "INSERT OR IGNORE INTO exam_sources(id,name,url,category,region) VALUES (?,?,?,?,?)",
    ).run(digest(url).slice(0, 24), name, url, category, "全国");
  for (const source of provincialSources.filter((s) => s.status === "accessible"))
    db.prepare(
      "INSERT OR IGNORE INTO exam_sources(id,name,url,category,region) VALUES (?,?,?,?,?)",
    ).run(
      digest(source.url).slice(0, 24),
      source.name,
      source.url,
      "education-local",
      source.region,
    );
  const proofs = new Map(
    db
      .prepare<[], { key: string; value: string }>(
        "SELECT key,value FROM portal_settings WHERE key LIKE 'source-proof:%'",
      )
      .all()
      .flatMap((row) => {
        try {
          const proof = sourceProvenanceSchema.safeParse(JSON.parse(row.value));
          return proof.success
            ? [[row.key.slice("source-proof:".length), proof.data] as const]
            : [];
        } catch {
          return [];
        }
      }),
  );
  return db
    .prepare<[], ExamSource>("SELECT * FROM exam_sources ORDER BY name")
    .all()
    .map((source) => ({
      ...source,
      ...(proofs.has(source.id)
        ? { provenance: proofs.get(source.id) }
        : reviewedSourceProvenance(source.url)
          ? { provenance: reviewedSourceProvenance(source.url) }
          : {}),
    }));
}
export function sourceById(id: string): ExamSource | undefined {
  return sources().find((item) => item.id === id);
}
export function officialUrl(raw: string, source: ExamSource): string {
  const url = new URL(raw);
  const base = new URL(source.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname !== base.hostname
  )
    throw new Error("公告和附件必须使用所选来源相同主机的HTTPS地址；跨站官方附件需单独登记来源。");
  url.hash = "";
  return url.toString();
}
function mapNotice(row: Omit<ExamNotice, "content"> & { payload: string }): ExamNotice {
  return { ...row, content: noticeInputSchema.parse(JSON.parse(row.payload)) };
}
export function notice(id: string, publicOnly = true): ExamNotice | undefined {
  const row = platformDb()
    .prepare<[number, string], Omit<ExamNotice, "content"> & { payload: string }>(
      `SELECT n.*,v.version,v.payload,v.created_at,s.name AS source_name,s.last_success FROM exam_notices n JOIN exam_sources s ON s.id=n.source_id JOIN exam_notice_versions v ON v.notice_id=n.id AND v.version=CASE WHEN ?=1 THEN n.published_version ELSE (SELECT MAX(version) FROM exam_notice_versions WHERE notice_id=n.id) END WHERE n.id=?`,
    )
    .get(publicOnly ? 1 : 0, id);
  if (!row || (publicOnly && row.status !== "published")) return undefined;
  return mapNotice(row);
}
export function noticeHistory(
  id: string,
): Array<{ version: number; content: NoticeContent; created_at: string; actor: string }> {
  return platformDb()
    .prepare<[string], { version: number; payload: string; created_at: string; actor: string }>(
      "SELECT * FROM exam_notice_versions WHERE notice_id=? ORDER BY version DESC LIMIT 100",
    )
    .all(id)
    .map((row) => ({ ...row, content: noticeInputSchema.parse(JSON.parse(row.payload)) }));
}
export function noticeVersion(
  id: string,
  version: number,
): { version: number; content: NoticeContent; created_at: string; actor: string } | undefined {
  const row = platformDb()
    .prepare<
      [string, number],
      { version: number; payload: string; created_at: string; actor: string }
    >(
      "SELECT version,payload,created_at,actor FROM exam_notice_versions WHERE notice_id=? AND version=?",
    )
    .get(id, version);
  return row ? { ...row, content: noticeInputSchema.parse(JSON.parse(row.payload)) } : undefined;
}
export function listNotices(admin = false): ExamNotice[] {
  const ids = platformDb()
    .prepare<[], { id: string }>("SELECT id FROM exam_notices ORDER BY created_at DESC")
    .all();
  return ids.flatMap((row) => {
    const item = notice(row.id, !admin);
    return item ? [item] : [];
  });
}
export function saveDraft(
  sourceId: string,
  url: string,
  content: NoticeContent,
  actor: string,
): { id: string; changed: boolean } {
  const source = sourceById(sourceId);
  if (!source) throw new Error("请选择登记来源。");
  const canonical = officialUrl(url, source);
  for (const attachment of content.attachments) officialUrl(attachment.url, source);
  if (content.relatedId && !notice(content.relatedId, false)) throw new Error("关联公告不存在。");
  const db = platformDb();
  const payload = JSON.stringify(content);
  const hash = digest(payload);
  return db.transaction(() => {
    const existing = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM exam_notices WHERE source_id=? AND canonical_url=?",
      )
      .get(sourceId, canonical);
    const id = existing?.id ?? randomUUID();
    if (!existing)
      db.prepare(
        "INSERT INTO exam_notices(id,source_id,canonical_url,created_at) VALUES (?,?,?,?)",
      ).run(id, sourceId, canonical, new Date().toISOString());
    const latest = db
      .prepare<[string], { version: number; digest: string }>(
        "SELECT version,digest FROM exam_notice_versions WHERE notice_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(id);
    if (latest?.digest === hash) return { id, changed: false };
    db.prepare(
      "INSERT INTO exam_notice_versions(notice_id,version,payload,digest,actor,created_at) VALUES (?,?,?,?,?,?)",
    ).run(id, (latest?.version ?? 0) + 1, payload, hash, actor, new Date().toISOString());
    securityEvent(actor, "exam-draft");
    return { id, changed: true };
  })();
}
export function validatePublication(content: NoticeContent): void {
  if (unrecordedExamDates(content).length)
    throw new Error("正文已有明确考试日期，请补齐对应考试时间后发布。");
  const labels = new Set<string>();
  for (const point of content.timeline) {
    if (labels.has(point.label)) throw new Error("时间节点重复。");
    labels.add(point.label);
    if (!point.value && point.endValue) throw new Error("时间范围需要开始日期。");
    if (!point.value) continue;
    for (const value of [point.value, point.endValue].filter((value): value is string => !!value)) {
      if (
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\+08:00)?$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        (value.length > 10 &&
          (Number(value.slice(11, 13)) > 23 ||
            Number(value.slice(14, 16)) > 59 ||
            Number(value.slice(17, 19)) > 59))
      )
        throw new Error("日期须为YYYY-MM-DD或带+08:00的完整时间；未知请留空。");
      const date = value.slice(0, 10);
      const normalized = new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10);
      if (normalized !== date) throw new Error("日期不存在，不能发布。");
    }
    if (
      point.endValue &&
      (point.endValue.length !== point.value.length || point.endValue < point.value)
    )
      throw new Error("时间范围应使用相同精度，结束不能早于开始。");
    if (!point.quote || !content.text.includes(point.quote))
      throw new Error("每项已知日期需要可在原文中定位的引用。");
  }
  const start = content.timeline.find((p) => p.label === "报名开始")?.value;
  const end = content.timeline.find((p) => p.label === "报名截止")?.value;
  if (
    start &&
    end &&
    Date.parse(start.length === 10 ? `${start}T00:00:00+08:00` : start) >
      Date.parse(end.length === 10 ? `${end}T23:59:59+08:00` : end)
  )
    throw new Error("报名开始晚于截止，不能发布。");
  if (content.summary && !content.audience)
    throw new Error("发布摘要时请填写适用人群和限制，避免将条件套用到所有人。");
}
export function publishNotice(
  id: string,
  actor: string,
  withdraw = false,
  expectedVersion?: number,
): void {
  const item = notice(id, false);
  if (!item) throw new Error("公告不存在。");
  if (expectedVersion !== item.version)
    throw new Error("公告已有变化或未指定审核版本，请刷新并核对后再发布。");
  if (!withdraw) validatePublication(item.content);
  const db = platformDb();
  db.transaction(() => {
    const publishedVersion = withdraw ? item.published_version : item.version;
    db.prepare("UPDATE exam_notices SET status=?,published_version=? WHERE id=?").run(
      withdraw ? "withdrawn" : "published",
      publishedVersion,
      id,
    );
    if (publishedVersion)
      db.prepare(
        "INSERT INTO exam_publications(notice_id,version,action,actor,created_at) VALUES (?,?,?,?,?)",
      ).run(
        id,
        publishedVersion,
        withdraw ? "withdraw" : "publish",
        actor,
        new Date().toISOString(),
      );
    securityEvent(actor, withdraw ? "exam-withdraw" : "exam-publish");
  })();
}
export function favorites(
  userId: string,
): Array<ExamNotice & { changed: boolean; withdrawn: boolean }> {
  return platformDb()
    .prepare<[string], { notice_id: string; seen_version: number; seen_status: string }>(
      "SELECT * FROM exam_favorites WHERE user_id=?",
    )
    .all(userId)
    .flatMap((row) => {
      const item = notice(row.notice_id, false);
      if (!item || !item.published_version) return [];
      const historical = noticeVersion(item.id, item.published_version);
      if (!historical) return [];
      return [
        {
          ...item,
          version: item.published_version,
          content: historical.content,
          changed: row.seen_version !== item.published_version || row.seen_status !== item.status,
          withdrawn: item.status !== "published",
        },
      ];
    });
}
export function favorite(userId: string, id: string, enabled: boolean, seen = false): void {
  const db = platformDb();
  const item = notice(id, false);
  if (!item?.published_version) throw new Error("只能收藏已发布过的公告。");
  if (!enabled) {
    db.prepare("DELETE FROM exam_favorites WHERE user_id=? AND notice_id=?").run(userId, id);
    return;
  }
  if (seen)
    db.prepare(
      "UPDATE exam_favorites SET seen_version=?,seen_status=? WHERE user_id=? AND notice_id=?",
    ).run(item.published_version, item.status, userId, id);
  else {
    if (db.prepare("SELECT 1 FROM exam_favorites WHERE user_id=? AND notice_id=?").get(userId, id))
      return;
    const count =
      db
        .prepare<[string], { n: number }>("SELECT COUNT(*) n FROM exam_favorites WHERE user_id=?")
        .get(userId)?.n ?? 0;
    if (count >= 500) throw new Error("每个账号最多收藏500条公告。");
    db.prepare(
      "INSERT OR IGNORE INTO exam_favorites(user_id,notice_id,seen_version,seen_status) VALUES (?,?,?,?)",
    ).run(userId, id, item.published_version, item.status);
  }
}
export function registrationState(content: NoticeContent, now = Date.now()): string {
  if (content.disposition !== "正常") return content.disposition;
  const start = examTimeline(content).find((p) => p.label === "报名开始")?.value;
  const end = examTimeline(content).find((p) => p.label === "报名截止")?.value;
  if (!start || !end) return "报名时间未完整确认";
  if (start.length === 10 || end.length === 10) return "仅公布日期，请核对官方具体时刻";
  if (now < Date.parse(start)) return "尚未开始";
  if (now > Date.parse(end)) return "报名时间已截止";
  return "处于公布的报名时段（通道状态未核实）";
}

export function publishedHistory(id: string): ReturnType<typeof noticeHistory> {
  const versions = new Set(
    platformDb()
      .prepare<[string], { version: number }>(
        "SELECT DISTINCT version FROM exam_publications WHERE notice_id=? AND action='publish'",
      )
      .all(id)
      .map((row) => row.version),
  );
  return noticeHistory(id).filter((row) => versions.has(row.version));
}

export function matchesExamCategory(content: NoticeContent, category: string): boolean {
  if (content.category === category || content.categories?.some((id) => id === category))
    return true;
  return (
    (category === "cet4" || category === "cet6") &&
    (content.category === "cet4" || content.category === "cet6") &&
    /四、六级|四六级|四级.*六级/.test(content.title)
  );
}
