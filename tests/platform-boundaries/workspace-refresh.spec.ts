import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  createActor,
  draft,
  publish,
  noticeContent,
  password,
} from "../helpers/platform-boundaries";

test("全站账号区退出失败可重试，成功撤销会话并通知另一标签页", async ({ playwright, browser }) => {
  const actor = await createActor(playwright, "accountbar");
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  const page = await context.newPage();
  const other = await context.newPage();
  await page.goto("/me");
  await other.goto("/learn");
  await expect(
    page.getByRole("link", { name: `账号设置：${actor.username}`, exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("link", { name: `账号设置：${actor.username}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("当前登录用户名：", { exact: false })).toHaveCount(0);
  await page.goto("/learn");
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 503, json: { error: "合成失败" } }),
  );
  await page.getByRole("link", { name: `账号设置：${actor.username}`, exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".account-menu").getByRole("alert")).toContainText("退出失败");
  expect((await actor.api.get("/api/goals")).status()).toBe(200);
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(other).toHaveURL(/\/login$/);
  expect((await actor.api.get("/api/goals")).status()).toBe(401);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  const peer = await createActor(playwright, "accountpeer");
  await context.request.post("/api/auth/login", { data: { username: peer.username, password } });
  await page.goto("/me");
  await expect(
    page.getByRole("link", { name: `账号设置：${peer.username}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(actor.username, { exact: true })).toHaveCount(0);
  await context.close();
  await actor.api.dispose();
  await peer.api.dispose();
});

test("同一浏览器换号或会话失效后重新核对身份与私有页面", async ({ actors, browser }) => {
  const context = await browser.newContext({
    storageState: await actors.student.api.storageState(),
  });
  const page = await context.newPage();
  await page.goto("/me");
  await expect(
    page.getByRole("link", { name: `账号设置：${actors.student.username}`, exact: true }),
  ).toBeVisible();
  await context.request.post("/api/auth/login", {
    data: { username: actors.peer.username, password },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("link", { name: `账号设置：${actors.peer.username}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(actors.student.username, { exact: true })).toHaveCount(0);
  await context.request.post("/api/auth/logout");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});

test("考试要求导入按账号授权、保存来源快照且重复提交复用任务", async ({ actors }) => {
  const content = noticeContent({ edition: `导入-${randomUUID()}`, textScope: "摘录" });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
      })
    ).json()
  ).goal;
  const selection = `goal:${goal.id}`;
  const parameters = `selection=${selection}&notice=${item.id}`;
  expect((await actors.peer.api.get(`/api/exam-import?${parameters}`)).status()).toBe(404);
  const preview = (await (await actors.student.api.get(`/api/exam-import?${parameters}`)).json())
    .preview;
  expect(preview.scope).toBe("摘录");
  expect(preview.warning).toContain("部分原文");
  const input = { selection, noticeId: item.id, version: 1, name: "合成导入任务" };
  expect((await actors.peer.api.post("/api/exam-import", { data: input })).status()).toBe(400);
  expect(
    (
      await actors.student.api.post("/api/exam-import", {
        data: { ...input, noticeText: "伪造来源" },
      })
    ).status(),
  ).toBe(400);
  const response = await actors.student.api.post("/api/exam-import", { data: input });
  expect(response.status(), await response.text()).toBe(201);
  const saved = (await response.json()).task;
  expect(saved.noticeSource.originalText).toBe(content.text);
  expect(saved.noticeSource.sourceUrl).toBe(item.url);
  expect(saved.noticeSource.displayName).toContain("公告v1");
  expect(saved.noticeSource.parseStatus).toBe("partial");
  const repeated = await actors.student.api.post("/api/exam-import", { data: input });
  expect((await repeated.json()).task.id).toBe(saved.id);
  expect((await actors.peer.api.get(`/api/tasks/${saved.id}`)).status()).toBe(404);
  await draft(
    actors.admin,
    { ...content, summary: "合成修订", text: `${content.text}\n新增照片要求。` },
    item.url,
  );
  await publish(actors.admin, item.id, 2);
  expect((await actors.student.api.post("/api/exam-import", { data: input })).status()).toBe(400);
  const original = (await (await actors.student.api.get(`/api/tasks/${saved.id}`)).json()).task;
  expect(original.noticeSource.originalText).toBe(content.text);
});

test("来源选择保护原草稿，收藏与目标可导入，格式提示只列实际格式", async ({
  playwright,
  browser,
  actors,
}) => {
  const actor = await createActor(playwright, "sourcepicker");
  const item = await draft(actors.admin, noticeContent({ title: "合成界面导入考试" }));
  await publish(actors.admin, item.id);
  await actor.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } });
  const context = await browser.newContext({
    storageState: await actor.api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/tasks/new");
  const text = page.getByRole("textbox", { name: "通知或要求原文", exact: true });
  await text.fill("合成原始草稿，不应丢失。");
  await page.getByRole("button", { name: "从我的考试导入", exact: true }).click();
  await page.getByLabel("选择已保存的考试").selectOption(`favorite:${item.id}`);
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
  await page.getByLabel("用所选考试要求替换当前来源", { exact: false }).check();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.getByRole("button", { name: "粘贴文本", exact: true }).click();
  await expect(text).toHaveValue("合成原始草稿，不应丢失。");
  await page.getByRole("button", { name: "上传文件", exact: true }).click();
  await expect(page.getByText("支持：PDF、DOCX、TXT", { exact: true })).toBeVisible();
  await expect(page.getByText(/扫描 PDF 暂不做|读取范围和失败会单独说明/)).toHaveCount(0);
  await page.getByRole("button", { name: "从我的考试导入", exact: true }).click();
  await page.getByLabel("选择已保存的考试").selectOption(`favorite:${item.id}`);
  await page.getByLabel("用所选考试要求替换当前来源", { exact: false }).check();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.getByRole("button", { name: "创建审查任务", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[a-f0-9-]{36}$/);
  await context.close();
  await actor.api.dispose();
});

test("阅读状态只显示已看未看且刷新持久、与其他账号隔离", async ({ playwright, browser }) => {
  const actor = await createActor(playwright, "readinglabel");
  const resources = (await (await actor.api.get("/api/learning")).json()).resources;
  const resource = resources[0];
  await actor.api.post("/api/learning", {
    data: { action: "mark", id: resource.id, field: "saved", value: true },
  });
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  const page = await context.newPage();
  await page.goto("/me?view=favorites");
  await expect(page.getByRole("button", { name: "未看", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "未看", exact: true }).click();
  await expect(page.getByRole("button", { name: "已看", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "已看", exact: true })).toBeVisible();
  await expect(page.getByText(/不代表学习完成|当前版本已看|当前版本未读/)).toHaveCount(0);
  await page.getByRole("button", { name: "已看", exact: true }).click();
  await expect(page.getByRole("button", { name: "未看", exact: true })).toBeVisible();
  const peer = await createActor(playwright, "readingpeer");
  const peerResources = (await (await peer.api.get("/api/learning")).json()).resources;
  expect(
    peerResources.find((entry: { id: string }) => entry.id === resource.id)?.saved,
  ).toBeFalsy();
  await context.close();
  await actor.api.dispose();
  await peer.api.dispose();
});

test("实际页面视觉截图与宽度缩放回归", async ({ actors, browser }) => {
  await mkdir("outputs/eng-084", { recursive: true });
  const now = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 8 * 3600000 + 10 * 86400000).toISOString().slice(0, 10);
  const start = `${now}T00:00:00+08:00`,
    end = `${later}T23:59:00+08:00`;
  const content = noticeContent({
    title: "合成展示 · 大学英语四级报名通知",
    edition: "合成展示场次",
    year: 2026,
    text: `合成测试：报名开始${start}，报名截止${end}。须提交学籍证明。`,
    timeline: [
      { label: "报名开始", value: start, quote: `报名开始${start}` },
      { label: "报名截止", value: end, quote: `报名截止${end}` },
    ],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
      })
    ).json()
  ).goal;
  const state = (
    await (
      await actors.student.api.post("/api/preparation", {
        data: { goalId: goal.id, expectedRevision: 0, command: { action: "template" } },
      })
    ).json()
  ).state;
  const context = await browser.newContext({
    storageState: await actors.student.api.storageState(),
  });
  const page = await context.newPage();
  const paths = [
    ["home", "/"],
    ["learn", "/learn"],
    ["overview", `/me/preparation?goal=${goal.id}`],
    ["roadmap", `/me/preparation?goal=${goal.id}&view=roadmap&stage=${state.stages[0].id}`],
    ["materials", `/me/preparation?goal=${goal.id}&view=materials`],
    ["new-task", "/tasks/new"],
  ];
  for (const width of [320, 390, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const [label, path] of paths) {
      await page.goto(path!);
      await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${label} ${width}`,
      ).toBe(true);
      if ([390, 1440].includes(width))
        await page.screenshot({ path: `outputs/eng-084/${label}-${width}.png`, fullPage: true });
      if (width === 1280)
        for (const zoom of ["1.25", "1.5"]) {
          await page.evaluate((value) => {
            document.body.style.zoom = value;
          }, zoom);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${label} ${zoom}`,
          ).toBe(true);
          await page.evaluate(() => {
            document.body.style.zoom = "";
          });
        }
    }
  }
  await context.close();
});

test("导入必须明确场次，取消收藏、撤回和取消公告后拒绝旧预览保存", async ({
  actors,
  playwright,
  browser,
}) => {
  const actor = await createActor(playwright, "importboundary");
  const first = await draft(actors.admin, noticeContent({ edition: `边界甲-${randomUUID()}` }));
  const second = await draft(actors.admin, noticeContent({ edition: `边界乙-${randomUUID()}` }));
  await publish(actors.admin, first.id);
  await publish(actors.admin, second.id);
  const goal = (
    await (
      await actor.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国" } },
      })
    ).json()
  ).goal;
  const emptyGoal = (
    await (
      await actor.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", edition: `无公告-${randomUUID()}` } },
      })
    ).json()
  ).goal;
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  const page = await context.newPage();
  await page.goto("/tasks/new");
  await page.getByRole("button", { name: "从我的考试导入", exact: true }).click();
  await page.getByLabel("选择已保存的考试").selectOption(`goal:${goal.id}`);
  await expect(page.getByLabel("选择适用公告")).toHaveValue("");
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toHaveCount(0);
  await page.getByLabel("选择适用公告").selectOption(first.id);
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByLabel("选择已保存的考试").selectOption(`goal:${emptyGoal.id}`);
  await expect(
    page.getByText("暂未关联可用公告，可以手动补充要求原文。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "通知或要求原文", exact: true })).toHaveValue("");
  await actor.api.post(`/api/exams/${first.id}`, { data: { action: "favorite" } });
  const input = { selection: `favorite:${first.id}`, noticeId: first.id, version: 1 };
  expect(
    (
      await actor.api.get(`/api/exam-import?selection=${input.selection}&notice=${first.id}`)
    ).status(),
  ).toBe(200);
  await actor.api.post(`/api/exams/${first.id}`, { data: { action: "unfavorite" } });
  expect((await actor.api.post("/api/exam-import", { data: input })).status()).toBe(400);
  await actors.admin.api.post("/api/admin/exams", {
    data: { action: "withdraw", id: first.id, version: 1 },
  });
  expect(
    (
      await actor.api.post("/api/exam-import", { data: { ...input, selection: `goal:${goal.id}` } })
    ).status(),
  ).toBe(400);
  const cancelled = await draft(actors.admin, noticeContent({ disposition: "取消" }));
  await publish(actors.admin, cancelled.id);
  await actor.api.post(`/api/exams/${cancelled.id}`, { data: { action: "favorite" } });
  expect(
    (
      await actor.api.post("/api/exam-import", {
        data: { selection: `favorite:${cancelled.id}`, noticeId: cancelled.id, version: 1 },
      })
    ).status(),
  ).toBe(400);
  const tasks = (await (await actor.api.get("/api/tasks")).json()).tasks;
  expect(tasks).toHaveLength(0);
  await context.close();
  await actor.api.dispose();
});
