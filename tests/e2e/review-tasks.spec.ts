import { expect, test } from "@playwright/test";

test.describe("本地审查任务 ENG-004 / ENG-005", () => {
  test("创建任务、刷新恢复并保存通知新版本", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveTitle("材料预审工作台");
    await page.getByRole("link", { name: "新建审查任务" }).click();
    await page.getByLabel("任务名称").fill("E2E 合成任务 ENG-004");
    await page.getByLabel("项目类型").fill("合成项目");
    await page.getByLabel("项目阶段").fill("测试阶段");
    await page.getByLabel("参与范围").selectOption("team");
    await page.getByLabel("任务说明").fill("只包含浏览器验收使用的合成数据。");
    await page
      .getByRole("textbox", { name: "通知或要求原文" })
      .fill(
        "合成通知标题\n第一项要求：提交一份说明。\n第二项要求：文件不超过 5 MB。\n可选提供 PDF。\n规格：PDF 格式，文件不超过 5 MB，页数不超过 20 页。",
      );
    await page.getByRole("button", { name: "创建审查任务" }).click();

    await expect(page.getByRole("heading", { name: "E2E 合成任务 ENG-004" })).toBeVisible();
    await expect(page.getByText("版本 1 · 当前版本")).toBeVisible();
    await page.getByRole("button", { name: "从通知生成草稿" }).click();
    await expect(page.getByText("模拟模式", { exact: true })).toBeVisible();
    await expect(page.getByText(/必须.*可用确定性工具检查/).first()).toBeVisible();
    await expect(page.getByText(/字符 7–19/)).toBeVisible();
    await expect(page.getByText(/可选/).first()).toBeVisible();
    await expect(page.locator("ol.divide-y > li")).toHaveCount(6);
    const pageLimitRule = page.locator("ol.divide-y > li").filter({ hasText: "页数不超过 20 页" });
    await expect(pageLimitRule.getByText("页数不超过 20 页", { exact: true })).toBeVisible();
    const initialRuleSetsResponse = await page.request.get(
      page.url().replace(/\/tasks\//, "/api/tasks/") + "/rules",
    );
    expect(initialRuleSetsResponse.ok()).toBe(true);
    const initialRuleSetsBody: unknown = await initialRuleSetsResponse.json();
    expect(JSON.stringify(initialRuleSetsBody)).toContain('"mode":"mock"');
    await page.getByText("查看原文段落位置").click();
    await expect(page.getByText(/字符 0–6/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("项目类型")).toHaveValue("合成项目");
    await expect(page.getByLabel("参与范围")).toHaveValue("team");
    await expect(page.getByRole("textbox", { name: "通知或要求原文" })).toHaveValue(/提交一份说明/);

    await page
      .getByRole("textbox", { name: "通知或要求原文" })
      .fill("修订后的合成通知\n仍然保留旧版本内容。");
    await page.getByLabel("项目阶段").fill("复核阶段");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByText("版本 2 · 当前版本")).toBeVisible();
    const versionOne = page.locator("li.border-l-2").filter({ hasText: "版本 1" });
    await expect(versionOne.locator("p").first()).toContainText("合成通知标题");
    await expect(page.getByLabel("项目阶段")).toHaveValue("复核阶段");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "通知或要求原文" })).toHaveValue(
      /修订后的合成通知/,
    );
    await expect(page.getByText(/通知 v1 的规则草稿/)).toBeVisible();
    await page.getByRole("button", { name: "从通知生成草稿" }).click();
    await expect(page.getByText(/通知 v1 的规则草稿/)).toHaveCount(0);
    await expect(page.getByText(/修订后的合成通知/).first()).toBeVisible();

    const response = await page.request.get("/api/tasks");
    expect(response.ok()).toBe(true);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain("E2E 合成任务 ENG-004");

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });

  test("从上一版数据库升级并保留原任务和通知", async ({ page, request }) => {
    const taskResponse = await request.get("/api/tasks/00000000-0000-4000-8000-000000000004");
    expect(taskResponse.ok()).toBe(true);
    const body: unknown = await taskResponse.json();
    expect(body).toMatchObject({
      task: {
        name: "E2E 遗留任务 ENG-004",
        background: {
          projectType: "合成项目",
          projectStage: "历史阶段",
          collaborationScope: "team",
        },
        noticeSource: { version: 1, originalText: "遗留版本通知\n提交一份说明。" },
      },
    });

    const ruleSetsResponse = await request.get(
      "/api/tasks/00000000-0000-4000-8000-000000000004/rules",
    );
    expect(ruleSetsResponse.ok()).toBe(true);
    await page.goto("/tasks/00000000-0000-4000-8000-000000000004");
    await expect(page.getByRole("heading", { name: "E2E 遗留任务 ENG-004" })).toBeVisible();
  });

  test("拒绝空通知、非法任务编号并报告本地 SQLite 状态", async ({ request }) => {
    const invalidJson = await request.post("/api/tasks", { data: { noticeText: "  " } });
    expect(invalidJson.status()).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: "请填写通知或项目要求的原文。" });

    const invalidTaskId = await request.get("/api/tasks/not-a-uuid");
    expect(invalidTaskId.status()).toBe(400);

    const missingTask = await request.get("/api/tasks/00000000-0000-4000-8000-000000000000");
    expect(missingTask.status()).toBe(404);

    const taskOne = await request.post("/api/tasks", {
      data: { name: "隔离检查 A", noticeText: "A 项目的合成通知" },
    });
    const taskTwo = await request.post("/api/tasks", {
      data: { name: "隔离检查 B", noticeText: "B 项目的合成通知" },
    });
    expect(taskOne.status()).toBe(201);
    expect(taskTwo.status()).toBe(201);
    const taskOneBody: unknown = await taskOne.json();
    const taskTwoBody: unknown = await taskTwo.json();
    expect(taskOneBody).toMatchObject({
      task: { name: "隔离检查 A", noticeSource: { originalText: "A 项目的合成通知" } },
    });
    expect(taskTwoBody).toMatchObject({
      task: { name: "隔离检查 B", noticeSource: { originalText: "B 项目的合成通知" } },
    });

    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(health.headers()["cache-control"]).toBe("no-store");
    expect(await health.json()).toEqual({
      status: "ok",
      application: "material-review-agent",
      runtime: {
        mode: "mock",
        hasModelConfiguration: false,
        modelIntegration: "not_implemented",
        storage: "local_sqlite",
      },
    });
  });

  test("不存在的页面提供可用返回入口", async ({ page }) => {
    const response = await page.goto("/missing-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
    await page.getByRole("link", { name: "返回任务列表" }).click();
    await expect(page.getByRole("heading", { name: "我的审查任务" })).toBeVisible();
  });
});
