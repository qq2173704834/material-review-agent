import { beijingDay } from "@/lib/portal-feed";
import { classifyExamTitle, classifyExamCategories } from "@/lib/exam-discovery";
import { dueCollectorSources } from "@/lib/collector-schedule";
import { collectorCandidates } from "@/lib/collector-candidates";
import { EXAM_PORTALS } from "@/domain/exam-portals";
import "server-only";
import { fetchPublicWebpage } from "./webpage-fetcher";
import { officialUrl, saveDraft, sourceById, sources } from "./exam-store";
import { platformDb } from "./platform-db";
export async function collectSource(id: string): Promise<{ drafts: number; message: string }> {
  const source = sourceById(id);
  if (!source) throw new Error("来源不存在。");
  const db = platformDb();
  const now = Date.now();
  const lock = db
    .prepare("UPDATE exam_sources SET locked_until=?,last_attempt=? WHERE id=? AND locked_until<?")
    .run(now + 300000, new Date(now).toISOString(), id, now);
  if (!lock.changes) throw new Error("此来源正在采集中，请稍后查看记录。");
  const run = db
    .prepare(
      "INSERT INTO exam_fetch_runs(source_id,started_at,status,message) VALUES (?,?,'running','正在读取官方列表')",
    )
    .run(id, new Date().toISOString());
  let drafts = 0;
  let failures = 0;
  try {
    const portal = EXAM_PORTALS.find((entry) => entry.url === source.url);
    if (portal?.collectionMode === "query")
      throw new Error("此来源仅提供官方查询入口，尚未适配公告采集；请查询原站或人工导入原文。");
    const page = await fetchPublicWebpage(source.url);
    const links = collectorCandidates(page.links, source);
    for (const link of links) {
      try {
        const detail = await fetchPublicWebpage(officialUrl(link.url, source));
        const year = Number(
          (detail.title + link.name).match(/20\d{2}/)?.[0] ?? new Date().getFullYear(),
        );
        const result = saveDraft(
          id,
          detail.url,
          {
            title: detail.title || link.name,
            category: classifyExamTitle(link.name + " " + detail.title, source.category),
            categories: classifyExamCategories(
              link.name + " " + detail.title,
              source.category,
            ).slice(0, 8),
            region: source.region as "全国",
            edition: "待管理员核对考期",
            year,
            stage: "其他",
            organizer: source.name,
            publishedAt: "",
            text: detail.text,
            summary: "",
            audience: "",
            timeline: [],
            attachments: detail.attachments
              .filter((a) => new URL(a.url).hostname === new URL(source.url).hostname)
              .map((a) => ({ ...a, status: "仅官方链接，未读取" as const })),
            disposition: "待核实",
          },
          "collector",
        );
        if (result.changed) drafts++;
      } catch {
        failures++;
      }
    }
    if (!links.length)
      throw new Error("列表可访问，但未识别到适配的考试公告链接；需调整来源入口或人工导入。");
    if (failures === links.length)
      throw new Error("列表已读取，但详情全部获取失败，保留上次有效数据。");
    const message = `检查${links.length}条候选，新增/变化草稿${drafts}条，详情失败${failures}条；未自动发布。`;
    db.prepare(
      "UPDATE exam_sources SET last_success=?,error=?,failures=0,next_run=? WHERE id=?",
    ).run(
      new Date().toISOString(),
      failures ? message : null,
      Date.now() + source.interval_hours * 3600000,
      id,
    );
    db.prepare("UPDATE exam_fetch_runs SET finished_at=?,status=?,message=? WHERE id=?").run(
      new Date().toISOString(),
      failures ? "partial" : "success",
      message,
      run.lastInsertRowid,
    );
    return { drafts, message };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : "采集失败";
    db.prepare("UPDATE exam_sources SET error=?,failures=failures+1,next_run=? WHERE id=?").run(
      message,
      Date.now() +
        Math.min(48, source.interval_hours * 2 ** Math.min(source.failures + 1, 3)) * 3600000,
      id,
    );
    db.prepare("UPDATE exam_fetch_runs SET finished_at=?,status='failed',message=? WHERE id=?").run(
      new Date().toISOString(),
      message,
      run.lastInsertRowid,
    );
    throw new Error(message, { cause: error });
  } finally {
    db.prepare("UPDATE exam_sources SET locked_until=0 WHERE id=?").run(id);
  }
}
let ticking = false;
export async function collectorTick(
  collect: (id: string) => Promise<unknown> = collectSource,
): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const day = beijingDay(),
      db = platformDb(),
      enabled = sources().filter((source) => source.enabled);
    db.prepare(
      "INSERT OR IGNORE INTO portal_daily_runs(day,status,message,started_at) VALUES (?,'running','正在检查启用来源；新内容仍需审核发布。',?)",
    ).run(day, new Date().toISOString());
    const configured = db
      .prepare<[string], { value: string }>("SELECT value FROM portal_settings WHERE key=?")
      .get("daily-check-hour");
    const hour = Number(configured?.value ?? 8);
    for (const source of dueCollectorSources(enabled, Date.now(), hour)) {
      try {
        await collect(source.id);
      } catch {
        /* Each failure is persisted, and other sources continue. */
      }
    }
    const current = sources().filter((source) => source.enabled);
    const checked = current.filter(
      (source) => source.last_attempt && beijingDay(Date.parse(source.last_attempt)) === day,
    );
    const failures = checked.filter((source) => source.error);
    const done = checked.length === current.length;
    const count =
      db
        .prepare<[string, string], { count: number }>(
          "SELECT COUNT(*) count FROM exam_notice_versions WHERE actor='collector' AND created_at>=? AND created_at<?",
        )
        .get(
          new Date(Date.parse(day + "T00:00:00+08:00")).toISOString(),
          new Date(Date.parse(day + "T00:00:00+08:00") + 86400000).toISOString(),
        )?.count ?? 0;
    const changes = count
      ? `今日采集生成${count}个新增或变化版本，仍需审核。`
      : "今日检查尚无新增或变化草稿；失败来源不代表没有新公告。";
    const message =
      (!current.length
        ? "没有启用自动采集来源；今日未执行采集，保留已审核信息。"
        : done
          ? `今日已检查${checked.length}个来源，其中${failures.length}个有失败或部分异常。新增或变化内容仅保存草稿，未自动发布。`
          : `今日已检查${checked.length}/${current.length}个启用来源；按来源间隔及失败退避继续检查，保留有效信息。`) +
      (current.length ? changes : "");
    db.prepare("UPDATE portal_daily_runs SET status=?,message=?,finished_at=? WHERE day=?").run(
      !current.length ? "none" : done ? (failures.length ? "partial" : "success") : "running",
      message,
      done ? new Date().toISOString() : null,
      day,
    );
  } finally {
    ticking = false;
  }
}
