import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  draft,
  publish,
  noticeContent,
  password,
  unique,
} from "../helpers/platform-boundaries";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`PORT-14.A1 首次登录到目标学习、有来源咨询和个人预审 ${viewport.width}px`, async ({
    actors,
    page,
  }) => {
    const title = `合成学生完整旅程-${randomUUID().slice(0, 8)}`;
    const item = await draft(
      actors.admin,
      noticeContent({
        title,
        text: "必须提交 TXT 格式的学籍证明。文件大小不超过 2 KB。",
        timeline: [],
      }),
    );
    await publish(actors.admin, item.id);
    await page.setViewportSize(viewport);
    const username = unique("journey");
    expect(
      (await page.request.post("/api/auth/register", { data: { username, password } })).status(),
    ).toBe(201);
    await page.goto("/login");
    await page.getByRole("textbox", { name: /^用户名/ }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /下一场考试，\s*从这里出发/ })).toBeVisible();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "考试中心", exact: true })
      .click();
    await page.getByLabel("关键词", { exact: true }).fill(title);
    await page.getByRole("button", { name: "查找考试", exact: true }).click();
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.getByRole("button", { name: "收藏公告", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "设为我的考试目标并准备材料", exact: true }).click();
    await page.getByRole("button", { name: "保存目标", exact: true }).click();
    await expect(page.getByText("考试目标已保存。", { exact: true })).toBeVisible();
    const goals = (await (await page.request.get("/api/goals")).json()).goals;
    const goal = goals.find((entry: { noticeId: string }) => entry.noticeId === item.id);
    expect(goal).toBeTruthy();
    await page.getByRole("link", { name: "目标学习资源", exact: true }).click();
    await page.getByRole("link", { name: "CET四级笔试考核内容与结构", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "CET四级笔试考核内容与结构", exact: true }),
    ).toBeVisible();
    const trigger = page.getByRole("button", { name: "打开考试学习AI助手" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "考试学习AI助手" });
    await dialog.getByText("回答设置", { exact: true }).click();
    await dialog.getByRole("combobox", { name: "考试目标", exact: true }).selectOption(goal.id);
    await dialog.getByLabel("本次使用所选目标的考试、地区、考期", { exact: true }).check();
    await dialog
      .getByLabel("你的问题", { exact: true })
      .fill("2027年大学英语四级报名材料要求是什么？");
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await expect(dialog.getByText(/模拟助手：未调用真实模型/)).toBeVisible();
    const citation = dialog
      .locator("details")
      .filter({ has: page.locator("blockquote") })
      .first();
    await citation.locator("summary").click();
    await expect(citation.locator("blockquote")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "核对来源详情" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "我的备考", exact: true })
      .click();
    await page.getByRole("link", { name: "检查报名材料", exact: true }).click();
    await page.getByRole("button", { name: "建立目标材料任务", exact: true }).click();
    await page
      .getByRole("link", { name: "进入材料任务：核对规则、上传材料、查看证据与复检", exact: true })
      .click();
    const taskId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByLabel("选择审查材料", { exact: true }).setInputFiles({
      name: "学籍证明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("合成学籍证明：仅用于自动化验收，不是真实学生材料。"),
    });
    await expect(page.getByLabel("逐文件上传状态")).toContainText("读取成功");
    await page.getByTestId("task-primary-action").click();
    await expect(page.getByRole("heading", { name: "审查结果与待处理问题" })).toBeVisible();
    const executions = (await (await page.request.get(`/api/tasks/${taskId}/checks`)).json())
      .executions;
    expect(executions).toHaveLength(1);
    expect(
      executions[0].results.some((entry: { verdict: string }) => entry.verdict === "passed"),
    ).toBe(true);
    const retained = (await (await page.request.get("/api/goals")).json()).goals.find(
      (entry: { id: string }) => entry.id === goal.id,
    );
    expect(retained.taskId).toBe(taskId);
    await page.goto(`/me/preparation?goal=${goal.id}&view=materials`);
    await expect(page.getByText(/模拟自查/)).toBeVisible();
    await page.getByText("已提供材料 · 1份", { exact: true }).click();
    await expect(page.getByText(/学籍证明.txt · 当前版本1/)).toBeVisible();
    await page.getByRole("button", { name: "查看材料", exact: true }).click();
    await expect(page.getByRole("link", { name: "打开原件 v1", exact: true })).toBeVisible();
    await page.goto(`/exams/${item.id}`);
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/portal-journey-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
