import { expect, test } from "@playwright/test";
import type { ReviewExecution } from "@/domain/review";

test("材料修订只复检受影响规则，全量复检结果一致 ENG-009", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: {
        name: "增量复检验收",
        noticeText: "文件格式必须为 TXT。\n文件大小不超过 1 KB。\n项目名称必须一致。",
      },
    })
  ).json();
  const upload = async (name: string, text: string): Promise<string> => {
    const response = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name, mimeType: "text/plain", buffer: Buffer.from(text) } },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).materials[0].id as string;
  };
  const firstId = await upload("申请书.txt", "项目名称：绿色能源\n正文内容");
  const secondId = await upload("说明.txt", "项目名称：绿色能源\n说明内容");
  const { ruleSet } = await (await request.post(`/api/tasks/${task.id}/rules`)).json();
  expect(ruleSet.rules).toHaveLength(3);
  const rules = ruleSet.rules.map((rule: { description: string; materialIds: string[] }) => ({
    ...rule,
    materialIds: rule.description.includes("格式")
      ? [firstId]
      : rule.description.includes("大小")
        ? [secondId]
        : [],
  }));
  expect((await request.patch(`/api/tasks/${task.id}/rules`, { data: { rules } })).status()).toBe(
    201,
  );
  const run = async (full = false): Promise<ReviewExecution> => {
    const response = await request.post(`/api/tasks/${task.id}/checks${full ? "?full=1" : ""}`);
    expect(response.status()).toBe(200);
    const saved = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    return saved.executions[0] as ReviewExecution;
  };
  const first = await run();
  expect(first.results.map((result) => result.verdict)).toEqual(["passed", "passed", "passed"]);
  expect(first.results.every((result) => result.dependencyKey && !result.reusedFrom)).toBe(true);
  await upload("申请书.txt", "项目名称：另一个项目\n修订内容");
  const { plan } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  expect(plan.map((item: { action: string }) => item.action)).toEqual(["check", "reuse", "check"]);
  const incremental = await run();
  expect(incremental.results[1]?.reusedFrom).toEqual({
    executionId: first.id,
    checkedAt: first.results[1]?.checkedAt,
  });
  expect(incremental.results[2]?.verdict).toBe("failed");
  expect(incremental.metadata?.modelCalls).toHaveLength(0);
  const full = await run(true);
  expect(full.results.every((result) => !result.reusedFrom)).toBe(true);
  expect(
    full.results.map(({ ruleId, verdict, evidence }) => ({ ruleId, verdict, evidence })),
  ).toEqual(
    incremental.results.map(({ ruleId, verdict, evidence }) => ({ ruleId, verdict, evidence })),
  );
  const report = await request.get(`/api/tasks/${task.id}/report?executionId=${incremental.id}`);
  expect(await report.text()).toContain("复用结果：原执行 " + first.id);
  await page.goto(`/tasks/${task.id}?execution=${incremental.id}`);
  await expect(page.getByText(/复用结果 · 原检查时间/)).toBeVisible();
  await expect(page.getByRole("button", { name: "全量复检" })).toBeVisible();
  const latestRules = (await (await request.get(`/api/tasks/${task.id}/rules`)).json()).ruleSets[0]
    .rules;
  latestRules[0].materialIds = [secondId];
  expect(
    (await request.patch(`/api/tasks/${task.id}/rules`, { data: { rules: latestRules } })).status(),
  ).toBe(201);
  const changedRules = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  expect(changedRules.plan.map((item: { action: string }) => item.action)).toEqual([
    "check",
    "reuse",
    "reuse",
  ]);
  const details = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
  const updated = await request.patch(`/api/tasks/${task.id}`, {
    data: {
      name: details.name,
      description: details.description,
      noticeText: details.noticeSource.originalText,
      background: { ...details.background, projectStage: "决赛" },
    },
  });
  expect(updated.ok()).toBe(true);
  const afterBackground = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  expect(afterBackground.plan.every((item: { action: string }) => item.action === "check")).toBe(
    true,
  );
  await request.delete(`/api/tasks/${task.id}`);
});
