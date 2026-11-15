import "server-only";
import { CAMPUS_SOURCES } from "@/domain/campus-schools";
import { campusArticle, campusPublicationDate, campusArticleTitle } from "@/lib/campus-article";
import { decodeHtml } from "@/lib/html-decoding";
import { campusSourceLinks } from "@/lib/campus-source-links";
import { campusExternalEntries } from "@/lib/campus-listing";
import { extractWebpageContent, fetchPublicResource } from "./webpage-fetcher";
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
    const links = new Set<string>();
    let indexed = 0;
    const indexedUrls = new Set<string>();
    let pageFailures = 0;
    // Only the two verified SYSU list pages are read. External bodies are never fetched.
    const listingUrls =
      source.externalListing === "sysu" ? [source.url, `${source.url}?page=1`] : [source.url];
    for (const listingUrl of listingUrls) {
      try {
        const resource = await fetchPublicResource(listingUrl);
        if (
          new URL(resource.url).origin !== new URL(source.url).origin ||
          !/text\/html|application\/xhtml\+xml/iu.test(resource.contentType)
        )
          throw new Error("通知列表不是登记站点的HTML页面。");
        const html = decodeHtml(resource.bytes, resource.contentType);
        const page = extractWebpageContent(html, resource.url);
        for (const url of campusSourceLinks(page.links, source)) links.add(url);
        if (source.externalListing) {
          for (const entry of campusExternalEntries(html, resource.url)) {
            if (indexedUrls.has(entry.url)) continue;
            saveCampusNotice({
              ...entry,
              id: campusDigest(`${source.schoolId}:${entry.url}`).slice(0, 32),
              schoolId: source.schoolId,
              department: source.department,
              text: "",
              contentStatus: "external_link",
              listingUrl: resource.url,
              category: /奖学金|评优|资助/u.test(entry.title)
                ? "奖助评优"
                : /竞赛|大赛/u.test(entry.title)
                  ? "竞赛"
                  : /教务|本科生院/u.test(source.department)
                    ? "教务考试"
                    : "校园活动",
              digest: campusDigest(entry.title + entry.publishedAt + entry.url),
              updatedAt: new Date().toISOString(),
            });
            indexed++;
            indexedUrls.add(entry.url);
          }
        }
      } catch {
        pageFailures++;
      }
    }
    let count = 0;
    const articleUrls = [...links].slice(0, 10);
    for (const url of articleUrls) {
      try {
        const resource = await fetchPublicResource(url);
        if (new URL(resource.url).origin !== new URL(source.url).origin)
          throw new Error("详情跳转至其他站点。");
        const html = decodeHtml(resource.bytes, resource.contentType),
          text = campusArticle(html, source.profile);
        const title = campusArticleTitle(html, source.profile);
        const publishedAt = campusPublicationDate(html, url, source.profile);
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
            : /竞赛|大赛/u.test(title)
              ? "竞赛"
              : /教务|本科生院/u.test(source.department)
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
    if (!count && !indexed) throw new Error("通知未能获取，保留已有通知。");
    db.prepare(
      "UPDATE campus_source_runs SET next_run=?,last_success=?,summary=?,error=? WHERE id=?",
    ).run(
      now + intervalMs,
      new Date().toISOString(),
      `全文${count}/${articleUrls.length}；官网外链索引${indexed}条（未读取外链正文）`,
      count < articleUrls.length || pageFailures
        ? `部分读取：全文${count}/${articleUrls.length}；列表失败${pageFailures}页`
        : null,
      id,
    );
    return count + indexed;
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
