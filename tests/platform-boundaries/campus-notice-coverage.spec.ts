import { mkdir } from "node:fs/promises";
import { test, expect, createActor } from "../helpers/platform-boundaries";
import type { CampusNotice } from "../../src/domain/campus";

test("北京大学选校后立即有真实通知，查看收藏与首页同步且不写入其他用户记录", async ({
  playwright,
  page,
  actors,
}) => {
  const actor = await createActor(playwright, "campus_content");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  await page.getByRole("textbox", { name: "搜索学校", exact: true }).fill("北京大学");
  await page.getByRole("combobox", { name: "学校", exact: true }).selectOption("moe-4111010001");
  await page.getByRole("button", { name: "保存学校", exact: true }).click();
  const selected = await (await actor.api.get("/api/campus")).json();
  const notices = selected.notices as CampusNotice[];
  expect(notices.length).toBeGreaterThan(0);
  expect(notices.every((notice) => notice.schoolId === "moe-4111010001")).toBe(true);
  const newest = notices[0];
  if (!newest) throw new Error("北京大学通知快照缺失。");
  const card = page.locator(`#notice-${newest.id}`);
  await expect(card.getByRole("heading", { name: newest.title, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "学校信息与通知入口", exact: true })).toContainText(
    `${notices.length} 条`,
  );
  await expect(page.getByRole("link", { name: "教务部通知 ↗", exact: true })).toHaveAttribute(
    "href",
    "https://dean.pku.edu.cn/web/notice.php",
  );
  await page.getByRole("checkbox", { name: "我的收藏", exact: true }).check();
  await expect(page.getByText("没有符合筛选条件的通知。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看全部通知", exact: true }).click();
  await card.getByRole("button", { name: "查看通知", exact: true }).click();
  await expect(card).toContainText(newest.text.slice(-60));
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  const state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(state.reads[newest.id]).toBe(newest.digest);
  expect(state.favorites).toContain(newest.id);
  const peer = (await (await actors.peer.api.get("/api/campus")).json()).state;
  expect(peer.reads[newest.id]).toBeUndefined();
  expect(peer.favorites).not.toContain(newest.id);
  expect(
    (
      await actors.peer.api.post("/api/admin/campus", {
        data: { action: "collect", id: "pku-dean" },
      })
    ).status(),
  ).toBe(403);
  await mkdir("outputs/eng-099", { recursive: true });
  await page.screenshot({ path: "outputs/eng-099/pku-notices-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/eng-099/pku-notices-mobile.png", fullPage: true });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "本校重要通知", exact: true })).toContainText(
    newest.title,
  );
  await actor.api.dispose();
});

test("新增各校通知按选校返回，未收录学校展示真实空态和查找入口", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "campus_coverage");
  for (const schoolId of [
    "moe-4132010284",
    "moe-4134010358",
    "moe-4142010486",
    "moe-4144010558",
    "moe-4151010610",
  ]) {
    const state = (await (await actor.api.get("/api/campus")).json()).state;
    const result = await actor.api.post("/api/campus", {
      data: {
        action: "preferences",
        expectedRevision: state.revision,
        preferences: { ...state.preferences, schoolId },
      },
    });
    expect(result.ok()).toBe(true);
    const body = await result.json();
    expect(body.notices.length).toBeGreaterThan(0);
    expect(body.notices.every((notice: CampusNotice) => notice.schoolId === schoolId)).toBe(true);
  }
  const state = (await (await actor.api.get("/api/campus")).json()).state;
  await actor.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: state.revision,
      preferences: { ...state.preferences, schoolId: "moe-4154010694" },
    },
  });
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  await expect(page.getByRole("heading", { name: "西藏大学", exact: true })).toBeVisible();
  await expect(
    page.getByText("暂未收录本校通知。可先查找学校通知，或到我的日程导入收到的消息。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "查找学校通知 ↗", exact: true })).toHaveAttribute(
    "href",
    /bing\.com\/search\?q=/u,
  );
  await expect(page.getByText(/通知正在整理/u)).toHaveCount(0);
  await actor.api.dispose();
});
import { randomUUID } from "node:crypto";

test("中山多条外链通知可读原文收藏，但不能冒充正文创建安排或审查", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "sysu_links");
  const before = (await (await actor.api.get("/api/campus")).json()).state;
  await actor.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: before.revision,
      preferences: { ...before.preferences, schoolId: "moe-4144010558" },
    },
  });
  const body = await (await actor.api.get("/api/campus")).json();
  const external = (body.notices as CampusNotice[]).filter(
    (n) => n.contentStatus === "external_link",
  );
  expect(external.length).toBeGreaterThan(10);
  const notice = external[0]!;
  expect(notice.text).toBe("");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  const card = page.locator(`#notice-${notice.id}`);
  await expect(card.getByRole("link", { name: "阅读原文 ↗", exact: true })).toHaveAttribute(
    "href",
    notice.url,
  );
  await expect(card.getByRole("button", { name: "查看通知", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /加入日程/ })).toHaveCount(0);
  const popup = page.waitForEvent("popup");
  await page
    .context()
    .route("https://mp.weixin.qq.com/**", (route) =>
      route.fulfill({ body: "外链阅读测试，不访问真实微信" }),
    );
  await card.getByRole("link", { name: "阅读原文 ↗", exact: true }).click();
  await (await popup).close();
  await expect(card).toContainText("已读");
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  const state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(state.reads[notice.id]).toBe(notice.digest);
  expect(state.favorites).toContain(notice.id);
  const rejected = await actor.api.post("/api/campus", {
    data: {
      action: "save",
      expectedRevision: state.revision,
      events: [
        {
          id: randomUUID(),
          title: notice.title,
          kind: "其他",
          start: "2026-12-01",
          end: "",
          sourceId: notice.id,
          sourceDigest: notice.digest,
        },
      ],
    },
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toContain("阅读原文后自行添加日程");
  expect(
    (
      await actor.api.post("/api/campus/review", { data: { id: notice.id, digest: notice.digest } })
    ).status(),
  ).toBe(400);
  const answer = await actor.api.post("/api/assistant", {
    data: { requestId: randomUUID(), question: "学校校园有什么新通知", useContext: false },
  });
  expect(answer.ok(), await answer.text()).toBe(true);
  expect(
    (await answer.json()).citations.every(
      (c: { id: string }) => !external.some((n) => n.id === c.id),
    ),
  ).toBe(true);
  await mkdir("outputs/eng-101", { recursive: true });
  await page.screenshot({ path: "outputs/eng-101/sysu-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/eng-101/sysu-mobile.png", fullPage: false });
  await actor.api.dispose();
});
