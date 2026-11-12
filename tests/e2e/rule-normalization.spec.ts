import { test, expect } from "@playwright/test";

test("等价规则保留多来源并记录严格数值边界 ENG-005 ENG-011", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "规则合并", noticeText: "文件大小不超过 1 KB。" },
    })
  ).json();
  await request.post(`/api/tasks/${task.id}/sources`, {
    multipart: {
      sourceFile: {
        name: "补充要求.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("文件大小不得超过 1 KB。"),
      },
    },
  });
  const { ruleSet } = await (await request.post(`/api/tasks/${task.id}/rules`)).json();
  expect(ruleSet.rules).toHaveLength(1);
  expect(ruleSet.rules[0].additionalSources).toHaveLength(1);
  expect(ruleSet.rules[0].numericConstraints).toEqual([{ operator: "lte", value: 1, unit: "KB" }]);
  const loaded = (await (await request.get(`/api/tasks/${task.id}/rules`)).json()).ruleSets[0];
  expect(loaded.rules[0].additionalSources[0].quotedText).toBe("文件大小不得超过 1 KB");
  await page.goto(`/tasks/${task.id}`);
  await page.getByText("等价要求的其他来源（1）", { exact: true }).click();
  await expect(page.getByText(/补充要求.txt v1 · 段落 1：/)).toBeVisible();
  await request.post(`/api/tasks/${task.id}/sources`, {
    multipart: {
      sourceFile: {
        name: "冲突要求.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("文件大小必须大于 1000 字节。"),
      },
    },
  });
  const conflict = (await (await request.post(`/api/tasks/${task.id}/rules`)).json()).ruleSet;
  expect(
    conflict.warnings.some(
      (warning: { code: string }) => warning.code === "conflicting_constraints",
    ),
  ).toBe(true);
  await request.delete(`/api/tasks/${task.id}`);
});
