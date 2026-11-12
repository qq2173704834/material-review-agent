import { expect, test } from "@playwright/test";

import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { ReviewExecution, ReviewTaskDetails } from "@/domain/review";

async function createTask(
  request: APIRequestContext,
  noticeText = "项目说明必须给出测试样本量。",
  fileText = "测试样本量：尚未提供。",
): Promise<{ task: ReviewTaskDetails; rules: APIResponse }> {
  const created = await request.post("/api/tasks", {
    data: { name: "受控模型集成样例", noticeText },
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()).task as ReviewTaskDetails;
  const rules = await request.post(`/api/tasks/${task.id}/rules`);
  if (rules.ok()) {
    const uploaded = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "任意名称.txt", mimeType: "text/plain", buffer: Buffer.from(fileText) },
      },
    });
    expect(uploaded.status()).toBe(201);
  }
  return { task, rules };
}

async function runChecks(request: APIRequestContext, taskId: string): Promise<ReviewExecution> {
  const response = await request.post(`/api/tasks/${taskId}/checks`);
  expect(response.status()).toBe(200);
  const events = (await response.text())
    .trim()
    .split("\n\n")
    .map((event) => JSON.parse(event.slice(6)));
  return events.find((event) => event.type === "completed").execution as ReviewExecution;
}

test("受控服务连接成功且健康检查不泄露密钥", async ({ request, page }) => {
  await page.goto("/setup");
  await page.getByRole("button", { name: "测试模型连接" }).click();
  await expect(page.getByRole("status")).toContainText("连接成功");
  const health = await (await request.get("/api/health")).text();
  expect(health).not.toContain("synthetic-test-key");
  expect(health).not.toContain("3310");
});

test("真实模式代码链完成提取、证据审查、复检和报告（受控模型，非真实AI验收）", async ({
  request,
  page,
}) => {
  const { task, rules } = await createTask(request);
  const ruleSet = (await rules.json()).ruleSet;
  expect(ruleSet).toMatchObject({
    mode: "live",
    provider: "controlled-test",
    model: "controlled-model",
  });
  expect(ruleSet.modelCalls[0]).toMatchObject({ inputTokens: 123, outputTokens: 45 });
  const first = await runChecks(request, task.id);
  expect(first.results[0]).toMatchObject({ verdict: "failed", method: "model" });
  expect(first.results[0]?.evidence[0]).toMatchObject({
    quotedText: "测试样本量：尚未提供。",
    materialVersion: 1,
    segmentIndex: 0,
  });
  const upload = await request.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: {
        name: "任意名称.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("测试样本量：100。"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const beforeRecheck = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  expect(beforeRecheck.executions[0].validity).toBe("needs_recheck");
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole("button", { name: "重新检查" })).toBeEnabled();
  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByText(/已解决 1 · 仍存在 0/)).toBeVisible();
  await page.getByRole("link", { name: "定位证据" }).click();
  await expect(
    page.locator("details[open]").getByText("测试样本量：100。", { exact: true }),
  ).toBeVisible();
  const executions = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions;
  expect(executions[0].results[0].verdict).toBe("passed");
  expect(executions[0].validity).toBe("current");
  const report = await request.get(`/api/tasks/${task.id}/report`);
  expect(report.headers()["content-type"]).toContain("text/markdown");
  const markdown = await report.text();
  expect(markdown).toContain("已解决 1");
  expect(markdown).toContain("测试样本量：100。");
  expect(markdown).toContain("controlled-model");
  expect(markdown).toContain("已知输入 token：246");
  const oldReport = await request.get(`/api/tasks/${task.id}/report?executionId=${first.id}`);
  expect(await oldReport.text()).toContain("待复检");
  const other = await createTask(request);
  expect(
    (await request.get(`/api/tasks/${other.task.id}/report?executionId=${first.id}`)).status(),
  ).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("模型伪造通知原文时拒绝保存规则", async ({ request }) => {
  const { task, rules } = await createTask(request, "INVALID_SOURCE 必须提交项目说明。");
  expect(rules.status()).toBe(422);
  expect((await (await request.get(`/api/tasks/${task.id}/rules`)).json()).ruleSets).toHaveLength(
    0,
  );
});

test("模型伪造材料引用时结果不会通过", async ({ request }) => {
  const { task } = await createTask(
    request,
    "INVALID_EVIDENCE 项目说明必须给出测试样本量。",
    "测试样本量：100。",
  );
  const execution = await runChecks(request, task.id);
  expect(execution.results[0]).toMatchObject({ verdict: "unable_to_check", evidence: [] });
  expect(execution.metadata?.modelCalls[0]).toMatchObject({
    status: "failed",
    errorCode: "invalid_citation",
  });
});

test("授权失败使用可读提示并隐藏服务端错误", async ({ request }) => {
  const { rules } = await createTask(request, "AUTH_FAILURE 必须提交材料。");
  expect(rules.status()).toBe(502);
  const response = await rules.text();
  expect(response).toContain("API Key");
  expect(response).not.toContain("secret detail");
});

test("覆盖截断时模型通过意见降级为待确认", async ({ request }) => {
  const { task } = await createTask(request, "项目说明必须给出测试样本量。", "100".repeat(9000));
  const execution = await runChecks(request, task.id);
  expect(execution.results[0]).toMatchObject({
    verdict: "needs_confirmation",
    coverage: { isComplete: false },
  });
});

test("模型不能代替尚未实现的字数工具直接判通过", async ({ request }) => {
  const { task } = await createTask(request, "项目说明字数必须不少于500字。", "100");
  const execution = await runChecks(request, task.id);
  expect(execution.results[0]?.verdict).not.toBe("passed");
  expect(execution.results[0]?.method).toBe("deterministic");
});

test("恰好一份的数量规则拒绝两份材料", async ({ request }) => {
  const response = await request.post("/api/tasks", {
    data: { name: "确定性数量边界", noticeText: "项目说明数量必须恰好1份。" },
  });
  const { task } = await response.json();
  // 数量比较通过独立纯函数运行，避免把模型匹配准确性当成数值工具正确性。
  const { executeReviewRule } = await import("../../src/lib/review-checks");
  const rulesResponse = await request.post(`/api/tasks/${task.id}/rules`);
  const { ruleSet } = await rulesResponse.json();
  for (const name of ["项目说明A.txt", "项目说明B.txt"])
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name, mimeType: "text/plain", buffer: Buffer.from("项目说明 100") } },
    });
  const current = (await (await request.get(`/api/tasks/${task.id}`)).json())
    .task as ReviewTaskDetails;
  const result = executeReviewRule(ruleSet.rules[0], current.materials, current.background);
  expect(result.verdict).toBe("failed");
  expect(result.reason).toContain("恰好 1 份");
});

test("取消正在等待模型的检查并保留未执行数", async ({ request, page }) => {
  const { task } = await createTask(request, "SLOW_MODEL 项目说明必须给出测试样本量。");
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("button", { name: "运行检查" }).click();
  await expect(page.getByText(/正在核查 R-001/)).toBeVisible();
  await page.getByRole("button", { name: "取消检查" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0]?.status,
    )
    .toBe("cancelled");
  const execution = (await (await request.get(`/api/tasks/${task.id}/checks`)).json())
    .executions[0];
  expect(execution.results).toHaveLength(0);
  expect(execution.unexecutedCount).toBe(1);
});
