import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  test,
  expect,
  createActor,
  draft,
  publish,
  noticeContent,
} from "../helpers/platform-boundaries";

test("BUG047移除目标清除依赖且saved=0不启用收藏筛选", async ({ actors, page }) => {
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国" } },
      })
    ).json()
  ).goal;
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto(`/learn?goal=${goal.id}&subject=合成科目&stage=合成阶段&q=合成&page=2`);
  await page.getByRole("link", { name: "移除考试目标筛选", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("goal")).toBe(false);
  expect(new URL(page.url()).searchParams.has("subject")).toBe(false);
  expect(new URL(page.url()).searchParams.has("stage")).toBe(false);
  expect(new URL(page.url()).searchParams.get("q")).toBe("合成");
  await page.goto("/learn?saved=0");
  await expect(page.getByRole("link", { name: "移除只看收藏筛选" })).toHaveCount(0);
  expect(await page.locator(".resource-card").count()).toBeGreaterThan(0);
});

test("BUG048零结果清除条件后可找到已发布公告", async ({ actors, page }) => {
  const item = await draft(actors.admin, noticeContent({ title: `审查合成公告-${randomUUID()}` }));
  await publish(actors.admin, item.id);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto(`/exams?q=没有匹配-${randomUUID()}`);
  await page.getByRole("link", { name: "清除筛选", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: (await (await actors.admin.api.get("/api/admin/exams")).json()).notices.find(
        (n: { id: string }) => n.id === item.id,
      ).content.title,
      exact: true,
    }),
  ).toBeVisible();
});

test("BUG049仅预览取消导入不会产生未保存拦截", async ({ actors, page }) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto("/tasks/new");
  await page.getByRole("button", { name: "从我的考试导入", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索已选考试" }).fill("合成搜索");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.accept();
  });
  await page.getByRole("link", { name: "返回任务列表", exact: false }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  expect(dialogs).toBe(0);
});

test("BUG050收起偏好保留未保存输入且放弃操作明确", async ({ playwright, browser }) => {
  const actor = await createActor(playwright, "auditpref");
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  const page = await context.newPage();
  await page.goto("/learn");
  const toggle = page.getByText("学习偏好", { exact: true }).first();
  await toggle.click();
  const form = page.getByRole("form", { name: "学习与隐私偏好" });
  await form.getByLabel("使用AI生成回答").uncheck();
  await toggle.click();
  await toggle.click();
  await expect(form.getByLabel("使用AI生成回答")).not.toBeChecked();
  await form.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(form.getByLabel("使用AI生成回答")).toBeChecked();
  await form.getByLabel("使用AI生成回答").uncheck();
  await page.route("**/api/learning", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "合成保存失败" } })
      : route.continue(),
  );
  await form.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("保存失败");
  await toggle.click();
  await toggle.click();
  await expect(form.getByLabel("使用AI生成回答")).not.toBeChecked();
  await page.unroute("**/api/learning");
  await page
    .locator(".resource-card")
    .first()
    .getByRole("button", { name: "未看", exact: true })
    .click();
  await expect(
    page.locator(".resource-card").first().getByRole("button", { name: "已看", exact: true }),
  ).toBeVisible();
  await expect(form.getByLabel("使用AI生成回答")).not.toBeChecked();
  await form.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("偏好已保存");
  expect((await (await actor.api.get("/api/learning")).json()).preferences.externalEnabled).toBe(
    false,
  );
  await page.reload();
  await page.getByText("学习偏好", { exact: true }).first().click();
  await expect(
    page.getByRole("form", { name: "学习与隐私偏好" }).getByLabel("使用AI生成回答"),
  ).not.toBeChecked();
  await context.close();
  await actor.api.dispose();
});

function assistantState(
  messages: Array<{ role: string; payload: { answer: string } }> = [],
): object {
  return {
    mode: "mock",
    policy: { enabled: true, hourlyLimit: 100 },
    usage: {
      questions: 0,
      failed: 0,
      modelRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknownTokenCalls: 0,
    },
    conversations: [
      { id: "first", title: "合成第一会话" },
      { id: "last", title: "合成最后会话" },
    ],
    goals: [],
    messages,
  };
}

