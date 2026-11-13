import AxeBuilder from "@axe-core/playwright";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { ReviewTaskDetails, ReviewExecution } from "@/domain/review";

const created: string[] = [];
async function createTask(
  request: APIRequestContext,
  noticeText: string,
): Promise<ReviewTaskDetails> {
  const response = await request.post("/api/tasks", {
    data: { name: "UX独立合成任务", noticeText },
  });
  expect(response.ok()).toBe(true);
  const { task } = await response.json();
  created.push(task.id);
  return task;
}
async function upload(
  request: APIRequestContext,
  taskId: string,
  name: string,
  text: string,
): Promise<void> {
  expect(
    (
      await request.post(`/api/tasks/${taskId}/materials`, {
        multipart: { files: { name, mimeType: "text/plain", buffer: Buffer.from(text) } },
      })
    ).ok(),
  ).toBe(true);
}
async function openRequirements(page: Page): Promise<void> {
  await page.getByRole("button", { name: "查看 / 调整审查要求", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) await request.delete(`/api/tasks/${id}`);
});

test("UX-AT01 首次任务自动上传、草稿跨视图保留、一次开始且不重复执行", async ({
  page,
  request,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tasks/new");
  await page.getByLabel("任务名称").fill("UX首次使用合成任务");
  await page.getByRole("textbox", { name: "通知或要求原文" }).fill("文件格式必须为 TXT。");
  await page.getByRole("button", { name: "创建审查任务", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "UX首次使用合成任务", exact: true }),
  ).toBeVisible();
  const taskId = new URL(page.url()).pathname.split("/").at(-1)!;
  created.push(taskId);
  const primary = page.getByTestId("task-primary-action");
  await expect(primary).toHaveText("检查缺交项");
  await page.getByLabel("选择审查材料").setInputFiles({
    name: "说明.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("项目名称：绿色能源\n正文内容"),
  });
  await expect(page.getByLabel("逐文件上传状态")).toContainText("读取成功");
  const notice = page.getByRole("textbox", { name: "通知或要求原文" });
  await notice.fill("文件格式必须为 TXT。\n文件大小不超过 2 KB。");
  await page.getByRole("button", { name: "2. 执行审查", exact: true }).click();
  await expect(notice).toBeHidden();
  await page.getByRole("button", { name: "1. 准备要求与材料", exact: true }).click();
  await expect(notice).toHaveValue(/2 KB/);
  let starts = 0;
  let preparations = 0;
  page.on("request", (event) => {
    if (
      event.method() === "POST" &&
      new URL(event.url()).pathname.endsWith(`/tasks/${taskId}/checks`)
    )
      starts++;
    if (event.method() === "POST" && event.url().includes(`/tasks/${taskId}/rules`)) preparations++;
  });
  await expect(primary).toHaveText("开始审查");
  await primary.click();
  await expect(page).toHaveURL(/view=results/);
  await expect(page.getByRole("heading", { name: "审查结果与待处理问题" })).toBeVisible();
  expect(starts).toBe(1);
  expect(preparations).toBe(1);
  const { executions } = await (await request.get(`/api/tasks/${taskId}/checks`)).json();
  expect(executions).toHaveLength(1);
  expect(executions[0].results).toHaveLength(2);
  expect((await (await request.get(`/api/tasks/${taskId}`)).json()).task.noticeSource.version).toBe(
    2,
  );
  await page.getByLabel("按判定筛选").selectOption("all");
  await expect(page.getByText("全部判定", { exact: true })).toHaveCount(1);
  await page.screenshot({
    path: `test-results/ux-results-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("UX-AT02 缺交可审查，逐文件失败可恢复且成功文件不清空", async ({ page, request }) => {
  const task = await createTask(request, "必须提交说明.txt。\n文件格式必须为 TXT。");
  await page.goto(`/tasks/${task.id}`);
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  const first: ReviewExecution = (await (await request.get(`/api/tasks/${task.id}/checks`)).json())
    .executions[0];
  expect(first.results.some((item) => item.verdict === "failed")).toBe(true);
  await page.getByRole("button", { name: "1. 准备要求与材料", exact: true }).click();
  await page.getByLabel("选择审查材料").setInputFiles([
    { name: "说明.txt", mimeType: "text/plain", buffer: Buffer.from("已提交的说明正文") },
    { name: "空文件.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByLabel("逐文件上传状态")).toContainText("读取成功");
  await expect(page.getByLabel("逐文件上传状态")).toContainText("文件为空");
  await page.getByRole("button", { name: "重试此文件" }).click();
  await expect(page.getByLabel("逐文件上传状态")).toContainText("文件不能为空");
  const saved = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
  expect(saved.materials).toHaveLength(1);
  expect(saved.materials[0].originalFileName).toBe("说明.txt");
  await page.getByRole("button", { name: "移出队列", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "复查受影响项", exact: true })).toBeVisible();
});

test("UX-AT03 集中澄清可跳过，冲突及独立项如实保留", async ({ page, request }) => {
  const task = await createTask(
    request,
    "团队必须提交授权证明。\n团队必须提交分工说明。\n文件大小不超过 1 KB。\n文件大小至少 2 KB。",
  );
  await upload(request, task.id, "说明.txt", "正文");
  await page.goto(`/tasks/${task.id}`);
  await page.getByTestId("task-primary-action").click();
  await expect(page.getByRole("dialog", { name: "补充影响判定的信息" })).toBeVisible();
  await expect(page.getByLabel("补充参与范围")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("相关要求原文");
  await expect(page.getByRole("region", { name: "需要选择依据的来源冲突" })).toContainText(
    "文件大小不超过 1 KB",
  );
  await page.getByRole("button", { name: "暂时跳过", exact: true }).click();
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  const execution: ReviewExecution = (
    await (await request.get(`/api/tasks/${task.id}/checks`)).json()
  ).executions[0];
  expect(execution.results.some((item) => item.verdict === "needs_confirmation")).toBe(true);
  expect(execution.results.length).toBeGreaterThanOrEqual(3);
  await openRequirements(page);
  await page.getByText(/条需要人工留意的信息/).click();
  await expect(page.getByRole("dialog")).toContainText("冲突");
});

test("UX-AT04 问题内修订、证据联动和复查，关闭恢复焦点与问题", async ({ page, request }) => {
  const task = await createTask(request, "项目名称必须一致。");
  await upload(request, task.id, "申请书.txt", "项目名称：绿色能源");
  await upload(request, task.id, "证明.txt", "项目名称：智慧能源");
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  await page.goto(`/tasks/${task.id}`);
  const issue = page.locator('li[id^="execution-"]').first();
  await issue.getByRole("button", { name: /R-001/ }).click();
  const originalUrl = page.url();
  const action = issue.getByRole("button", { name: "上传修订 / 处理读取问题" });
  await action.click();
  await expect(page.getByRole("dialog", { name: "待审查材料" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(action).toBeFocused();
  expect(page.url()).toBe(originalUrl);
  await action.click();
  await page.getByLabel("选择审查材料").setInputFiles({
    name: "证明.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("项目名称：绿色能源"),
  });
  await expect(page.getByLabel("逐文件上传状态")).toContainText("读取成功");
  await page.getByRole("button", { name: "关闭处理面板" }).click();
  await expect(page.getByTestId("task-primary-action")).toHaveText("复查受影响项");
  await expect(page).toHaveURL(/rule=/);
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  await expect(page.getByText(/已解决 1/)).toBeVisible();
  const saved: ReviewExecution[] = (
    await (await request.get(`/api/tasks/${task.id}/checks`)).json()
  ).executions;
  expect(saved).toHaveLength(2);
  expect(saved[1]?.results[0]?.verdict).toBe("failed");
  expect(saved[0]?.results[0]?.verdict).toBe("passed");
});

test("UX-AT05 连点与网络失败保留输入，刷新只恢复不重跑", async ({ page, request }) => {
  const task = await createTask(request, "文件格式必须为 TXT。");
  await upload(request, task.id, "说明.txt", "正文");
  await page.goto(`/tasks/${task.id}`);
  let calls = 0;
  await page.route(`**/api/tasks/${task.id}/rules?prepare=1*`, async (route) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.abort();
  });
  await page.getByTestId("task-primary-action").evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("alert").filter({ hasText: "本地服务" }).first()).toBeVisible();
  expect(calls).toBe(1);
  expect(
    (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions,
  ).toHaveLength(0);
  await page.unroute(`**/api/tasks/${task.id}/rules?prepare=1*`);
  // Failure reveals the requirements panel so the explanation and manual fallback are available.
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "关闭处理面板" }).click();
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  const count = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions
    .length;
  await page.reload();
  await expect(page.getByRole("heading", { name: "审查结果与待处理问题" })).toBeVisible();
  expect(
    (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions,
  ).toHaveLength(count);
});

test("UX-AT06 历史导出和视图恢复，三个窗口键盘及引导可用", async ({ page, request, isMobile }) => {
  const task = await createTask(request, "项目名称必须一致。");
  await upload(request, task.id, "甲.txt", "项目名称：绿色能源");
  await upload(request, task.id, "乙.txt", "项目名称：智慧能源");
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  await upload(request, task.id, "乙.txt", "项目名称：绿色能源");
  await request.post(`/api/tasks/${task.id}/checks`);
  const { executions }: { executions: ReviewExecution[] } = await (
    await request.get(`/api/tasks/${task.id}/checks`)
  ).json();
  await page.goto(`/tasks/${task.id}?view=results&execution=${executions[1]!.id}&verdict=all`);
  await expect(page.getByLabel("选择检查记录")).toHaveValue(executions[1]!.id);
  await expect(page.getByRole("link", { name: "导出 Markdown 报告", exact: true })).toHaveAttribute(
    "href",
    new RegExp(executions[1]!.id),
  );
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 Markdown 报告", exact: true }).click();
  await download;
  await page.reload();
  await expect(page.getByLabel("选择检查记录")).toHaveValue(executions[1]!.id);
  for (const size of isMobile
    ? [{ width: 390, height: 844 }]
    : [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
      ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.getByTestId("task-primary-action").boundingBox();
    expect(box && box.y + box.height <= size.height).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "怎么用 · 3步上手" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "三步完成一次材料预审" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "怎么用 · 3步上手" })).toBeFocused();
  }
});

test("自动准备复用人工要求，来源变化不覆盖；同名依据明确进入修订", async ({ request, page }) => {
  const task = await createTask(request, "文件格式必须为 TXT。");
  await upload(request, task.id, "说明.txt", "正文");
  const initial = (await (await request.post(`/api/tasks/${task.id}/rules`)).json()).ruleSet;
  const manual = (
    await (
      await request.patch(`/api/tasks/${task.id}/rules`, {
        data: {
          rules: initial.rules.map((rule: object) => ({ ...rule, generationMethod: "manual" })),
        },
      })
    ).json()
  ).ruleSet;
  const reused = await request.post(`/api/tasks/${task.id}/rules?prepare=1`);
  expect(reused.ok()).toBe(true);
  expect((await reused.json()).ruleSet.id).toBe(manual.id);
  const sourceFile = {
    name: "补充要求.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("文件大小不超过 2 KB。"),
  };
  expect(
    (await request.post(`/api/tasks/${task.id}/sources`, { multipart: { sourceFile } })).status(),
  ).toBe(201);
  const repeated = await request.post(`/api/tasks/${task.id}/sources`, {
    multipart: { sourceFile },
  });
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).reused).toBe(true);
  const changed = await request.post(`/api/tasks/${task.id}/sources`, {
    multipart: { sourceFile: { ...sourceFile, buffer: Buffer.from("文件大小不超过 3 KB。") } },
  });
  expect(changed.status()).toBe(409);
  expect(await changed.text()).toContain("修订");
  const protectedResponse = await request.post(`/api/tasks/${task.id}/rules?prepare=1`);
  expect(protectedResponse.status()).toBe(409);
  expect(await protectedResponse.text()).toContain("人工");
  const current = (await (await request.get(`/api/tasks/${task.id}/rules`)).json()).ruleSets;
  expect(current).toHaveLength(2);
  expect(current[0].id).toBe(manual.id);
  await page.goto(`/tasks/${task.id}`);
  await page.getByTestId("task-primary-action").click();
  await expect(page.getByRole("dialog")).toContainText("人工调整");
  const dialog = page.waitForEvent("dialog");
  const click = page.getByRole("button", { name: "整理审查要求", exact: true }).click();
  await (await dialog).dismiss();
  await click;
  expect((await (await request.get(`/api/tasks/${task.id}/rules`)).json()).ruleSets).toHaveLength(
    2,
  );
});

test("读取失败需明确继续，示例一键模拟运行且不会覆盖已有任务", async ({ request, page }) => {
  const task = await createTask(request, "文件格式必须为 TXT。");
  await upload(request, task.id, "说明.txt", "正文");
  await upload(request, task.id, "坏.pdf", "不是真正的PDF");
  await page.goto(`/tasks/${task.id}`);
  await page.getByTestId("task-primary-action").click();
  await expect(page.getByTestId("task-primary-action")).toHaveText("基于可用材料继续");
  expect(
    (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions,
  ).toHaveLength(0);
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  await page.getByRole("button", { name: "怎么用 · 3步上手" }).click();
  await page.getByRole("button", { name: /创建并审查.*竞赛/ }).click();
  await expect(page).toHaveURL(/view=results&mode=mock/);
  const demoId = new URL(page.url()).pathname.split("/").at(-1)!;
  created.push(demoId);
  expect(demoId).not.toBe(task.id);
  const checks: ReviewExecution[] = (
    await (await request.get(`/api/tasks/${demoId}/checks`)).json()
  ).executions;
  expect(checks).toHaveLength(1);
  expect(checks[0]?.metadata?.mode).toBe("mock");
  expect(checks[0]?.metadata?.modelCalls).toHaveLength(0);
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials).toHaveLength(
    2,
  );
});

test("历史副本包与报告失败可重试且保留记录及选择 UX-05.A4", async ({ page, request }) => {
  const task = await createTask(request, "文件格式必须为 TXT。");
  await upload(request, task.id, "材料.txt", "原始版本内容");
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  await upload(request, task.id, "材料.txt", "修订后的版本内容");
  await page.goto(`/tasks/${task.id}?view=results&execution=${executions[0].id}&verdict=all`);
  const originalUrl = page.url();
  await page.route("**/report?*", (route) =>
    route.fulfill({ status: 503, body: "synthetic failure" }),
  );
  await page.getByRole("link", { name: "导出 Markdown 报告", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "报告未能导出" })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await page.unroute("**/report?*");
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 Markdown 报告", exact: true }).click();
  const report = await reportDownload;
  expect(await readFile((await report.path())!, "utf8")).toContain("材料.txt · v1");
  await page.getByText("打包本次检查的材料副本", { exact: true }).click();
  const outputName = page.getByLabel("检查材料副本名称：材料.txt", { exact: true });
  await outputName.fill("核对副本.txt");
  await page.route(`**/api/tasks/${task.id}/package`, (route) => route.abort());
  await page.getByRole("button", { name: "导出本次检查材料副本包", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "选择和输出名称已保留" })).toBeVisible();
  await expect(outputName).toHaveValue("核对副本.txt");
  await page.unroute(`**/api/tasks/${task.id}/package`);
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本次检查材料副本包", exact: true }).click();
  const downloaded = await zipDownload;
  const zip = await JSZip.loadAsync(await readFile((await downloaded.path())!));
  const file = Object.values(zip.files).find((item) => item.name.endsWith("核对副本.txt"));
  expect(file).toBeTruthy();
  expect(await file!.async("string")).toBe("原始版本内容");
  expect(page.url()).toBe(originalUrl);
});

test("准备、结果、处理面板与引导的自动无障碍扫描 UX-09.A4", async ({ page, request, isMobile }) => {
  const task = await createTask(request, "项目名称必须一致。");
  await upload(request, task.id, "甲.txt", "项目名称：绿色能源");
  await upload(request, task.id, "乙.txt", "项目名称：智慧能源");
  await page.goto(`/tasks/${task.id}?view=prepare`);
  const scan = async (): Promise<void> => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  };
  await scan();
  await page.screenshot({
    path: `test-results/ux-prepare-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await page.getByTestId("task-primary-action").click();
  await expect(page).toHaveURL(/view=results/);
  await scan();
  await page.screenshot({
    path: `test-results/ux-issues-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  const action = page
    .locator('li[id^="execution-"]')
    .first()
    .getByRole("button", { name: "上传修订 / 处理读取问题" });
  await action.click();
  await scan();
  await page.keyboard.press("Escape");
  await expect(action).toBeFocused();
  await page.getByRole("button", { name: "怎么用 · 3步上手" }).click();
  await scan();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "怎么用 · 3步上手" })).toBeFocused();
});
