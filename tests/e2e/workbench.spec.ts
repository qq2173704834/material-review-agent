import { expect, test } from "@playwright/test";

test("联动工作台显示双方历史证据并保持移动端可用 ENG-008", async ({ request, page, isMobile }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "联动对照验收", noticeText: "项目名称必须一致。" },
    })
  ).json();
  for (const [name, text] of [
    ["甲.txt", "项目名称：绿色能源"],
    ["乙.txt", "项目名称：智慧能源"],
  ])
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name: name!, mimeType: "text/plain", buffer: Buffer.from(text!) } },
    });
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("button", { name: "打开联动工作台", exact: true }).click();
  const board = page.getByRole("region", { name: "联动审查工作台" });
  await expect(board.getByText("项目名称：绿色能源", { exact: true }).last()).toBeVisible();
  await expect(board.getByText("项目名称：智慧能源", { exact: true }).last()).toBeVisible();
  if (isMobile) await board.getByRole("tab", { name: "结论与处理" }).click();
  await expect(board.getByLabel("工作台结论与处理")).toContainText("未通过");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(board).toBeVisible();
  await expect(board.getByRole("link", { name: "打开原件 v1", exact: true })).toHaveCount(2);
  for (const viewport of isMobile
    ? [{ width: 390, height: 844 }]
    : [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
      ]) {
    await page.setViewportSize(viewport);
    await expect(board.getByLabel("工作台原文证据")).toBeVisible();
    if (!isMobile) {
      await expect(board.getByLabel("工作台规则导航")).toBeVisible();
      await expect(board.getByLabel("工作台结论与处理")).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await board.screenshot({ path: `test-results/workbench-${isMobile ? "mobile" : "desktop"}.png` });
  await request.delete(`/api/tasks/${task.id}`);
});

test("补充来源修订形成新版本且旧执行保留原文 ENG-011", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "来源修订", noticeText: "必须提交 TXT。" } })
  ).json();
  const { source } = await (
    await request.post(`/api/tasks/${task.id}/sources`, {
      multipart: {
        sourceFile: {
          name: "补充.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("文件大小不超过 1 KB。"),
        },
      },
    })
  ).json();
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const before = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0];
  const response = await request.patch(`/api/tasks/${task.id}/sources/${source.id}`, {
    data: {
      version: 1,
      text: "文件大小不超过 2 KB。",
      note: "依据新通知调整上限",
      confirmedComplete: true,
    },
  });
  expect(response.status()).toBe(201);
  expect((await response.json()).source.version).toBe(2);
  const after = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0];
  expect(after.validity).toBe("needs_recheck");
  const history = await (
    await request.get(
      `/api/tasks/${task.id}/checks/${before.id}/source?sourceId=${source.id}&version=1`,
    )
  ).json();
  expect(history.source.segments[0].text).toContain("1 KB");
  await request.delete(`/api/tasks/${task.id}`);
});
