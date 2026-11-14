import { test, expect } from "@playwright/test";

test("未保存编辑在离开、后退时提醒且取消后保留输入 OPT-02", async ({ page }) => {
  await page.goto("/");
  await page.goto("/tasks/new");
  await page.getByLabel("任务名称", { exact: true }).fill("未保存草稿");
  const first = page.waitForEvent("dialog");
  const click = page.getByRole("link", { name: "返回任务列表", exact: true }).click();
  const dialog = await first;
  expect(dialog.message()).toContain("尚未保存");
  await dialog.dismiss();
  await click;
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByLabel("任务名称", { exact: true })).toHaveValue("未保存草稿");
  const backDialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  await (await backDialog).dismiss();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByLabel("任务名称", { exact: true })).toHaveValue("未保存草稿");
  const leaveDialog = page.waitForEvent("dialog");
  const leave = page.getByRole("link", { name: "返回任务列表", exact: true }).click();
  await (await leaveDialog).accept();
  await leave;
  await expect(page).toHaveURL(/\/tasks$/);
});
