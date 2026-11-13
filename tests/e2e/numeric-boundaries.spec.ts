import { expect, test } from "@playwright/test";
import { createReviewPdf } from "../helpers/pdf-fixture";

test("文件总量、严格边界与页数下限由工具核验 ENG-007", async ({ request }) => {
  const cases = [
    { notice: "所有文件总大小不超过 1 KB。", sizes: [600, 600], expected: "failed" },
    { notice: "所有文件总大小不超过 1 KB。", sizes: [400, 600], expected: "passed" },
    { notice: "文件大小必须小于 1 KB。", sizes: [1000], expected: "failed" },
    { notice: "文件大小必须大于 1 KB。", sizes: [1000], expected: "failed" },
    { notice: "文件大小不少于 1 KiB。", sizes: [1024], expected: "passed" },
    { notice: "文件大小必须为 1至2 KB。", sizes: [1500], expected: "passed" },
    { notice: "PDF 总页数至少 2 页。", pdfPages: 1, sizes: [], expected: "failed" },
    { notice: "PDF 总页数至少 2 页。", pdfPages: 2, sizes: [], expected: "passed" },
    { notice: "总页数不得超过 1 页。", pdfPages: 2, sizes: [], expected: "failed" },
    { notice: "总页数不得超过 1 页。", pdfPages: 1, sizes: [], expected: "passed" },
    {
      notice: "文件大小必须大于 1 KB 且不超过 1 KB。",
      sizes: [1000],
      expected: "needs_confirmation",
    },
  ];
  for (const scenario of cases) {
    const { task } = await (
      await request.post("/api/tasks", { data: { name: "数值边界", noticeText: scenario.notice } })
    ).json();
    for (const [index, size] of scenario.sizes.entries()) {
      await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: {
            name: `文件${index}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.alloc(size, "a"),
          },
        },
      });
    }
    if (scenario.pdfPages)
      await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: {
            name: "文档.pdf",
            mimeType: "application/pdf",
            buffer: createReviewPdf(Array.from({ length: scenario.pdfPages }, () => "text")),
          },
        },
      });
    await request.post(`/api/tasks/${task.id}/rules`);
    const response = await request.post(`/api/tasks/${task.id}/checks`);
    expect(response.status()).toBe(200);
    const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(executions[0].results, scenario.notice).toHaveLength(1);
    expect(executions[0].results[0].verdict, scenario.notice).toBe(scenario.expected);
    await request.delete(`/api/tasks/${task.id}`);
  }
});

test("参数保留范围不包含边界 R04", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "开区间", noticeText: "文件大小必须为1至2 KB（不含上限）。" },
    })
  ).json();
  try {
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "边界.txt", mimeType: "text/plain", buffer: Buffer.alloc(2000, "a") },
      },
    });
    const { ruleSet } = await (await request.post(`/api/tasks/${task.id}/rules`)).json();
    expect(ruleSet.rules[0].numericConstraints).toEqual([
      { operator: "gte", value: 1, unit: "KB" },
      { operator: "lt", value: 2, unit: "KB" },
    ]);
    await request.post(`/api/tasks/${task.id}/checks`);
    expect(
      (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0].results[0]
        .verdict,
    ).toBe("failed");
  } finally {
    await request.delete(`/api/tasks/${task.id}`);
  }
});