test("助手回答期间的新草稿保留且失败重试复用请求号", async ({ actors, page }) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestIds: string[] = [];
  await page.route("**/api/assistant**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: assistantState() });
    requestIds.push(route.request().postDataJSON().requestId);
    if (requestIds.length === 1)
      return route.fulfill({ status: 503, json: { error: "合成暂时失败" } });
    await gate;
    return route.fulfill({ json: { answer: "合成完成回答", citations: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开考试学习AI助手" }).click();
  const dialog = page.getByRole("dialog", { name: "考试学习AI助手" });
  const input = dialog.getByRole("textbox", { name: "你的问题" });
  await input.fill("第一条问题");
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "合成暂时失败" })).toBeVisible();
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "正在回答…" })).toBeVisible();
  await input.fill("下一条不应被删除的草稿");
  release?.();
  await expect(dialog.getByText("合成完成回答", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("下一条不应被删除的草稿");
  expect(requestIds[1]).toBe(requestIds[0]);
});

test("助手快速切换会话后旧响应不能覆盖最后选择", async ({ actors, page }) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let finished: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const firstFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/assistant**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("conversation");
    if (id === "first") {
      started?.();
      await gate;
    }
    try {
      await route.fulfill({
        json: assistantState(
          id
            ? [
                {
                  role: "assistant",
                  payload: { answer: id === "first" ? "过时的第一会话" : "最后选择的会话" },
                },
              ]
            : [],
        ),
      });
    } finally {
      if (id === "first") finished?.();
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开考试学习AI助手" }).click();
  const dialog = page.getByRole("dialog", { name: "考试学习AI助手" });
  await dialog.getByText("历史会话", { exact: true }).click();
  const select = dialog.getByLabel("私有会话");
  await expect(select.locator("option")).toHaveCount(3);
  await select.selectOption("first");
  await firstStarted;
  await select.selectOption("last");
  await expect(dialog.getByText("最后选择的会话", { exact: true })).toBeVisible();
  release?.();
  await firstFinished;
  // Let the released fetch finish parsing before checking that its stale payload was ignored.
  await page.waitForTimeout(250);
  await expect(dialog.getByText("最后选择的会话", { exact: true })).toBeVisible();
  await expect(dialog.getByText("过时的第一会话", { exact: true })).toHaveCount(0);
});

test("导入预览独立重试、搜索保留已选摘要且旧响应不覆盖", async ({ actors, page }) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  const first = randomUUID(),
    last = randomUUID(),
    selection = `goal:${randomUUID()}`;
  let releaseFirst: (() => void) | undefined, releaseLast: (() => void) | undefined;
  const firstGate = new Promise<void>((r) => {
    releaseFirst = r;
  });
  const lastGate = new Promise<void>((r) => {
    releaseLast = r;
  });
  let listReads = 0,
    lastReads = 0;
  await page.route("**/api/exam-import**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("notice");
    if (!id) {
      listReads++;
      return route.fulfill({
        json: {
          options: [
            {
              key: selection,
              group: "我的考试目标",
              label: "合成考试目标",
              candidates: [
                { id: first, title: "第一场", region: "全国", edition: "合成甲", version: 1 },
                { id: last, title: "最后场", region: "全国", edition: "合成乙", version: 1 },
              ],
            },
          ],
        },
      });
    }
    if (id === first) await firstGate;
    if (id === last && ++lastReads === 1)
      return route.fulfill({ status: 503, json: { error: "合成预览失败" } });
    if (id === last) await lastGate;
    return route.fulfill({
      json: {
        preview: {
          selection,
          id,
          version: 1,
          title: id === first ? "过期第一场" : "最后选定场次",
          region: "全国",
          edition: "合成",
          url: "https://example.org/synthetic",
          text: "须提交合成证明材料。",
          scope: "全文",
          usable: true,
          warning: "",
          existingTaskId: null,
        },
      },
    });
  });
  await page.goto("/tasks/new");
  await page.getByRole("button", { name: "从我的考试导入", exact: true }).click();
  await page.getByLabel("选择已保存的考试").selectOption(selection);
  await page.getByLabel("选择适用公告").selectOption(first);
  await page.getByLabel("选择适用公告").selectOption(last);
  const picker = page.getByRole("region", { name: "选择我的考试" });
  await expect(picker.getByRole("alert")).toBeVisible();
  await picker.getByRole("button", { name: "重试", exact: true }).click();
  await expect(picker.getByRole("button", { name: "确认导入", exact: true })).toHaveCount(0);
  releaseLast?.();
  await expect(picker.getByText("最后选定场次", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索已选考试" }).fill("不匹配任何考试");
  await expect(page.getByLabel("选择已保存的考试")).toHaveValue(selection);
  await expect(picker.getByText("已选：合成考试目标", { exact: true })).toBeVisible();
  releaseFirst?.();
  await page.waitForTimeout(250);
  await expect(picker.getByText("过期第一场", { exact: true })).toHaveCount(0);
  expect(listReads).toBe(1);
});

