import { EXAM_PORTALS } from "@/domain/exam-portals";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { platformDb, securityEvent } from "./platform-db";
import { fetchPublicWebpage } from "./webpage-fetcher";
import {
  learningContentSchema,
  type LearningContent,
  type ContentEntry,
} from "@/domain/learning-content";
import { studentGoal, portalPreferences } from "./student-goals";
import { matchesExamSearch } from "@/lib/exam-discovery";
interface ContentRow {
  id: string;
  version: number;
  status: string;
  updated_at: string;
  payload: string;
}
function contentRow(row: ContentRow): ContentEntry {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    updatedAt: row.updated_at,
    content: learningContentSchema.parse(JSON.parse(row.payload)),
  };
}
export function learningEntries(admin = false): ContentEntry[] {
  seedPortalReferences();
  return platformDb()
    .prepare<[number], ContentRow>(
      `SELECT c.id,c.status,c.updated_at,v.version,v.payload FROM portal_content c JOIN portal_content_versions v ON v.content_id=c.id AND v.version=CASE WHEN ?=1 THEN c.version ELSE c.published_version END ORDER BY c.updated_at DESC LIMIT 2000`,
    )
    .all(admin ? 1 : 0)
    .filter((row) => admin || row.status === "published")
    .map(contentRow);
}
export function learningEntry(id: string, admin = false): ContentEntry | undefined {
  return learningEntries(admin).find((item) => item.id === id);
}
export function saveLearningContent(
  raw: LearningContent,
  actor: string,
  id?: string,
  expected?: number,
): ContentEntry {
  const content = learningContentSchema.parse(raw),
    db = platformDb(),
    now = new Date().toISOString();
  return db.transaction(() => {
    const previous = id ? learningEntry(id, true) : undefined;
    if (id && (!previous || previous.version !== expected))
      throw new Error("内容版本已变化，请刷新核对。");
    if (learningEntries(true).length >= 2000 && !id)
      throw new Error("内容达到2000条上限，请整理。");
    if (!id) {
      const canonical = (value: string): string => {
        const url = new URL(value);
        url.hash = "";
        return url.toString();
      };
      const duplicate = learningEntries(true).find(
        (entry) =>
          entry.content.category === content.category &&
          entry.content.edition === content.edition &&
          entry.content.kind === content.kind &&
          canonical(entry.content.url) === canonical(content.url),
      );
      if (duplicate)
        throw new Error(`已有相同来源、考试及版本的条目，请修订原条目：${duplicate.id}`);
    }
    const key = id ?? randomUUID(),
      version = (previous?.version ?? 0) + 1;
    db.prepare(
      "INSERT INTO portal_content(id,kind,status,version,updated_at) VALUES (?,?,'draft',?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at",
    ).run(key, content.kind, version, now);
    db.prepare(
      "INSERT INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,?,?,?,?)",
    ).run(key, version, JSON.stringify(content), actor, now);
    securityEvent(actor, "learning-draft");
    return learningEntry(key, true)!;
  })();
}
export async function publishLearningContent(
  id: string,
  version: number,
  actor: string,
  withdraw = false,
): Promise<void> {
  const entry = learningEntry(id, true);
  if (!entry || entry.version !== version) throw new Error("审核版本已变化。");
  if (!withdraw) {
    if (entry.content.reviewNote.trim().length < 10)
      throw new Error("请填写至少10字审核依据，核对授权、适用范围与当前状态。");
    if (entry.content.disposition === "待核实") throw new Error("请先核对资料适用状态。");
    if (entry.content.checkedAt > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
      throw new Error("核查日期不能在未来。");
    // Checks actual public reachability and every redirect; no private host or credential bypass.
    await fetchPublicWebpage(entry.content.url);
  }
  const changed = platformDb()
    .prepare(
      "UPDATE portal_content SET status=?,published_version=CASE WHEN ?=1 THEN published_version ELSE version END,updated_at=? WHERE id=? AND version=?",
    )
    .run(
      withdraw ? "withdrawn" : "published",
      withdraw ? 1 : 0,
      new Date().toISOString(),
      id,
      version,
    );
  if (!changed.changes) throw new Error("审核期间内容已变化，请重新核对。");
  securityEvent(actor, withdraw ? "learning-withdraw" : "learning-publish");
}
export function learningRecommendations(
  userId: string,
  goalId?: string,
): Array<ContentEntry & { reason: string; saved: boolean; seen: boolean; dismissed: boolean }> {
  const goal = goalId ? studentGoal(userId, goalId) : undefined;
  if (goalId && !goal) throw new Error("考试目标不存在。");
  const preferences = portalPreferences(userId);
  const marks = platformDb()
    .prepare<[string], { content_id: string; saved: number; seen: number; dismissed: number }>(
      "SELECT * FROM resource_marks WHERE user_id=?",
    )
    .all(userId);
  return learningEntries()
    .filter((item) => item.content.kind === "resource")
    .filter((item) => {
      const mark = marks.find((mark) => mark.content_id === item.id);
      if (mark?.dismissed) return false;
      if (!goal || !preferences.personalized) return true;
      return (
        item.content.category === goal.category &&
        (item.content.region === "全国" || item.content.region === goal.region) &&
        (!goal.subject ||
          !item.content.subject ||
          item.content.subject.includes(goal.subject) ||
          goal.subject.includes(item.content.subject)) &&
        (!goal.formats.length || goal.formats.includes(item.content.format))
      );
    })
    .map((item) => {
      const mark = marks.find((mark) => mark.content_id === item.id);
      const outdated = goal && item.content.edition && goal.edition !== item.content.edition;
      return {
        ...item,
        saved: !!mark?.saved,
        seen: (mark?.seen ?? 0) >= item.version,
        dismissed: !!mark?.dismissed,
        reason:
          !goal || !preferences.personalized
            ? "通用已审核资源；未使用个人偏好"
            : `匹配${goal.edition}目标与${goal.region}地区${goal.subject ? `、${goal.subject}科目` : ""}${goal.formats.length ? `、${goal.formats.join("/")}偏好` : ""}${outdated ? "；资料考期不同，请核对版本" : ""}${item.content.studyStage === goal.studyStage ? `，适合${goal.studyStage}阶段` : ""}`,
      };
    })
    .sort(
      (a, b) =>
        Number(b.content.studyStage === goal?.studyStage) -
        Number(a.content.studyStage === goal?.studyStage),
    );
}
export function resourceMark(
  userId: string,
  id: string,
  action: "saved" | "seen" | "dismissed",
  value: boolean,
): void {
  const entry = learningEntry(id) ?? withdrawnLearningEntry(id);
  if (!entry) throw new Error("资料不存在或已撤回。");
  const db = platformDb();
  db.prepare("INSERT OR IGNORE INTO resource_marks(user_id,content_id) VALUES (?,?)").run(
    userId,
    id,
  );
  const column = { saved: "saved", seen: "seen", dismissed: "dismissed" }[action];
  db.prepare(`UPDATE resource_marks SET ${column}=? WHERE user_id=? AND content_id=?`).run(
    value ? (action === "seen" ? entry.version : 1) : 0,
    userId,
    id,
  );
}
export function seedPortalReferences(): void {
  // Reviewed public navigation resources; no fabricated course or imported private data.
  const seedDb = platformDb();
  for (const portal of EXAM_PORTALS) {
    const key = createHash("sha256")
      .update("portal-resource:" + portal.url)
      .digest("hex")
      .slice(0, 32);
    if (seedDb.prepare("SELECT 1 FROM portal_content WHERE id=?").get(key)) continue;
    const entry = learningContentSchema.parse({
      title: `${portal.name}官方资料查询入口`,
      category: portal.category,
      kind: "resource",
      author: "教育部教育考试院",
      url: portal.url,
      text: "此条为公开官方入口导航，供查询考试介绍、考纲及官方通知。未导入具体课程、完整教材或当期报名安排，请进入原站核对。",
      summary: "官方查询导航；不代表已读取全部资料或正在报名。",
      checkedAt: portal.checkedAt,
      scope: "按原站最新公告核对具体考期、科目、报考对象和费用。",
      reviewNote: "公开官方考试目录与入口可达性核验，仅收录入口链接与说明，不转载课程资料。",
      disposition: "现行",
    });
    seedDb.transaction(() => {
      seedDb
        .prepare(
          "INSERT OR IGNORE INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'resource','published',1,1,?)",
        )
        .run(key, new Date().toISOString());
      seedDb
        .prepare(
          "INSERT OR IGNORE INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'curated-reference',?)",
        )
        .run(key, JSON.stringify(entry), new Date().toISOString());
    })();
  }
  const id = createHash("sha256").update("shnu-scholarship-2024-11").digest("hex").slice(0, 32),
    db = platformDb();
  if (db.prepare("SELECT 1 FROM portal_content WHERE id=?").get(id)) return;
  const content: LearningContent = {
    title: "上海师范大学商学院综合测评细则（2024年11月）",
    category: "french-specialty",
    region: "上海",
    edition: "2024年11月版",
    subject: "",
    kind: "school",
    format: "资料",
    studyStage: "通用",
    author: "上海师范大学商学院",
    url: "https://sfb.shnu.edu.cn/84/7d/c15123a820349/page.htm",
    text: "大学英语六级、法语专业八级合格得5分。中级口译证书加5分、高级口译证书加10分，通过笔试未通过口试者减半加分。",
    summary: "已读高校参考，不能套用其他学校或当前学年。",
    language: "中文",
    fee: "免费",
    permission: "仅链接",
    checkedAt: "2026-11-14",
    scope: "仅该学院该版本规定范围；具体当学年要求需回学校核对。",
    reviewNote: "2026年11月14日公开原文核对，仅留少量引用及官方链接，不存储完整校方文件。",
    disposition: "历史",
  };
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'school','published',1,1,?)",
    ).run(id, new Date().toISOString());
    db.prepare(
      "INSERT OR IGNORE INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'curated-reference',?)",
    ).run(id, JSON.stringify(content), new Date().toISOString());
  })();
}
export { matchesExamSearch };

