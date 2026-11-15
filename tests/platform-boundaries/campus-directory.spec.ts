import { test, expect, createActor } from "../helpers/platform-boundaries";
import { mkdir } from "node:fs/promises";

test("全国目录按名称简称与省份选择、刷新保留，未接通知准确展示且不影响其他账号", async ({
  actors,
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "campus_national");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  const selector = page.getByRole("combobox", { name: "学校", exact: true });
  expect(await selector.getByRole("option").count()).toBeLessThanOrEqual(42);
  await page.getByRole("textbox", { name: "搜索学校", exact: true }).fill("北大");
  await selector.selectOption("moe-4111010001");
  await page.getByRole("button", { name: "保存学校", exact: true }).click();
  await expect(page.getByRole("heading", { name: "北京大学", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "2027届本科预毕业生学历学位照片拍摄通知", exact: true }),
  ).toBeVisible();
  let state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(state.preferences.schoolId).toBe("moe-4111010001");
  expect(
    (await (await actors.peer.api.get("/api/campus")).json()).state.preferences.schoolId,
  ).not.toBe("moe-4111010001");
  await page.reload();
  await expect(page.getByRole("heading", { name: "北京大学", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "我的学校", exact: true }).click();
  await page
    .getByRole("combobox", { name: "学校所在地区", exact: true })
    .selectOption("西藏自治区");
  await page.getByRole("textbox", { name: "搜索学校", exact: true }).fill("西藏大学");
  await selector.selectOption("moe-4154010694");
  await page.getByRole("button", { name: "保存学校", exact: true }).click();
  await expect(page.getByRole("heading", { name: "西藏大学", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查找学校通知 ↗", exact: true })).toHaveAttribute(
    "href",
    /bing\.com\/search\?q=/u,
  );
  state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(
    (
      await actor.api.post("/api/campus", {
        data: {
          action: "preferences",
          expectedRevision: state.revision,
          preferences: { ...state.preferences, schoolId: "moe-fake" },
        },
      })
    ).status(),
  ).toBe(400);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "本校重要通知", exact: true })).toContainText(
    "暂未收录本校通知，可查看学校信息或管理个人日程。",
  );
  await actor.api.dispose();
});

test("申请面板也支持全国名称匹配和限量，无需重复申请已有学校", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "campus_alias");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  await page.getByText("没有找到学校？申请添加学校", { exact: true }).click();
  await page.getByRole("textbox", { name: "学校名称", exact: true }).fill("大学");
  await expect(page.getByText(/先显示8所，请继续输入学校名称/)).toBeVisible();
  await page.getByRole("textbox", { name: "学校名称", exact: true }).fill("浙大");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("outputs/eng-098", { recursive: true });
  await page.screenshot({
    path: "outputs/eng-098/national-school-search-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "选择浙江大学", exact: true }).click();
  await expect(page.getByRole("heading", { name: "浙江大学", exact: true })).toBeVisible();
  expect((await (await actor.api.get("/api/campus")).json()).state.preferences.schoolId).toBe(
    "moe-4133010335",
  );
  await actor.api.dispose();
});
