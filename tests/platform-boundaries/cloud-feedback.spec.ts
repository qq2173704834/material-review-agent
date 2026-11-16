import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  test,
  expect,
  createActor,
  draft,
  publish,
  noticeContent,
} from "../helpers/platform-boundaries";

test("BUG068/069 日程弹窗编辑、保存退出与失败重试", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "cloudschedule");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  try {
    await page.goto("/me/schedule");
    await page.getByRole("button", { name: "添加日程", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "安排个人事项" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("事项名称", { exact: true }).fill("合成验收作业");
    await editor.getByLabel("截止", { exact: true }).fill("2027-03-10");
    await editor.getByRole("button", { name: "保存日程", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("link", { name: "学习资源", exact: true }).first().click();
    await expect(page).toHaveURL(/\/learn/);
    expect(dialogs).toBe(0);
    await page.goto("/me/schedule");
    await page
      .getByRole("article", { name: "合成验收作业" })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await expect(editor.getByLabel("事项名称", { exact: true })).toHaveValue("合成验收作业");
    await editor.getByLabel("事项名称", { exact: true }).fill("合成修改后作业");
    await page.route("**/api/campus", async (route) => {
      if (route.request().method() === "POST")
        await route.fulfill({ status: 503, json: { error: "合成保存失败" } });
      else await route.continue();
    });
    await editor.getByRole("button", { name: "保存日程", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("合成保存失败");
    await expect(editor.getByLabel("事项名称", { exact: true })).toHaveValue("合成修改后作业");
    await page.unroute("**/api/campus");
    await editor.getByRole("button", { name: "保存日程", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "合成修改后作业", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "切换日历", exact: true }).click();
    await page.getByLabel("月份", { exact: true }).fill("2027-03");
    await page.getByRole("button", { name: "2027-03-10，1项安排", exact: true }).click();
    await page
      .getByRole("article", { name: "合成修改后作业" })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    expect(dialogs).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir("outputs/eng-107", { recursive: true });
    await page.screenshot({ path: "outputs/eng-107/calendar-mobile.png", fullPage: false });
  } finally {
    await actor.api.dispose();
  }
});

test("BUG070 自动识别学习计划且不放宽报名日期依据", async ({ playwright }) => {
  const actor = await createActor(playwright, "cloudassistant");
  try {
    const answer = await actor.api.post("/api/assistant", {
      data: {
        requestId: randomUUID(),
        question:
          "我是一名在校大学生，正在准备大学英语四级，每天能学习30分钟。请给我一份一周入门安排。",
      },
    });
    expect(answer.ok(), await answer.text()).toBe(true);
    const body = await answer.json();
    expect(body.kind).toBe("学习建议");
    expect(body.mode).toBe("mock");
    const dates = await actor.api.post("/api/assistant", {
      data: { requestId: randomUUID(), question: "请给我2029年四级报名截止日期和复习计划" },
    });
    expect((await dates.json()).kind).toBe("需补充信息");
  } finally {
    await actor.api.dispose();
  }
});

test("UXR038/039 已选学校收起设置且材料自查入口可发现", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "cloudschool");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  try {
    await page.goto("/campus");
    await page.getByLabel("学校", { exact: true }).selectOption("sspu");
    await page.getByRole("button", { name: "保存学校", exact: true }).click();
    await expect(page.getByLabel("搜索学校", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("搜索学校", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "切换学校 / 修改关注", exact: true }).click();
    await expect(page.getByLabel("搜索学校", { exact: true })).toBeVisible();
    await page.goto("/me");
    await page.getByRole("link", { name: "新建材料自查", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/new/);
  } finally {
    await actor.api.dispose();
  }
});

for (const width of [1280, 390]) {
  test(`BUG071/072 材料更新提示、手动复检与简版报告 ${width}`, async ({ playwright, page }) => {
    const actor = await createActor(playwright, `cloudreview${width}`);
    const peer = await createActor(playwright, `cloudpeer${width}`);
    await page.context().addCookies((await actor.api.storageState()).cookies);
    await page.setViewportSize({ width, height: 900 });
    try {
      const response = await actor.api.post("/api/tasks", {
        data: { name: "合成材料自查", noticeText: "文件格式必须为 TXT。\n文件大小不超过 1 KB。" },
      });
      expect(response.status(), await response.text()).toBe(201);
      const { task } = await response.json();
      const upload = async (text: string): Promise<{ id: string }> => {
        const result = await actor.api.post(`/api/tasks/${task.id}/materials`, {
          multipart: {
            files: { name: "合成说明.txt", mimeType: "text/plain", buffer: Buffer.from(text) },
          },
        });
        expect(result.status(), await result.text()).toBe(201);
        return (await result.json()).materials[0];
      };
      const material = await upload("测试正文".repeat(300));
      expect((await actor.api.post(`/api/tasks/${task.id}/rules`)).ok()).toBe(true);
      expect((await actor.api.post(`/api/tasks/${task.id}/checks`)).ok()).toBe(true);
      const before = (await (await actor.api.get(`/api/tasks/${task.id}/checks`)).json())
        .executions;
      expect(before[0].results.some((item: { verdict: string }) => item.verdict === "failed")).toBe(
        true,
      );
      await page.goto(`/tasks/${task.id}?view=prepare&execution=${before[0].id}`);
      await expect(page.getByRole("textbox", { name: "检查要求", exact: true })).toBeHidden();
      await expect(page.getByRole("heading", { name: "材料提示与提交准备" })).toHaveCount(0);
      await page.getByLabel("选择审查材料").setInputFiles({
        name: "合成说明.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("已修订的短材料。"),
      });
      await expect(page.getByLabel("逐文件上传状态")).toContainText("读取成功");
      const primary = page.getByTestId("task-primary-action");
      await expect(primary).toHaveText("重新检查");
      await expect(
        page.getByText("材料或要求已更新，需要重新检查。", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `outputs/eng-107/review-preparation-${width}.png`,
        fullPage: false,
      });
      let runs = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === `/api/tasks/${task.id}/checks`
        )
          runs++;
      });
      await page.getByRole("button", { name: "2. 检查进度", exact: true }).click();
      await expect(page.getByText(/材料已更新，请点击上方/)).toBeVisible();
      expect(runs).toBe(0);
      await primary.click();
      await expect(page).toHaveURL(/view=results/);
      await expect(page.getByLabel("自查结论")).toContainText("模拟检查已完成");
      await page.evaluate(() => scrollTo(0, 0));
      const summaryBox = await page.getByLabel("当前材料自查摘要").boundingBox();
      expect(summaryBox && summaryBox.y + summaryBox.height <= 900).toBe(true);
      await page.screenshot({
        path: `outputs/eng-107/review-summary-${width}.png`,
        fullPage: false,
      });
      expect(runs).toBe(1);
      const after = (await (await actor.api.get(`/api/tasks/${task.id}/checks`)).json()).executions;
      expect(after).toHaveLength(2);
      expect(after[0].validity).toBe("current");
      expect(after[0].results.every((item: { verdict: string }) => item.verdict === "passed")).toBe(
        true,
      );
      expect(after[1].id).toBe(before[0].id);
      expect(
        (
          await actor.api.get(`/api/tasks/${task.id}/materials/${material.id}/versions/1?file=1`)
        ).status(),
      ).toBe(200);
      const report = await (await actor.api.get(`/api/tasks/${task.id}/report`)).text();
      expect(report).toContain("材料自查结果");
      expect(report).not.toMatch(/任务 ID|执行 ID|token|模型步骤|controlled-model/iu);
      expect(report).toContain("合成说明.txt");
      const html = await (await actor.api.get(`/api/tasks/${task.id}/report?format=html`)).text();
      expect(html).toContain("模拟检查已完成");
      expect(html).not.toMatch(/模型调用与限制|已知输入 token/iu);
      const historical = await (
        await actor.api.get(`/api/tasks/${task.id}/report?executionId=${before[0].id}`)
      ).text();
      expect(historical).toContain("需要重新检查");
      expect(historical).toContain("上次结果");
      expect((await peer.api.get(`/api/tasks/${task.id}/report`)).status()).toBe(404);
      await page.getByLabel("按判定筛选").selectOption("all");
      await page.getByText("查看依据", { exact: true }).first().click();
      await expect(
        page.getByRole("button", { name: "定位证据", exact: true }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: `outputs/eng-107/review-results-${width}.png`,
        fullPage: false,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole("button", { name: "2. 检查进度", exact: true }).click();
      await expect(primary).toHaveText("重新检查");
      await primary.click();
      await expect(page).toHaveURL(/view=results/);
      expect(runs).toBe(2);
      const rerun = (await (await actor.api.get(`/api/tasks/${task.id}/checks`)).json()).executions;
      expect(rerun).toHaveLength(3);
      expect(rerun[0].results.every((item: { reusedFrom?: unknown }) => !item.reusedFrom)).toBe(
        true,
      );
      const added = await actor.api.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: {
            name: "新增证明.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("合成新增材料。"),
          },
        },
      });
      expect(added.status()).toBe(201);
      await page.reload();
      await expect(primary).toHaveText("重新检查");
      expect(
        (await (await actor.api.get(`/api/tasks/${task.id}/checks`)).json()).executions,
      ).toHaveLength(3);
      await page.getByRole("button", { name: "1. 准备要求与材料", exact: true }).click();
      await page.getByText("修改要求", { exact: true }).click();
      await page
        .getByRole("textbox", { name: "检查要求", exact: true })
        .fill("文件格式必须为 TXT。\n文件大小不超过 2 KB。");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      await expect(page.getByText("未保存", { exact: true })).toHaveCount(0);
      await expect(primary).toHaveText("重新检查");
      await expect(
        page.getByText("材料或要求已更新，需要重新检查。", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "打开考试学习AI助手" }).click();
      await expect(page.getByRole("dialog", { name: "考试学习AI助手" })).toBeVisible();
      await page.screenshot({ path: `outputs/eng-107/assistant-${width}.png`, fullPage: false });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await page
          .locator(".assistant-mascot .mascot-body")
          .first()
          .evaluate((element) => getComputedStyle(element).animationName),
      ).toBe("none");
    } finally {
      await actor.api.dispose();
      await peer.api.dispose();
    }
  });
}

test("BUG067 公共考试推荐不会写入新账号目标和日程", async ({ actors, playwright, page }) => {
  const actor = await createActor(playwright, "publicexam");
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const date = `考试日期${day}`;
  try {
    const item = await draft(
      actors.admin,
      noticeContent({
        title: "合成近期公共考试推荐",
        year: Number(day.slice(0, 4)),
        edition: `${day.slice(0, 4)}年合成考期`,
        text: date,
        timeline: [{ label: "考试", value: day, quote: date }],
      }),
    );
    await publish(actors.admin, item.id);
    await page.context().addCookies((await actor.api.storageState()).cookies);
    await page.goto("/");
    await expect(page.locator(".next-event-strip")).toContainText("近期考试推荐");
    expect((await (await actor.api.get("/api/goals")).json()).goals).toHaveLength(0);
    expect((await (await actor.api.get("/api/schedule")).json()).nodes).toHaveLength(0);
  } finally {
    await actor.api.dispose();
  }
});