export function withdrawnLearningEntry(id: string): ContentEntry | undefined {
  const row = platformDb()
    .prepare<[string], ContentRow>(
      "SELECT c.id,c.status,c.updated_at,v.version,v.payload FROM portal_content c JOIN portal_content_versions v ON v.content_id=c.id AND v.version=c.published_version WHERE c.id=? AND c.status='withdrawn'",
    )
    .get(id);
  return row ? contentRow(row) : undefined;
}
export function learningHistory(id: string): Array<{ version: number; created_at: string }> {
  // Only administrators see all source revisions; private drafts never become public history.
  return platformDb()
    .prepare<[string], { version: number; created_at: string }>(
      "SELECT version,created_at FROM portal_content_versions WHERE content_id=? ORDER BY version DESC LIMIT 100",
    )
    .all(id);
}

export function savedLearningItems(userId: string): Array<ContentEntry & { seen: boolean }> {
  return platformDb()
    .prepare<[string], ContentRow & { seen: number }>(
      "SELECT c.id,c.status,c.updated_at,v.version,v.payload,m.seen FROM resource_marks m JOIN portal_content c ON c.id=m.content_id JOIN portal_content_versions v ON v.content_id=c.id AND v.version=c.published_version WHERE m.user_id=? AND m.saved=1 ORDER BY c.updated_at DESC LIMIT 500",
    )
    .all(userId)
    .map((row) => ({ ...contentRow(row), seen: row.seen >= row.version }));
}
