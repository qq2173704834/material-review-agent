import { randomUUID } from "node:crypto";
import { test, expect, draft, publish, noticeContent } from "../helpers/platform-boundaries";

test("UXR维护页面及模型诊断只允许管理员，普通业务页没有开发入口", async ({ actors, page }) => {
  for (const path of ["/setup", "/admin/system", "/api/model/test"]) {
    const response = path.startsWith("/api/")
      ? await actors.student.api.post(path)
      : await actors.student.api.get(path);
    expect(response.status(), path).toBe(403);
  }
  expect((await actors.admin.api.get("/admin/system")).status()).toBe(200);
  // Mock mode cannot issue a real model test; admin reaches the handler rather than a role rejection.
  expect((await actors.admin.api.post("/api/model/test")).status()).not.toBe(403);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  for (const path of ["/", "/me", "/learn", "/tasks"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "本地环境", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/setup"]')).toHaveCount(0);
  }
  await page.goto("/tasks");
  await expect(page.getByText("从要求到复检，每一步都有记录")).toHaveCount(0);
  await page.getByRole("button", { name: "怎么用 · 3步上手" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "跳过 / 关闭引导" }).click();
});

test("UXR个人内容按标签展示且收藏反馈仍按账号隔离", async ({ actors, page }) => {
  const content = noticeContent({ title: `UXR收藏-${randomUUID()}` });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, {
        data: { action: "favorite" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await actors.student.api.post("/api/feedback", {
        data: {
          kind: "资料问题",
          note: "本人专属资料问题",
          id: (await (await actors.student.api.get("/api/learning")).json()).resources[0].id,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto("/me");
  await expect(
    page
      .getByRole("navigation", { name: "我的备考导航" })
      .getByRole("link", { name: "考试目标", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "我的内容反馈", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "材料预审执行提示" })).toHaveCount(0);
  await page.getByText("收藏与个人工具", { exact: true }).click();
  await page.getByRole("link", { name: /我的收藏/ }).click();
  await expect(page.getByRole("link", { name: content.title, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "我的反馈", exact: true }).click();
  await expect(page.getByText(/资料问题 · 待处理/)).toBeVisible();
  await page.getByRole("link", { name: "材料记录", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看全部材料预审任务" })).toBeVisible();
  expect((await (await actors.peer.api.get("/api/feedback")).json()).items).toHaveLength(0);
});

test("UXR偏好保存独立操作行，失败保留输入且持久关闭AI不可被旧客户端覆盖", async ({
  actors,
  page,
}) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto("/learn");
  const form = page.getByRole("form", { name: "学习与隐私偏好" });
  await page.getByText("学习偏好", { exact: true }).first().click();
  await form.getByLabel("使用AI生成回答").uncheck();
  await page.route("**/api/learning", (route) =>
    route.fulfill({ status: 503, json: { error: "合成保存失败" } }),
  );
  await form.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("保存失败");
  await expect(form.getByLabel("使用AI生成回答")).not.toBeChecked();
  await page.unroute("**/api/learning");
  await form.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("偏好已保存");
  expect(
    (await (await actors.student.api.get("/api/learning")).json()).preferences.externalEnabled,
  ).toBe(false);
  await actors.student.api.post("/api/learning", {
    data: { action: "preferences", personalized: true, retainChat: false },
  });
  expect(
    (await (await actors.student.api.get("/api/learning")).json()).preferences.externalEnabled,
  ).toBe(false);
  expect(
    (await (await actors.peer.api.get("/api/learning")).json()).preferences.externalEnabled,
  ).toBe(true);
  const response = await actors.student.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "请讲解代数基础并给出复习建议",
      learning: true,
      allowExternal: true,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toMatchObject({ mode: "retrieval", usage: { modelCall: null } });
  await page.reload();
  await page.getByText("学习偏好", { exact: true }).first().click();
  await expect(form.getByLabel("使用AI生成回答")).not.toBeChecked();
});

test("UXR助手无需逐次勾选即可发送，快捷问题和上下文选择保留", async ({ actors, page }) => {
  await page.context().addCookies((await actors.peer.api.storageState()).cookies);
  await page.goto("/");
  await page.getByRole("button", { name: "打开考试学习AI助手" }).click();
  const panel = page.getByRole("dialog", { name: "考试学习AI助手" });
  await expect(panel.getByText(/允许将本次问题/)).toHaveCount(0);
  await expect(panel.getByText(/输入\/输出Token|费用未知|每小时可提问/)).toHaveCount(0);
  await expect(panel.getByText("模拟模式，未调用真实模型", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "隐私设置" })).toBeVisible();
  await panel.getByRole("button", { name: "请帮我安排一周的基础复习计划。" }).click();
  const requestPromise = page.waitForRequest(
    (r) => r.url().endsWith("/api/assistant") && r.method() === "POST",
  );
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  expect((await requestPromise).postDataJSON()).not.toHaveProperty("allowExternal");
  await expect(panel.getByText("模拟助手：未调用真实模型。", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("UXR多尺寸与缩放布局、长标题卡片间距和核心页面截图", async ({ actors, page }) => {
  test.setTimeout(240000);
  for (let i = 0; i < 5; i++) {
    const item = await draft(
      actors.admin,
      noticeContent({
        title: `UXR长标题${i}：2026年度翻译专业资格与各省证书领取安排及学习准备说明`,
        category: "catti",
      }),
    );
    await publish(actors.admin, item.id);
  }
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, url] of [
      ["home", "/?tab=latest"],
      ["me", "/me"],
      ["learn", "/learn"],
      ["tasks", "/tasks"],
      ["exams", "/exams"],
      ["account", "/account"],
    ] as const) {
      await page.goto(url);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${name} ${width} overflow`,
      ).toBe(true);
      if (name === "home") {
        const boxes = await page.locator(".exam-card").evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          }),
        );
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!,
              b = boxes[j]!;
            expect(
              a.right + 12 <= b.x ||
                b.right + 12 <= a.x ||
                a.bottom + 12 <= b.y ||
                b.bottom + 12 <= a.y,
              `card gap ${width}`,
            ).toBe(true);
          }
        await expect(
          page.getByText(/没有启用自动采集来源|每日检查不等于每天都有新公告|已启用\d+个来源/),
        ).toHaveCount(0);
      }
      if (width === 390 || width === 1280)
        await page.screenshot({ path: `work/uxr-after-${name}-${width}.png`, fullPage: true });
      if (width === 1280)
        for (const zoom of ["1.25", "1.5"]) {
          await page.evaluate((value) => {
            document.body.style.zoom = value;
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
    await page.goto("/");
    await page.getByRole("button", { name: "打开考试学习AI助手" }).click();
    const panel = page.getByRole("dialog", { name: "考试学习AI助手" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    expect(await panel.evaluate((node) => getComputedStyle(node).fontFamily)).toContain(
      "Microsoft YaHei",
    );
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `work/uxr-after-assistant-${width}.png`, fullPage: true });
  }
  const anonymous = await page.context().browser()!.newContext();
  const authPage = await anonymous.newPage();
  for (const url of ["/login", "/register"])
    for (const width of [390, 768, 1280, 1920]) {
      await authPage.setViewportSize({ width, height: 900 });
      await authPage.goto(`http://127.0.0.1:3132${url}`);
      expect(
        await authPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${url} ${width}`,
      ).toBe(true);
      if (width === 390 || width === 1280)
        await authPage.screenshot({
          path: `work/uxr-after-${url.slice(1)}-${width}.png`,
          fullPage: true,
        });
    }
  await anonymous.close();
});
