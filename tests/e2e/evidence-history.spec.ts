import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("移除补充来源后执行仍保留原文快照 ENG-008 ENG-011", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "历史来源验收", noticeText: "必须提交 TXT 格式文件。" },
    })
  ).json();
  const response = await request.post(`/api/tasks/${task.id}/sources`, {
    multipart: {
      sourceFile: {
        name: "补充要求.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("必须提交 PDF 格式文件。\n附加说明保留上下文。"),
      },
    },
  });
  expect(response.status()).toBe(201);
  const details = await (await request.get(`/api/tasks/${task.id}`)).json();
  const source = details.task.supplementalSources[0];
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  const endpoint = `/api/tasks/${task.id}/checks/${executions[0].id}/source?sourceId=${source.id}&version=1`;
  expect((await request.delete(`/api/tasks/${task.id}/sources/${source.id}`)).status()).toBe(204);
  expect(
    (await (await request.get(`/api/tasks/${task.id}`)).json()).task.supplementalSources,
  ).toHaveLength(0);
  const snapshot = await request.get(endpoint);
  expect(snapshot.status()).toBe(200);
  expect((await snapshot.json()).source.segments[0].text).toContain("必须提交 PDF");
  expect((await request.get(endpoint.replace(task.id, randomUUID()))).status()).toBe(404);
  await page.goto(`/tasks/${task.id}?verdict=all`);
  const result = page
    .getByRole("region", { name: "审查结果与待处理问题" })
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: /必须提交 PDF 格式文件/ }) });
  await result.getByRole("button", { name: "查看执行时来源原文" }).click();
  await expect(page.getByRole("dialog")).toContainText("附加说明保留上下文");
  await page.keyboard.press("Escape");
  await request.delete(`/api/tasks/${task.id}`);
  expect((await request.get(endpoint)).status()).toBe(404);
});

test("历史证据按执行版本预览、分页及任务隔离 ENG-008 ENG-009", async ({ request, page }) => {
  const created = await request.post("/api/tasks", {
    data: { name: "历史证据验收", noticeText: "必须提交 TXT 格式文件。" },
  });
  const { task } = await created.json();
  const upload = async (text: string): Promise<string> => {
    const response = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name: "材料.txt", mimeType: "text/plain", buffer: Buffer.from(text) } },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).materials[0].id as string;
  };
  const oldText = Array.from({ length: 12 }, (_, index) => `原版第 ${index + 1} 行`).join("\n");
  const materialId = await upload(oldText);
  await request.post(`/api/tasks/${task.id}/rules`);
  const executionResponse = await request.post(`/api/tasks/${task.id}/checks`);
  expect(executionResponse.status()).toBe(200);
  const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  await upload("修订版内容，只在第二版本出现。");
  const endpoint = `/api/tasks/${task.id}/materials/${materialId}/versions/1`;
  const previewResponse = await request.get(endpoint);
  expect(previewResponse.status()).toBe(200);
  const { preview } = await previewResponse.json();
  expect(preview.version).toBe(1);
  expect(preview.segments).toHaveLength(5);
  expect(preview.totalSegments).toBe(12);
  expect(preview.segments[0].text).toBe("原版第 1 行");
  expect(await (await request.get(endpoint + "?file=1")).text()).toBe(oldText);
  expect((await (await request.get(endpoint + "?offset=5")).json()).preview.segments[0].text).toBe(
    "原版第 6 行",
  );
  expect((await request.get(endpoint + "?offset=-1")).status()).toBe(400);
  expect(
    (
      await request.get(`/api/tasks/${randomUUID()}/materials/${materialId}/versions/1?file=1`)
    ).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/tasks/${task.id}/materials/${materialId}/versions/999`)).status(),
  ).toBe(404);
  const report = await request.get(`/api/tasks/${task.id}/report?executionId=${executions[0].id}`);
  expect(await report.text()).toContain("材料.txt · v1");
  await page.goto(`/tasks/${task.id}?execution=${executions[0].id}&verdict=all`);
  const panel = page.getByRole("region", { name: "审查结果与待处理问题" });
  const ruleButton = panel.getByRole("button", { name: /R-001 · 必须提交 TXT/ });
  await ruleButton.click();
  await page.reload();
  await expect(ruleButton).toHaveAttribute("aria-pressed", "true");
  await panel.getByLabel("按判定筛选").selectOption("failed");
  await expect(panel.getByText("当前筛选没有匹配的检查项。", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(panel.getByLabel("按判定筛选")).toHaveValue("all");
  await expect(ruleButton).toHaveAttribute("aria-pressed", "true");
  const button = page.getByRole("button", { name: "查看证据原文 / 对照" }).first();
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("材料.txt · v1");
  await expect(dialog).toContainText("原版第 1 行");
  await expect(dialog).not.toContainText("修订版内容");
  await dialog.getByRole("button", { name: "下一组片段" }).click();
  await expect(dialog).toContainText("原版第 6 行");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await request.delete(`/api/tasks/${task.id}`);
  expect((await request.get(endpoint)).status()).toBe(404);
});