test("字体本地加载、多页面缩放与实际截图，失败时系统字体可用", async ({ actors, browser }) => {
  test.setTimeout(180000);
  await mkdir("outputs/eng-086", { recursive: true });
  const item = await draft(
    actors.admin,
    noticeContent({ title: "合成展示 · 字体与阅读体验", edition: "合成展示场次" }),
  );
  await publish(actors.admin, item.id);
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
      })
    ).json()
  ).goal;
  const resource = (await (await actors.student.api.get("/api/learning")).json()).resources[0];
  const ctx = await browser.newContext({
    storageState: await actors.student.api.storageState(),
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const fontUrls = new Set<string>();
  page.on("request", (r) => {
    if (r.resourceType() === "font") fontUrls.add(r.url());
  });
  const paths: [string, string][] = [
    ["home", "/"],
    ["learn", "/learn"],
    ["exams", "/exams"],
    ["exam", `/exams/${item.id}`],
    ["resource", `/learn/${resource.id}`],
    ["goals", "/me"],
    ["account", "/account"],
    ["new-task", "/tasks/new"],
  ];
  for (const view of ["overview", "calendar", "roadmap", "plan", "materials", "records"])
    paths.push([view, `/me/preparation?goal=${goal.id}&view=${view}`]);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of paths) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${name} ${width}`,
      ).toBe(true);
      if ([390, 1280].includes(width) && ["home", "learn", "overview", "new-task"].includes(name))
        await page.screenshot({ path: `outputs/eng-086/${name}-${width}.png`, fullPage: true });
      if (width === 390 && name === "learn")
        await page.screenshot({ path: "outputs/eng-086/learn-viewport-390.png" });
      if (width === 1280) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${name} 200% text`,
        ).toBe(true);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
      if (width === 1280)
        for (const zoom of [1.25, 1.5]) {
          await page.evaluate((z) => {
            document.body.style.zoom = String(z);
          }, zoom);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${name} zoom ${zoom}`,
          ).toBe(true);
          await page.evaluate(() => {
            document.body.style.zoom = "";
          });
        }
    }
  }
  await page.goto("/learn");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('400 16px "Study Sans"', "考试学习"))).toBe(
    true,
  );
  expect([...fontUrls].length).toBeGreaterThan(0);
  expect([...fontUrls].every((url) => url.startsWith("http://127.0.0.1:3132/fonts/"))).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await ctx.close();
  const fallback = await browser.newContext({
    storageState: await actors.student.api.storageState(),
  });
  const fallbackPage = await fallback.newPage();
  await fallbackPage.route("**/fonts/**", (route) => route.abort());
  await fallbackPage.goto("/learn");
  await fallbackPage.evaluate(() => document.fonts.ready);
  await expect(fallbackPage.getByRole("heading", { name: "学习资源" })).toBeVisible();
  expect(await fallbackPage.locator(".resource-card").count()).toBeGreaterThan(0);
  await fallback.close();
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const login = await publicContext.newPage();
  for (const width of [390, 1280]) {
    await login.setViewportSize({ width, height: 900 });
    await login.goto("/login");
    await login.evaluate(() => document.fonts.ready);
    await expect(login.getByRole("button", { name: "登录", exact: true })).toBeVisible();
    expect(await login.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await login.screenshot({ path: `outputs/eng-086/login-${width}.png`, fullPage: true });
  }
  await publicContext.close();
});
