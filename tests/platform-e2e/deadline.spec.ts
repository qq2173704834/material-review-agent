import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
test("ENG-047 截止提醒跨页面一致，日期精度与实时到期正确且手机不溢出", async ({ browser }) => {
  test.setTimeout(120000);
  const directory = resolve(process.env.REVIEW_POLISH_TEST_DATA_DIR ?? ".local-data/platform-e2e");
  if (!["platform-e2e", "polish-e2e"].includes(basename(directory)))
    throw new Error("仅允许专用隔离数据目录。");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const suffix = Date.now().toString(36),
    username = `polish_${suffix}`,
    password = "Polish-regression-2026!";
  const iso = (time: number): string =>
    new Date(time + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";
  const now = Date.now(),
    end = now + 2 * 86400000 + 3600000;
  const longTitle = `2026年度全国硕士研究生招生报名与资格审查安排的补充说明（仅供界面回归验证）-${suffix}`;
  try {
    expect(
      (await context.request.post("/api/auth/register", { data: { username, password } })).status(),
    ).toBe(201);
    execFileSync(process.execPath, [
      "scripts/platform-admin.mjs",
      "role",
      "--username",
      username,
      "--role",
      "admin",
      "--apply",
      "--data-dir",
      directory,
    ]);
    expect(
      (await context.request.post("/api/auth/login", { data: { username, password } })).ok(),
    ).toBeTruthy();
    const source = (await (await context.request.get("/api/admin/exams")).json()).sources.find(
      (s: { category: string }) => s.category === "cet4",
    );
    const definitions = [
      ["精确", iso(now - 3600000), iso(end), "招考报名"],
      ["日期", iso(now - 86400000).slice(0, 10), iso(now + 3 * 86400000).slice(0, 10), "招考报名"],
      ["成绩", "", "", "成绩"],
      ["长标题", iso(now - 3600000), iso(end), "招考报名"],
    ] as const;
    const ids: Record<string, string> = {};
    for (const [k, start, finish, stage] of definitions) {
      const text = `合成回归：${start}至${finish}。`;
      const content = {
        title: k === "长标题" ? longTitle : `合成截止${k}-${suffix}`,
        category: "cet4",
        region: "全国",
        edition: "合成回归",
        year: 2026,
        stage,
        organizer: "合成测试",
        publishedAt: "2026-11-14",
        text,
        summary: "仅供隔离回归。",
        audience: "合成测试",
        timeline: finish
          ? [
              { label: "报名开始", value: start, quote: text },
              { label: "报名截止", value: finish, quote: text },
            ]
          : [],
        attachments: [],
        disposition: "正常",
        ...(stage === "成绩" ? { textScope: "摘录" } : {}),
      };
      const response = await context.request.post("/api/admin/exams", {
        data: {
          action: "draft",
          sourceId: source.id,
          url: `https://cet.neea.edu.cn/synthetic-deadline-${k}-${suffix}`,
          content,
        },
      });
      expect(response.ok()).toBeTruthy();
      ids[k] = (await response.json()).id;
      expect(
        (
          await context.request.post("/api/admin/exams", {
            data: { action: "publish", id: ids[k], version: 1 },
          })
        ).ok(),
      ).toBeTruthy();
    }
    const page = await context.newPage();
    await page.goto("/admin/exams");
    await expect(page.getByText("官方来源与受控调度", { exact: true })).toBeVisible();
    const sourceSearch = page.getByLabel("搜索来源名称、地区或网址");
    await sourceSearch.fill("不存在的隔离来源名称");
    await expect(
      page.getByText("没有匹配的来源，请调整搜索或状态筛选。", { exact: true }),
    ).toBeVisible();
    await sourceSearch.fill(source.name);
    await expect(page.getByRole("link", { name: source.name, exact: true })).toBeVisible();
    await page.getByLabel("来源状态", { exact: true }).selectOption("enabled");
    await expect(
      page.getByText("没有匹配的来源，请调整搜索或状态筛选。", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("来源状态", { exact: true }).selectOption("disabled");
    await expect(page.getByRole("link", { name: source.name, exact: true })).toBeVisible();
    await page.goto("/?tab=latest");
    await expect(page.getByRole("link", { name: "内容管理", exact: true })).toBeVisible();
    const exact = page.getByRole("article", { name: `合成截止精确-${suffix}`, exact: true });
    await expect(exact.getByLabel("考试状态")).toHaveText("可报名");
    await expect(exact.getByLabel("报名截止提醒")).toContainText(/距报名截止2天/);
    const date = page.getByRole("article", { name: `合成截止日期-${suffix}`, exact: true });
    await expect(date.getByLabel("报名截止提醒")).toContainText("具体时刻待确认");
    const score = page.getByRole("article", { name: `合成截止成绩-${suffix}`, exact: true });
    await expect(score.getByLabel("考试状态")).toHaveText("成绩查询");
    await expect(score.getByLabel("报名截止提醒")).toHaveCount(0);
    const longHeading = page
      .getByRole("article", { name: longTitle, exact: true })
      .getByRole("heading");
    expect(
      await longHeading.evaluate((node) => {
        const lines =
          node.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(node).lineHeight);
        return lines > 0 && Math.abs(lines - Math.round(lines)) < 0.05;
      }),
    ).toBeTruthy();
    await page.screenshot({ path: "work/polish-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: "work/polish-mobile.png", fullPage: true });
    await page.goto(`/exams/${ids["精确"]}`);
    await expect(page.getByLabel("报名截止提醒")).toContainText("距报名截止");
    expect(
      (
        await context.request.post(`/api/exams/${ids["精确"]}`, { data: { action: "favorite" } })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/me?view=favorites");
    await expect(page.getByLabel("报名截止提醒")).toContainText("距报名截止");
    await page.goto(`/exams?q=${encodeURIComponent(`合成截止精确-${suffix}`)}`);
    await expect(page.getByLabel("报名截止提醒")).toContainText("距报名截止");
    await page.goto(`/exams/${ids["成绩"]}`);
    await expect(
      page.getByRole("heading", { name: "原文摘录（非全文）", exact: true }),
    ).toBeVisible();
    await page.clock.install({ time: new Date(end - 60000) });
    await page.goto(`/exams/${ids["精确"]}`);
    await page.getByRole("button", { name: "取消收藏", exact: true }).click();
    await expect(page.getByRole("button", { name: "收藏公告", exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByLabel("报名截止提醒")).toContainText("距报名截止1分钟");
    await page.clock.runFor(90000);
    await expect(page.getByLabel("报名截止提醒")).toContainText("报名已截止");
    await expect(page.getByLabel("考试状态")).toHaveText("报名已截止");
  } finally {
    await context.close();
  }
});
