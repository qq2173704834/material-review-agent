import { test, expect } from "@playwright/test";
const password = "Identity-regression-2026!";
test("BUG-025 同名昵称不混淆登录账号，目标与反馈按会话隔离", async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const alice = `identity_a_${suffix}`,
    bob = `identity_b_${suffix}`;
  try {
    for (const [context, username] of [
      [a, alice],
      [b, bob],
    ] as const) {
      expect(
        (
          await context.request.post("/api/auth/register", {
            data: { username, password, nickname: "test@123" },
          })
        ).status(),
      ).toBe(201);
      expect(
        (await context.request.post("/api/auth/login", { data: { username, password } })).ok(),
      ).toBeTruthy();
    }
    expect(
      (
        await a.request.post("/api/goals", {
          data: { goal: { category: "cet4", region: "全国", edition: "A账号专属考试目标" } },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await a.request.post("/api/feedback", { data: { kind: "资料问题", note: "隔离测试反馈" } })
      ).ok(),
    ).toBeTruthy();
    const pageA = await a.newPage(),
      pageB = await b.newPage();
    await pageA.goto("/me");
    await pageB.goto("/me");
    await expect(pageA.getByLabel("当前登录身份")).toContainText(alice);
    await expect(pageB.getByLabel("当前登录身份")).toContainText(bob);
    await expect(pageA.getByLabel("当前登录身份")).toContainText("昵称：test@123");
    await expect(pageA.getByRole("heading", { name: /A账号专属考试目标/ })).toBeVisible();
    await expect(pageB.getByRole("heading", { name: /A账号专属考试目标/ })).toHaveCount(0);
    const ownFeedback = pageA
      .locator("section")
      .filter({ has: pageA.getByRole("heading", { name: "我的内容反馈", exact: true }) });
    const otherFeedback = pageB
      .locator("section")
      .filter({ has: pageB.getByRole("heading", { name: "我的内容反馈", exact: true }) });
    await expect(ownFeedback).toContainText("资料问题");
    await expect(otherFeedback).toContainText("暂无反馈");
    expect((await (await b.request.get("/api/goals")).json()).goals).toHaveLength(0);
    expect((await (await b.request.get("/api/feedback")).json()).items).toHaveLength(0);
    // Exercise the actual form and same-browser account switch, including cached /me navigation.
    await pageA.getByRole("link", { name: "账号设置与退出登录" }).click();
    await pageA.getByLabel("昵称", { exact: true }).fill("已更新的本人昵称");
    await pageA.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect(pageA.getByRole("status")).toContainText("已保存");
    await expect(pageA.getByText(`当前账号：${alice} · 已更新的本人昵称`)).toBeVisible();
    await pageA.goto("/me");
    await expect(pageA.getByLabel("当前登录身份")).toContainText("已更新的本人昵称");
    await pageA.getByRole("link", { name: "账号设置与退出登录" }).click();
    await pageA.getByRole("combobox", { name: "操作", exact: true }).selectOption("logout");
    await pageA.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect(pageA).toHaveURL(/\/login$/);
    await pageA.getByRole("textbox", { name: /^用户名/ }).fill(bob);
    await pageA.getByLabel("密码", { exact: true }).fill(password);
    await pageA.getByRole("button", { name: "登录", exact: true }).click();
    await expect(pageA).toHaveURL(/\/$/);
    await pageA.getByRole("link", { name: "我的考试", exact: true }).click();
    await expect(pageA.getByLabel("当前登录身份")).toContainText(bob);
    await expect(pageA.getByLabel("当前登录身份")).not.toContainText(alice);
    await expect(pageA.getByRole("heading", { name: /A账号专属考试目标/ })).toHaveCount(0);
    await pageA.reload();
    await expect(pageA.getByLabel("当前登录身份")).toContainText(bob);
  } finally {
    await a.close();
    await b.close();
  }
});
test("BUG-025 未登录不能读取我的考试", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "我的考试工作台" })).toHaveCount(0);
});
test("BUG-025 脚本未就绪时禁用提交，账号表单不使用GET发送密码", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeDisabled();
    expect(new URL(page.url()).search).toBe("");
  } finally {
    await context.close();
  }
});
