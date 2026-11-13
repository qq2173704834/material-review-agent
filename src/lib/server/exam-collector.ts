import "server-only";
import { fetchPublicWebpage } from "./webpage-fetcher";
import { officialUrl, saveDraft, sourceById, sources } from "./exam-store";
import { platformDb } from "./platform-db";
const keywords = /报名|考试|招考|招生|成绩|准考证|资格|考务|通知|公告|考研|推免/;
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
    const page = await fetchPublicWebpage(source.url);
    const links = page.links
      .filter((link) => {
        try {
          return (
            keywords.test(link.name) &&
            !/^(考试动态|考试大纲|成绩证明|成绩核查|报名流程|考试介绍)$/.test(link.name) &&
            !/科研课题|采购|少儿|义务教育|中考|普通高考/.test(link.name) &&
            (source.category !== "education-local" ||
              /研究生|考研|推免|专升本|专接本|四六级|四、六级|四级|六级|计算机等级|教师资格|普通话|自学考试|同等学力|英语等级|职业资格/.test(
                link.name,
              )) &&
            new URL(link.url).hostname === new URL(source.url).hostname &&
            !/\.(pdf|docx?|xlsx?|zip)$/i.test(new URL(link.url).pathname)
          );
        } catch {
          return false;
        }
      })
      .sort((a, b) => Number(/\/report\//.test(b.url)) - Number(/\/report\//.test(a.url)))
      .slice(0, 8);
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
            category:
              /六级/.test(link.name) && !/四/.test(link.name)
                ? "cet6"
                : /四级|四、六级|四六级/.test(link.name)
                  ? "cet4"
                  : /计算机等级/.test(link.name)
                    ? "ncre"
                    : /教师资格/.test(link.name)
                      ? "teacher"
                      : /硕士|研究生|考研/.test(link.name)
                        ? "graduate"
                        : /专升本|专接本/.test(link.name)
                          ? "transfer"
                          : (source.category as "cet4"),
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
export async function collectorTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const source of sources()
      .filter((s) => s.enabled && s.next_run <= Date.now())
      .slice(0, 2)) {
      try {
        await collectSource(source.id);
      } catch {
        /* Each failure is persisted, and other sources continue. */
      }
    }
  } finally {
    ticking = false;
  }
}
