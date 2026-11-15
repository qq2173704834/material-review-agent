import { randomUUID } from "node:crypto";
import { test, expect } from "../helpers/platform-boundaries";
import collection from "../../src/domain/study-collection.json" with { type: "json" };

test("123份原创资料实际可见且具有独立内容，20类资料包覆盖5条3形式", async ({ actors, page }) => {
  const resources = (await (await actors.student.api.get("/api/learning")).json()).resources;
  const originals = resources.filter((item: { content: { url: string } }) =>
    collection.entries.some((entry) => entry.content.url === item.content.url),
  );
  expect(originals).toHaveLength(123);
  const exams = collection.entries.filter((entry) => entry.content.category !== "education-local");
  const categories = [...new Set(exams.map((entry) => entry.content.category))];
  expect(categories).toHaveLength(20);
  expect(new Set(collection.entries.map((entry) => entry.content.text)).size).toBe(123);
  for (const category of categories) {
    const entries = exams.filter((entry) => entry.content.category === category);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(new Set(entries.map((entry) => entry.content.format)).size).toBeGreaterThanOrEqual(3);
  }
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  for (const category of ["cet4", "ncre", "graduate", "cpa", "education-local"]) {
    const entry = originals.find(
      (item: { content: { category: string } }) => item.content.category === category,
    );
    expect(entry).toBeTruthy();
    const response = await page.goto(entry.content.url);
    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: entry.content.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("本站学习编辑（AI辅助）", { exact: false }).first()).toBeVisible();
  }
});

test("公共基础无目标可发现、可关联私人事项且收藏阅读跨账号隔离", async ({ actors, page }) => {
  const resources = (await (await actors.student.api.get("/api/learning")).json()).resources;
  const entry = resources.find(
    (item: { content: { title: string } }) =>
      item.content.title === collection.entries[100]!.content.title,
  );
  expect(entry).toBeTruthy();
  expect(
    (
      await actors.student.api.post("/api/learning", {
        data: { action: "mark", id: entry.id, field: "saved", value: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await actors.student.api.post("/api/learning", {
        data: { action: "mark", id: entry.id, field: "seen", value: true },
      })
    ).ok(),
  ).toBe(true);
  const own = (await (await actors.student.api.get("/api/learning")).json()).resources.find(
    (item: { id: string }) => item.id === entry.id,
  );
  const other = (await (await actors.peer.api.get("/api/learning")).json()).resources.find(
    (item: { id: string }) => item.id === entry.id,
  );
  expect(own.saved).toBe(true);
  expect(own.seen).toBe(true);
  expect(other.saved).toBe(false);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto(`/learn?category=education-local&q=${encodeURIComponent(entry.content.title)}`);
  await expect(page.getByRole("link", { name: "大学公共基础", exact: true })).toBeVisible();
  await expect(page.getByText(entry.content.title, { exact: true }).first()).toBeVisible();
});

test("原创内容沿用审核发布与撤回，站内链接绑定真实条目", async ({ actors }) => {
  const content = {
    ...collection.entries[0]!.content,
    title: `合成原创维护${randomUUID()}`,
    url: `/learn/${randomUUID().replaceAll("-", "")}`,
  };
  const draft = await actors.admin.api.post("/api/admin/learning", {
    data: { action: "draft", content },
  });
  expect(draft.ok(), await draft.text()).toBe(true);
  const entry = (await draft.json()).entry;
  expect(entry.content.url).toBe(`/learn/${entry.id}`);
  expect(
    (
      await actors.admin.api.post("/api/admin/learning", {
        data: { action: "publish", id: entry.id, version: entry.version },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await (await actors.student.api.get("/api/learning")).json()).resources.some(
      (item: { id: string }) => item.id === entry.id,
    ),
  ).toBe(true);
  const campus = (await (await actors.student.api.get("/api/campus")).json()).state;
  const linkedEvent = {
    id: randomUUID(),
    title: "合成关联资料作业",
    kind: "作业",
    start: "",
    end: "",
    resourceIds: [entry.id],
  };
  const saved = await actors.student.api.post("/api/campus", {
    data: { action: "save", expectedRevision: campus.revision, events: [linkedEvent] },
  });
  expect(saved.ok()).toBe(true);
  const state = (await saved.json()).state;
  expect(
    (
      await actors.admin.api.post("/api/admin/learning", {
        data: { action: "withdraw", id: entry.id, version: entry.version },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await (await actors.student.api.get("/api/learning")).json()).resources.some(
      (item: { id: string }) => item.id === entry.id,
    ),
  ).toBe(false);
  const existing = state.events.find((item: { id: string }) => item.id === linkedEvent.id);
  const complete = await actors.student.api.post("/api/campus", {
    data: {
      action: "save",
      expectedRevision: state.revision,
      events: [{ ...existing, done: true }],
    },
  });
  expect(complete.ok(), await complete.text()).toBe(true);
});
