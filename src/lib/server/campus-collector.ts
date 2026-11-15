import "server-only";
import { CAMPUS_SOURCES } from "@/domain/campus-schools";
import { campusArticle, campusPublicationDate, campusArticleTitle } from "@/lib/campus-article";
import { decodeHtml } from "@/lib/html-decoding";
import { fetchPublicResource, fetchPublicWebpage } from "./webpage-fetcher";
import { campusDb, campusDigest, saveCampusNotice } from "./campus-store";

export async function collectCampusSource(id: string): Promise<number> {
  const source = CAMPUS_SOURCES.find((item) => item.id === id);
  if (!source) throw new Error("来源未登记。");
  const db = campusDb(),
    now = Date.now();
  const settings = db
    .prepare<[string], { enabled: number; interval_hours: number }>(
      "SELECT enabled,interval_hours FROM campus_source_settings WHERE id=?",
    )
    .get(id);
  const intervalMs = (settings?.interval_hours || 6) * 3600000;
  db.prepare("INSERT OR IGNORE INTO campus_source_runs(id) VALUES (?)").run(id);
  const locked = db
    .prepare("UPDATE campus_source_runs SET locked_until=? WHERE id=? AND locked_until<?")
    .run(now + 180000, id, now);
  if (!locked.changes) return 0;
  try {
    const page = await fetchPublicWebpage(source.url);
    const links = [
      ...new Set(
        page.links
          .filter(
            (link) =>
              new URL(link.url).hostname === new URL(source.url).hostname &&
              new RegExp(source.pattern, "u").test(new URL(link.url).pathname),
          )
          .map((link) => link.url),
      ),
    ].slice(0, 10);
    if (!links.length) throw new Error("未识别到通知链接，等待维护核对。");
    let count = 0;
    for (const url of links) {
      try {
        const resource = await fetchPublicResource(url);
        if (new URL(resource.url).hostname !== new URL(source.url).hostname)
          throw new Error("详情跳转至其他站点。");
        const html = decodeHtml(resource.bytes, resource.contentType),
          text = campusArticle(html);
        const title = campusArticleTitle(html);
        const publishedAt = campusPublicationDate(html, url);
        if (!title) throw new Error("通知标题或日期缺失。");
        saveCampusNotice({
          id: campusDigest(url).slice(0, 32),
          schoolId: source.schoolId,
          department: source.department,
          title,
          url,
          text,
          publishedAt,
          category: /奖学金|评优|资助/u.test(title)
            ? "奖助评优"
            : source.department === "教务处"
              ? "教务考试"
              : "校园活动",
          digest: campusDigest(title + text),
          updatedAt: new Date().toISOString(),
        });
        count++;
      } catch {
        /* Keep last successful notice; other details remain independent. */
      }
    }
    if (!count) throw new Error("详情未能获取，保留已有通知。");
    db.prepare("UPDATE campus_source_runs SET next_run=?,last_success=?,error=? WHERE id=?").run(
      now + intervalMs,
      new Date().toISOString(),
      count < links.length ? `部分读取：${count}/${links.length}` : null,
      id,
    );
    return count;
  } catch (error) {
    db.prepare("UPDATE campus_source_runs SET next_run=?,error=? WHERE id=?").run(
      now + intervalMs,
      error instanceof Error ? error.message : "获取失败",
      id,
    );
    throw error;
  } finally {
    db.prepare("UPDATE campus_source_runs SET locked_until=0 WHERE id=?").run(id);
  }
}
let isTicking = false;
export async function campusCollectorTick(): Promise<void> {
  if (
    isTicking ||
    process.env.EXAM_SCHEDULER === "off" ||
    process.env.REVIEW_AUTH_MODE === "legacy-test"
  )
    return;
  isTicking = true;
  try {
    for (const source of CAMPUS_SOURCES) {
      const settings = campusDb()
        .prepare<[string], { enabled: number }>(
          "SELECT enabled FROM campus_source_settings WHERE id=?",
        )
        .get(source.id);
      if (settings?.enabled === 0) continue;
      const row = campusDb()
        .prepare<[string], { next_run: number }>(
          "SELECT next_run FROM campus_source_runs WHERE id=?",
        )
        .get(source.id);
      if (row && row.next_run > Date.now()) continue;
      try {
        await collectCampusSource(source.id);
      } catch {
        /* Persisted per source, no fabricated successful update. */
      }
    }
  } finally {
    isTicking = false;
  }
}
