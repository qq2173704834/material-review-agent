import { expect, test } from "@playwright/test";

test.describe("工程初始化 @foundation", () => {
  test("任务空态明确未实现能力，并可往返环境页", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveTitle("材料预审工作台");
    await expect(page.getByRole("heading", { name: "我的审查任务" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建审查任务" })).toBeDisabled();
    await expect(page.getByText("没有预置任务或演示结论")).toBeVisible();
    await expect(page.locator("nav a[aria-current='page']")).toHaveAccessibleName("审查任务");

    await page.getByRole("link", { name: "查看初始化状态" }).click();
    await expect(page.getByRole("heading", { name: "模拟开发模式" })).toBeVisible();
    await expect(page.getByText(/当前未实现模型调用/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "后续功能，尚未实现" })).toBeVisible();
    await page.getByRole("link", { name: "返回任务列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的审查任务" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });

  test("健康检查只返回公开状态且不宣称模型已连通", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body: unknown = await response.json();
    expect(body).toEqual({
      status: "ok",
      application: "material-review-agent",
      runtime: {
        mode: "mock",
        hasModelConfiguration: false,
        modelIntegration: "not_implemented",
        storage: "not_initialized",
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
