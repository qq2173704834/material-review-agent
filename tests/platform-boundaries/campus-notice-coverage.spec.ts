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
    `已收录 ${notices.length} 条通知`,
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
