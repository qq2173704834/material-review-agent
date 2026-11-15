import { learningEntry } from "./learning-store";
import "server-only";
import { createHash } from "node:crypto";
import { platformDb } from "./platform-db";
import { campusMutationSchema, type CampusState, type CampusNotice } from "@/domain/campus";
import { CAMPUS_SCHOOLS } from "@/domain/campus-schools";
import initialNotices from "@/domain/campus-notices.json";

export function campusDb(): ReturnType<typeof platformDb> {
  const db = platformDb();
  db.exec(`CREATE TABLE IF NOT EXISTS campus_states(user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, revision INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campus_notices(id TEXT PRIMARY KEY,school_id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campus_notice_history(notice_id TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(notice_id,digest));
    CREATE TABLE IF NOT EXISTS campus_source_settings(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,interval_hours INTEGER NOT NULL DEFAULT 6);
    CREATE TABLE IF NOT EXISTS campus_source_runs(id TEXT PRIMARY KEY, next_run INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, last_success TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS campus_school_requests(user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, url TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,url));
    CREATE TABLE IF NOT EXISTS campus_school_requests_v2(user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, request_key TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,request_key));
    INSERT OR IGNORE INTO campus_school_requests_v2(user_id,request_key,url,name,created_at)
      SELECT user_id,'legacy:' || url,url,name,created_at FROM campus_school_requests;`);
  const seed = db.prepare(
    "INSERT OR IGNORE INTO campus_notices(id,school_id,payload) VALUES (?,?,?)",
  );
  db.transaction(() => {
    for (const notice of initialNotices)
      seed.run(notice.id, notice.schoolId, JSON.stringify(notice));
  })();
  return db;
}
export function campusState(userId: string): CampusState {
  const row = campusDb()
    .prepare<[string], { payload: string }>("SELECT payload FROM campus_states WHERE user_id=?")
    .get(userId);
  return row
    ? (JSON.parse(row.payload) as CampusState)
    : {
        revision: 0,
        preferences: { schoolId: "", department: "", grade: "", interests: [] },
        events: [],
        reads: {},
        favorites: [],
        reminderReads: [],
      };
}
export function campusNotices(schoolId: string): CampusNotice[] {
  return campusDb()
    .prepare<[string], { payload: string }>("SELECT payload FROM campus_notices WHERE school_id=?")
    .all(schoolId)
    .map((row) => JSON.parse(row.payload) as CampusNotice)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 200);
}
export function mutateCampus(userId: string, raw: unknown): CampusState {
  const input = campusMutationSchema.parse(raw),
    db = campusDb();
  return db.transaction(() => {
    const state = campusState(userId);
    if (state.revision !== input.expectedRevision)
      throw new Error("日程已更新，请刷新后重试。输入已保留。");
    if (input.action === "preferences") {
      if (
        input.preferences.schoolId &&
        !CAMPUS_SCHOOLS.some((school) => school.id === input.preferences.schoolId)
      )
        throw new Error("请选择已收录学校，或按名称申请添加学校。");
      state.preferences = input.preferences;
    } else if (input.action === "save") {
      for (const event of input.events) {
        const prior = state.events.find((item) => item.id === event.id);
        if (
          event.resourceIds.some(
            (id) =>
              !prior?.resourceIds?.includes(id) && learningEntry(id)?.content.kind !== "resource",
          )
        )
          throw new Error("关联资料不可用，请重新选择。");
        if (
          event.sourceId &&
          (!prior || prior.sourceId !== event.sourceId || prior.sourceDigest !== event.sourceDigest)
        ) {
          const linked =
            prior?.sourceId === event.sourceId
              ? db
                  .prepare<[string], { payload: string }>(
                    "SELECT payload FROM campus_notices WHERE id=?",
                  )
                  .get(event.sourceId)
              : undefined;
          const notice = linked
            ? (JSON.parse(linked.payload) as CampusNotice)
            : campusNotices(state.preferences.schoolId).find((item) => item.id === event.sourceId);
          if (!notice || notice.withdrawn || notice.digest !== event.sourceDigest)
            throw new Error("通知已更新，请重新预览后加入日程。");
        }
        const same = state.events.find(
          (item) =>
            item.id !== event.id &&
            ((!!event.sourceId &&
              !!event.sourceNodeKey &&
              item.sourceId === event.sourceId &&
              item.sourceNodeKey === event.sourceNodeKey) ||
              ((!item.sourceNodeKey || !event.sourceNodeKey) &&
                item.kind === event.kind &&
                item.sourceId === event.sourceId &&
                item.title === event.title &&
                item.course === event.course &&
                item.semester === event.semester &&
                ((!!event.sourceId && item.sourceId === event.sourceId) ||
                  (item.start === event.start && item.end === event.end)))),
        );
        if (same) continue;
        if (prior) state.events[state.events.indexOf(prior)] = event;
        else state.events.push(event);
      }
      if (state.events.length > 500) throw new Error("日程已达500条，请先整理。");
    } else if (input.action === "delete")
      state.events = state.events.filter((event) => event.id !== input.id);
    else if (input.action === "reminder-read")
      state.reminderReads = [...new Set([...state.reminderReads, input.key])].slice(-1000);
    else {
      const notice = campusNotices(state.preferences.schoolId).find((item) => item.id === input.id);
      if (!notice) throw new Error("通知不存在。");
      if (input.action === "read") {
        if (input.digest !== notice.digest) throw new Error("通知已更新，请重新查看。");
        state.reads[input.id] = notice.digest;
      } else
        state.favorites = input.enabled
          ? [...new Set([...state.favorites, input.id])]
          : state.favorites.filter((id) => id !== input.id);
    }
    state.revision++;
    db.prepare(
      "INSERT INTO campus_states(user_id,revision,payload) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
    ).run(userId, state.revision, JSON.stringify(state));
    return state;
  })();
}
export function saveCampusNotice(notice: CampusNotice): void {
  const db = campusDb();
  const duplicate = campusNotices(notice.schoolId).find(
    (item) =>
      item.title === notice.title &&
      item.publishedAt === notice.publishedAt &&
      item.text === notice.text,
  );
  if (duplicate && duplicate.id !== notice.id) {
    const relatedUrls = [...new Set([...(duplicate.relatedUrls || []), notice.url])].filter(
      (url) => url !== duplicate.url,
    );
    db.prepare("UPDATE campus_notices SET payload=? WHERE id=?").run(
      JSON.stringify({ ...duplicate, relatedUrls }),
      duplicate.id,
    );
    return;
  }
  const prior = db
    .prepare<[string], { payload: string }>("SELECT payload FROM campus_notices WHERE id=?")
    .get(notice.id);
  if (prior) {
    const previous = JSON.parse(prior.payload) as CampusNotice;
    if (previous.digest !== notice.digest)
      db.prepare(
        "INSERT OR IGNORE INTO campus_notice_history(notice_id,digest,payload) VALUES (?,?,?)",
      ).run(previous.id, previous.digest, prior.payload);
    notice = {
      ...notice,
      relatedUrls: [...new Set([...(previous.relatedUrls || []), ...(notice.relatedUrls || [])])],
      withdrawn: previous.withdrawn,
    };
  }
  db.prepare(
    "INSERT INTO campus_notices(id,school_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  ).run(notice.id, notice.schoolId, JSON.stringify(notice));
}
export function campusDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function moderateCampusNotice(id: string, withdrawn: boolean): void {
  const db = campusDb();
  const row = db
    .prepare<[string], { payload: string }>("SELECT payload FROM campus_notices WHERE id=?")
    .get(id);
  if (!row) throw new Error("通知不存在。");
  const notice = JSON.parse(row.payload) as CampusNotice;
  db.prepare("UPDATE campus_notices SET payload=? WHERE id=?").run(
    JSON.stringify({ ...notice, withdrawn, updatedAt: new Date().toISOString() }),
    id,
  );
}
export function campusDisplayEvents(userId: string): CampusState["events"] {
  return campusState(userId).events.map((event) => {
    if (!event.sourceId) return event;
    const row = campusDb()
      .prepare<[string], { payload: string }>("SELECT payload FROM campus_notices WHERE id=?")
      .get(event.sourceId);
    const source = row ? (JSON.parse(row.payload) as CampusNotice) : undefined;
    return !source || source.withdrawn || source.digest !== event.sourceDigest
      ? { ...event, start: "", end: "" }
      : event;
  });
}

export function campusLinkedNotices(userId: string): CampusNotice[] {
  return [
    ...new Set(
      campusState(userId)
        .events.map((event) => event.sourceId)
        .filter(Boolean),
    ),
  ].flatMap((id) => {
    const row = campusDb()
      .prepare<[string], { payload: string }>("SELECT payload FROM campus_notices WHERE id=?")
      .get(id);
    return row ? [JSON.parse(row.payload) as CampusNotice] : [];
  });
}
