import { test, expect } from "@playwright/test";

test("报告预览与 Markdown 保留同一历史快照并可打印 A4 PDF ENG-010", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "报告中文与长名称验证", noticeText: "必须提交 TXT 格式文件。" },
    })
  ).json();
  await request.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: {
        name: "中文长文件名与安全字符验证.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "项目名称：绿色能源\n<script>globalThis.injected=true</script>\n" +
            "长段落与证据".repeat(1000),
        ),
      },
    },
  });
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  const endpoint = `/api/tasks/${task.id}/report?executionId=${executions[0].id}`;
  const markdown = await (await request.get(endpoint)).text();
  await page.goto(endpoint + "&format=html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(task.name);
  await expect(page.locator("main")).toContainText(executions[0].id);
  await expect(page.locator("main")).toContainText("中文长文件名与安全字符验证.txt");
  expect(markdown).toContain("通过");
  await expect(page.getByRole("cell", { name: "通过", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(globalThis, "injected"))).toBe(false);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  await expect(page.getByRole("button", { name: "打印 / 另存为 PDF" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await request.delete(`/api/tasks/${task.id}`);
});
