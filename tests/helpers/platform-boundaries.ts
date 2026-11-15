import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import Database from "better-sqlite3";
import {
  test as base,
  expect,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import type { NoticeContent } from "../../src/lib/server/exam-store";

export const password = "StudentAccount-test-2026!";
const baseURL = "http://127.0.0.1:3132";
type Playwright = PlaywrightWorkerArgs["playwright"];
export function unique(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
export function testDirectory(): string {
  const directory = resolve(process.env.REVIEW_BOUNDARY_DATA_DIR ?? "");
  const root = resolve(".local-data/platform-boundary-e2e");
  if (!directory.startsWith(root + sep)) throw new Error("拒绝操作非边界测试目录。");
  return directory;
}
export function database(name = "platform.sqlite"): Database.Database {
  if (!["platform.sqlite", "reviews.sqlite"].includes(name)) throw new Error("测试数据库无效。");
  const db = new Database(resolve(testDirectory(), name));
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}
export interface Actor {
  username: string;
  id: string;
  recoveryCodes: string[];
  api: APIRequestContext;
}
export async function createActor(playwright: Playwright, prefix: string): Promise<Actor> {
  // Fixture setup runs many synthetic registrations in one minute. Reset only the
  // global setup budget in the enforced isolated test database; auth cases keep
  // exercising the real route and per-account limits without changing production.
  const fixtureDb = database();
  try {
    fixtureDb.prepare("DELETE FROM rate_limits WHERE key='auth-global:register'").run();
  } finally {
    fixtureDb.close();
  }
  const api = await playwright.request.newContext({ baseURL });
  const username = unique(prefix);
  const response = await api.post("/api/auth/register", { data: { username, password } });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  expect((await api.post("/api/auth/login", { data: { username, password } })).status()).toBe(200);
  return { username, id: body.account.id, recoveryCodes: body.recoveryCodes, api };
}
export async function loginAgain(playwright: Playwright, actor: Actor): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({ baseURL });
  expect(
    (await api.post("/api/auth/login", { data: { username: actor.username, password } })).status(),
  ).toBe(200);
  return api;
}
export const test = base.extend<object, { actors: { student: Actor; peer: Actor; admin: Actor } }>({
  actors: [
    async ({ playwright }, use) => {
      const student = await createActor(playwright, "student");
      const peer = await createActor(playwright, "peer");
      const admin = await createActor(playwright, "manager");
      execFileSync(process.execPath, [
        "scripts/platform-admin.mjs",
        "role",
        "--username",
        admin.username,
        "--role",
        "admin",
        "--apply",
        "--data-dir",
        testDirectory(),
      ]);
      expect(
        (
          await admin.api.post("/api/auth/login", { data: { username: admin.username, password } })
        ).status(),
      ).toBe(200);
      try {
        await use({ student, peer, admin });
      } finally {
        await Promise.all([student.api.dispose(), peer.api.dispose(), admin.api.dispose()]);
      }
    },
    { scope: "worker" },
  ],
});
export { expect };

export function noticeContent(overrides: Partial<NoticeContent> = {}): NoticeContent {
  return {
    title: unique("合成公告"),
    category: "cet4",
    region: "全国",
    edition: "2027年合成考期",
    year: 2027,
    stage: "招考报名",
    organizer: "合成学生考试组织方",
    publishedAt: "2027-03-01",
    text: "合成通知：报名开始2027年3月1日，截止2027年3月20日。须提交学籍证明。",
    summary: "合成测试摘要",
    audience: "符合官方条件的合成学生",
    timeline: [
      { label: "报名开始", value: "2027-03-01", quote: "报名开始2027年3月1日" },
      { label: "报名截止", value: "2027-03-20", quote: "截止2027年3月20日" },
    ],
    attachments: [],
    disposition: "正常",
    ...overrides,
  };
}
export async function draft(
  admin: Actor,
  content = noticeContent(),
  url?: string,
): Promise<{ id: string; changed: boolean; url: string }> {
  const body = await (await admin.api.get("/api/admin/exams")).json();
  const source = body.sources.find((item: { category: string }) => item.category === "cet4");
  const canonical = url ?? new URL(`/synthetic/${unique("notice")}.html`, source.url).toString();
  const response = await admin.api.post("/api/admin/exams", {
    data: { action: "draft", sourceId: source.id, url: canonical, content },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { ...(await response.json()), url: canonical };
}
export async function publish(admin: Actor, id: string, version = 1): Promise<void> {
  const response = await admin.api.post("/api/admin/exams", {
    data: { action: "publish", id, version },
  });
  expect(response.status(), await response.text()).toBe(200);
}
export async function createTask(actor: Actor): Promise<string> {
  const response = await actor.api.post("/api/tasks", {
    data: {
      name: unique("合成私人任务"),
      description: "仅用于边界验证",
      noticeText: "须提交学籍证明。",
      background: { projectType: "报考", projectStage: "报名", collaborationScope: "individual" },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).task.id;
}
