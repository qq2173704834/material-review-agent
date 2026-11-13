import { openHistory } from "../helpers/task-ui";
import { test, expect } from "@playwright/test";
const aliceToken = "synthetic-alice-token-for-local-test-123456";
const bobToken = "synthetic-bob-token-for-local-test-654321";
test("多身份跨任务隔离、授权撤销和浏览器登录 N01", async ({ playwright, page, request }) => {
  const alice = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3120",
    extraHTTPHeaders: { Authorization: `Bearer ${aliceToken}` },
  });
  const bob = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3120",
    extraHTTPHeaders: { Authorization: `Bearer ${bobToken}` },
  });
  let taskId: string | undefined;
  try {
    expect((await request.get("/api/tasks")).status()).toBe(401);
    const created = await alice.post("/api/tasks", {
      data: { name: "Alice私有任务", noticeText: "必须提交TXT文件。" },
    });
    expect(created.status()).toBe(201);
    const { task } = await created.json();
    taskId = task.id;
    for (const suffix of ["", "/rules", "/checks", "/remediations"]) {
      expect((await bob.get(`/api/tasks/${task.id}${suffix}`)).status()).toBe(404);
    }
    expect(
      (
        await bob.get(`/api/tasks/%${task.id.charCodeAt(0).toString(16)}${task.id.slice(1)}`)
      ).status(),
    ).toBe(404);
    expect(
      (await bob.post("/api/demos", { data: { domain: "competition", taskId: task.id } })).status(),
    ).toBe(404);
    expect(
      (await bob.post(`/api/tasks/${task.id}/package`, { data: { materials: [] } })).status(),
    ).toBe(404);
    await expect((await bob.get("/api/tasks")).json()).resolves.toMatchObject({ tasks: [] });
    const bobHome = await bob.get("/");
    expect(await bobHome.text()).not.toContain("Alice私有任务");
    expect(
      (
        await alice.patch(`/api/tasks/${task.id}/access`, {
          data: { userId: "bob", enabled: true },
        })
      ).status(),
    ).toBe(200);
    expect((await bob.get(`/api/tasks/${task.id}`)).status()).toBe(200);
    expect(
      (
        await bob.patch(`/api/tasks/${task.id}/access`, {
          data: { userId: "alice", enabled: false },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await alice.patch(`/api/tasks/${task.id}/access`, {
          data: { userId: "bob", enabled: false },
        })
      ).status(),
    ).toBe(200);
    expect((await bob.get(`/api/tasks/${task.id}`)).status()).toBe(404);
    expect(
      (
        await alice.post("/api/tasks", {
          headers: { Origin: "https://external.invalid" },
          data: { noticeText: "恶意写入" },
        })
      ).status(),
    ).toBe(403);
    await page.goto("/");
    await expect(page).toHaveURL(/\/access$/);
    await page.getByLabel("访问凭据", { exact: true }).fill(aliceToken);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(`a[href^="/tasks/${task.id}?"]`)).toContainText("Alice私有任务");
    await page.goto(`/tasks/${task.id}`);
    await openHistory(page);
    await page.getByText("任务访问授权", { exact: true }).click();
    await expect(page.getByLabel("授权 bob", { exact: true })).toBeVisible();
    await page.goto("/access");
    await page.getByRole("button", { name: "退出当前身份" }).click();
    await expect(page.getByRole("status")).toContainText("已退出");
    expect((await page.request.get(`/api/tasks/${task.id}`)).status()).toBe(401);
  } finally {
    if (taskId) await alice.delete(`/api/tasks/${taskId}`);
    await alice.dispose();
    await bob.dispose();
  }
});
